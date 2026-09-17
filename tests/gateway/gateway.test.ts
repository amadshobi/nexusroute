/**
 * ─────────────────────────────────────────────────────────────
 * Goblin Nexus — Gateway Interceptor Comprehensive Test Suite
 * ─────────────────────────────────────────────────────────────
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseFuserOutput } from "../../src/commands/gateway";
import {
	computePromptHash,
	formatCachedStreamChunks,
	PromptCacheManager,
} from "../../src/gateway/cache";
import {
	buildFallbackBody,
	extractModelFromBody,
	isModelHealthy,
	recordModelFailure,
	recordModelSuccess,
	resolveFallbackCandidates,
	shouldTriggerFallback,
} from "../../src/gateway/circuit-breaker";
import {
	DEFAULT_FALLBACK,
	DEFAULT_RULES,
	loadGatewayRules,
} from "../../src/gateway/rules";
import {
	sanitizeText,
	isReasoningModel,
	normalizeUpstreamReasoning,
	sanitizeSchemaForGemini,
	normalizeUpstreamTools,
	detectSalvagableError,
	buildSalvagedChunks,
} from "../../src/gateway/sanitizer";
import { FixtureManager } from "../../src/gateway/replay";
import {
	AccessLogManager,
	formatModelChain,
	renderAccessLogsTable,
	type AccessLogEntry,
} from "../../src/gateway/access-log";
import { createGatewayServer } from "../../src/gateway/server";

const TEST_DIR = join(process.cwd(), ".tmp-test-gateway");
const ISOLATED_CONFIG_PATH = join(TEST_DIR, "isolated-config.json");
process.env.NEXUS_CONFIG_PATH = ISOLATED_CONFIG_PATH;
process.env.GN_CONFIG_PATH = ISOLATED_CONFIG_PATH;
if (!existsSync(TEST_DIR)) {
	mkdirSync(TEST_DIR, { recursive: true });
}
const { writeFileSync } = require("node:fs");
writeFileSync(
	ISOLATED_CONFIG_PATH,
	JSON.stringify({
		gateway: {
			enabled: true,
			modelFilter: {
				whitelist: { omp: [], vansrouter: [] },
				blacklist: [],
			},
		},
	}),
);

describe("1. Rules & Configuration", () => {
	test("loads default rules fallback safely", () => {
		const rules = loadGatewayRules();
		expect(rules.enabled).toBe(true);
		expect(rules.patterns.length).toBeGreaterThan(0);
		expect(rules.fallback).toBeDefined();
		expect(rules.fallback?.trigger_statuses).toContain(429);
	});
});

describe("1b. PID resolver (fuser output parsing)", () => {
	test("extracts the process PID, never the port, from fuser output", () => {
		// Regression: sebelumnya strip non-digit membuat port 4010 jadi PID.
		expect(parseFuserOutput("4010/tcp: 12345")).toBe(12345);
		expect(parseFuserOutput("4010/tcp:  12345")).toBe(12345);
		expect(parseFuserOutput("  12345")).toBe(12345);
		expect(parseFuserOutput("12345")).toBe(12345);
	});

	test("takes the last PID when multiple are listed", () => {
		expect(parseFuserOutput("4010/tcp: 12345 67890")).toBe(67890);
	});

	test("returns null for empty or non-numeric output", () => {
		expect(parseFuserOutput("")).toBeNull();
		expect(parseFuserOutput("4010/tcp:")).toBeNull();
		expect(parseFuserOutput("no processes found")).toBeNull();
	});
});

describe("2. Privacy Shield & Sanitizer Engine", () => {
	test("redacts sensitive IP and bearer tokens without mutating original string", () => {
		const raw = "Bearer mock-token-auth-sample-value and IP is 192.168.1.10";
		const { sanitized, maskedCount } = sanitizeText(raw, DEFAULT_RULES);

		expect(maskedCount).toBe(2);
		expect(sanitized).toContain("[REDACTED_BY_GOBLIN_SHIELD]");
		expect(sanitized).not.toContain("192.168.1.10");
		// Verify original string unmodified
		expect(raw).toContain("192.168.1.10");
	});

	test("handles empty or clean text gracefully", () => {
		const clean = "Hello, what is the capital of France?";
		const { sanitized, maskedCount } = sanitizeText(clean, DEFAULT_RULES);
		expect(maskedCount).toBe(0);
		expect(sanitized).toBe(clean);
	});
});

describe("3. Circuit Breaker & Fallback Router", () => {
	test("detects fallback status triggers correctly", () => {
		expect(shouldTriggerFallback(429, DEFAULT_FALLBACK)).toBe(true);
		expect(shouldTriggerFallback(410, DEFAULT_FALLBACK)).toBe(true);
		expect(shouldTriggerFallback(500, DEFAULT_FALLBACK)).toBe(true);
		expect(shouldTriggerFallback(503, DEFAULT_FALLBACK)).toBe(true);
		expect(shouldTriggerFallback(200, DEFAULT_FALLBACK)).toBe(false);
		expect(shouldTriggerFallback(400, DEFAULT_FALLBACK)).toBe(false);
	});

	test("resolves fallback candidates in order", () => {
		const candidates = resolveFallbackCandidates(
			"google-antigravity/claude-sonnet-4-6",
			DEFAULT_FALLBACK,
		);
		expect(candidates).toContain("google-antigravity/gemini-3.1-pro");
	});

	test("circuit breaker cooldown trips after 3 consecutive failures", () => {
		const testModel = "test-provider/fail-model";
		expect(isModelHealthy(testModel)).toBe(true);

		recordModelFailure(testModel);
		recordModelFailure(testModel);
		expect(isModelHealthy(testModel)).toBe(true);

		recordModelFailure(testModel);
		expect(isModelHealthy(testModel)).toBe(false); // Cooldown tripped

		recordModelSuccess(testModel);
		expect(isModelHealthy(testModel)).toBe(true); // Reset on success
	});

	test("extracts and replaces model immutably", () => {
		const bodyStr = JSON.stringify({
			model: "model-a",
			messages: [{ role: "user", content: "hi" }],
		});
		const extracted = extractModelFromBody(bodyStr);
		expect(extracted?.model).toBe("model-a");

		const fallbackBody = buildFallbackBody(extracted?.parsed, "model-b");
		const parsedFallback = JSON.parse(fallbackBody!);
		expect(parsedFallback.model).toBe("model-b");
		expect(extracted?.parsed.model).toBe("model-a"); // Original unmodified
	});
});

describe("4. Deterministic SHA-256 Prompt Caching Engine", () => {
	const cacheDir = join(TEST_DIR, "cache");
	let cacheManager: PromptCacheManager;

	beforeAll(() => {
		if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
		cacheManager = new PromptCacheManager(cacheDir, 5000);
	});

	afterAll(() => {
		if (existsSync(TEST_DIR))
			rmSync(TEST_DIR, { recursive: true, force: true });
	});

	test("computes identical hash for identical payloads regardless of key ordering", () => {
		const body1 = {
			model: "m1",
			messages: [{ role: "user", content: "ping" }],
			temperature: 0.7,
		};
		const body2 = {
			temperature: 0.7,
			model: "m1",
			messages: [{ role: "user", content: "ping" }],
		};

		const hash1 = computePromptHash(body1);
		const hash2 = computePromptHash(body2);
		expect(hash1).toBe(hash2);
		expect(hash1).toHaveLength(64);
	});

	test("saves and retrieves non-streaming cache entry", () => {
		const hash = computePromptHash({ model: "test", messages: ["msg1"] });
		cacheManager.set(
			hash,
			{
				model: "test",
				status: 200,
				headers: { "content-type": "application/json" },
				isStream: false,
			},
			'{"reply": "pong"}',
		);

		const cached = cacheManager.get(hash);
		expect(cached).not.toBeNull();
		expect(cached?.isStream).toBe(false);
		expect(cached?.body).toBe('{"reply": "pong"}');
	});

	test("saves and retrieves streaming cache chunks", () => {
		const hash = computePromptHash({
			model: "test-stream",
			messages: ["msg2"],
		});
		const sampleChunks = [
			'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
			'data: {"choices":[{"delta":{"content":" World"}}]}\n\n',
			"data: [DONE]\n\n",
		];

		cacheManager.set(
			hash,
			{
				model: "test-stream",
				status: 200,
				headers: { "content-type": "text/event-stream" },
				isStream: true,
				totalChunks: sampleChunks.length,
			},
			sampleChunks,
		);

		const cached = cacheManager.get(hash);
		expect(cached).not.toBeNull();
		expect(cached?.isStream).toBe(true);
		expect(cached?.chunks.length).toBe(3);
	});
});

describe("5. Replay & Fixture Engine", () => {
	const fixturesDir = join(TEST_DIR, "fixtures");
	let fixtureManager: FixtureManager;

	beforeAll(() => {
		fixtureManager = new FixtureManager(fixturesDir);
	});

	test("records and mocks back interaction correctly", async () => {
		const reqBody = {
			model: "m-record",
			messages: [{ role: "user", content: "record me" }],
		};
		fixtureManager.record(
			"test-session",
			{
				url: "/v1/chat/completions",
				method: "POST",
				model: "m-record",
				body: reqBody,
			},
			{
				status: 200,
				headers: { "content-type": "application/json" },
				isStream: false,
				body: JSON.stringify({
					id: "rec-1",
					choices: [{ message: { content: "recorded response" } }],
				}),
			},
		);

		const mockResp = fixtureManager.mock("test-session", reqBody);
		expect(mockResp).not.toBeNull();
		expect(mockResp?.status).toBe(200);
		const mockData: any = await mockResp?.json();
		expect(mockData.choices[0].message.content).toBe("recorded response");
	});
});

describe("6. Master Gateway Server End-to-End Integration", () => {
	let mockUpstreamServer: any;
	let gatewayServer: any;
	const mockPort = 4502;
	const gwPort = 4500;

	beforeAll(async () => {
		// 1. Mock Upstream Provider on 4502
		mockUpstreamServer = Bun.serve({
			port: mockPort,
			hostname: "127.0.0.1",
			async fetch(req) {
				const url = new URL(req.url);

				if (url.pathname === "/v1/models") {
					return new Response(
						JSON.stringify({ data: [{ id: "test-model" }] }),
						{
							headers: { "content-type": "application/json" },
						},
					);
				}

				if (url.pathname === "/v1/chat/completions") {
					const body: any = await req.json();

					// Trigger simulated 429 for model "trigger-429"
					if (body.model === "trigger-429") {
						return new Response(
							JSON.stringify({ error: "rate limit exceeded" }),
							{
								status: 429,
								headers: { "content-type": "application/json" },
							},
						);
					}

					if (body.model === "trigger-thought-only") {
						const chunks = [
							'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
							'data: {"error":{"message":"thought-only response without final output","type":"upstream_error"}}\n\n',
						];
						const encoder = new TextEncoder();
						const stream = new ReadableStream({
							start(controller) {
								for (const chunk of chunks) {
									controller.enqueue(encoder.encode(chunk));
								}
								controller.close();
							},
						});
						return new Response(stream, {
							headers: { "content-type": "text/event-stream; charset=utf-8" },
						});
					}

					// Streaming mock
					if (body.stream) {
						const chunks = [
							'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
							'data: {"choices":[{"delta":{"content":" from upstream"}}]}\n\n',
							"data: [DONE]\n\n",
						];
						const encoder = new TextEncoder();
						const stream = new ReadableStream({
							start(controller) {
								for (const chunk of chunks) {
									controller.enqueue(encoder.encode(chunk));
								}
								controller.close();
							},
						});
						return new Response(stream, {
							headers: { "content-type": "text/event-stream; charset=utf-8" },
						});
					}

					return new Response(
						JSON.stringify({
							id: "chatcmpl-test",
							model: body.model,
							choices: [
								{
									message: {
										role: "assistant",
										content: `Echo: ${body.messages[0]?.content}`,
									},
								},
							],
							usage: {
								prompt_tokens: 10,
								completion_tokens: 5,
								total_tokens: 15,
							},
						}),
						{
							headers: { "content-type": "application/json" },
						},
					);
				}

				return new Response("Not found", { status: 404 });
			},
		});

		const cacheDir = join(TEST_DIR, "gw-cache");
		if (existsSync(cacheDir)) {
			rmSync(cacheDir, { recursive: true, force: true });
		}
		const testAccessLog = join(TEST_DIR, "gw-server-access.jsonl");
		if (existsSync(testAccessLog)) {
			rmSync(testAccessLog, { force: true });
		}

		// 2. Gateway Server on 4500
		gatewayServer = createGatewayServer({
			port: gwPort,
			targetHost: "127.0.0.1",
			targetPort: mockPort,
			upstreams: [
				{
					name: "mock-target",
					host: "127.0.0.1",
					port: mockPort,
					basePath: "/v1",
				},
			],
			cacheEnabled: true,
			cacheDir,
			accessLogPath: testAccessLog,
			shieldEnabled: true,
			mode: "live",
		});

		gatewayServer.start();
	});

	afterAll(() => {
		if (gatewayServer) gatewayServer.stop();
		if (mockUpstreamServer) mockUpstreamServer.stop();
	});

	test("serves health and status check on /gn/health", async () => {
		const res = await fetch(`http://127.0.0.1:${gwPort}/gn/health`);
		expect(res.status).toBe(200);
		const data: any = await res.json();
		expect(data.status).toBe("ok");
		expect(data.port).toBe(gwPort);
	});

	test("serves identical health JSON on /nexus/health (NexusRoute canonical)", async () => {
		const [nexusRes, gnRes] = await Promise.all([
			fetch(`http://127.0.0.1:${gwPort}/nexus/health`),
			fetch(`http://127.0.0.1:${gwPort}/gn/health`),
		]);

		expect(nexusRes.status).toBe(200);
		const nexusData: any = await nexusRes.json();
		const gnData: any = await gnRes.json();

		expect(nexusData.status).toBe("ok");
		expect(nexusData.port).toBe(gwPort);
		// Identical payload shape for both routes.
		expect(nexusData.status).toBe(gnData.status);
		expect(nexusData.version).toBe(gnData.version);
		expect(nexusData.port).toBe(gnData.port);
		expect(nexusData.cacheEnabled).toBe(gnData.cacheEnabled);
		expect(nexusData.shieldEnabled).toBe(gnData.shieldEnabled);
	});

	test("proxies non-streaming completions and establishes cache on second hit", async () => {
		const payload = {
			model: "google-antigravity/gemini-3.1-pro",
			messages: [{ role: "user", content: "Hello world" }],
		};

		// First request: Cache MISS
		const res1 = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		expect(res1.status).toBe(200);
		expect(res1.headers.get("X-GN-Cache")).toBe("MISS");
		expect(res1.headers.get("X-Nexus-Cache")).toBe("MISS");
		const data1: any = await res1.json();
		expect(data1.choices[0].message.content).toContain("Hello world");

		// Second request: Cache HIT
		const res2 = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		expect(res2.status).toBe(200);
		expect(res2.headers.get("X-GN-Cache")).toBe("HIT");
		expect(res2.headers.get("X-Nexus-Cache")).toBe("HIT");
		const data2: any = await res2.json();
		expect(data2.choices[0].message.content).toContain("Hello world");
	});

	test("proxies SSE streaming completions correctly", async () => {
		const streamPayload = {
			model: "google-antigravity/gemini-3.6-flash",
			stream: true,
			messages: [{ role: "user", content: "Stream me please" }],
		};

		const res = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(streamPayload),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/event-stream");
		const text = await res.text();
		expect(text).toContain("Hi");
		expect(text).toContain("[DONE]");
	});

	test("intercepts and salvages thought-only SSE fatal error mid-stream", async () => {
		const res = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "trigger-thought-only",
				messages: [{ role: "user", content: "hi" }],
				stream: true,
			}),
		});

		expect(res.status).toBe(200);
		const body = await res.text();
		// Must not contain raw upstream_error error payload
		expect(body).not.toContain('"upstream_error"');
		// Must contain salvaged completion chunks
		expect(body).toContain("chatcmpl-gn-salvaged");
		expect(body).toContain("[Note: Reasoning concluded without generating final response content.");
		expect(body).toContain('"finish_reason":"stop"');
		expect(body).toContain("data: [DONE]");
	});
});

describe("8. Hybrid Multi-Upstream Router (Issue #38)", () => {
	let upstreamA: any;
	let upstreamB: any;
	let hybridGateway: any;
	const portA = 4512;
	const portB = 4513;
	const gwPort = 4510;

	beforeAll(async () => {
		// Upstream A = OMP-like (gemini)
		upstreamA = Bun.serve({
			port: portA,
			hostname: "127.0.0.1",
			async fetch(req) {
				const url = new URL(req.url);
				if (url.pathname === "/v1/models") {
					return new Response(
						JSON.stringify({
							object: "list",
							data: [{ id: "google-antigravity/gemini-3.8-flash" }],
						}),
					);
				}
				if (url.pathname === "/v1/chat/completions") {
					const body: any = await req.json();
					return new Response(
						JSON.stringify({
							id: "a",
							model: body.model,
							choices: [{ message: { content: `A:${body.model}` } }],
						}),
					);
				}
				return new Response("nf", { status: 404 });
			},
		});

		// Upstream B = VansRouter-like (deepseek / xiamoi)
		upstreamB = Bun.serve({
			port: portB,
			hostname: "127.0.0.1",
			async fetch(req) {
				const url = new URL(req.url);
				if (url.pathname === "/api/v1/models") {
					return new Response(
						JSON.stringify({
							object: "list",
							data: [
								{ id: "deepseek/deepseek-v4-flash" },
								{ id: "xiamoi/mimo-pro" },
							],
						}),
					);
				}
				if (url.pathname === "/api/v1/chat/completions") {
					const body: any = await req.json();
					return new Response(
						JSON.stringify({
							id: "b",
							model: body.model,
							choices: [{ message: { content: `B:${body.model}` } }],
						}),
					);
				}
				return new Response("nf", { status: 404 });
			},
		});

		hybridGateway = createGatewayServer({
			port: gwPort,
			targetHost: "127.0.0.1",
			targetPort: portA, // legacy default = upstream A
			cacheEnabled: false,
			shieldEnabled: false,
			mode: "live",
			upstreams: [
				{ name: "omp", host: "127.0.0.1", port: portA, basePath: "/v1" },
				{
					name: "vansrouter",
					host: "127.0.0.1",
					port: portB,
					basePath: "/api/v1",
				},
			],
		});
		hybridGateway.start();
	});

	afterAll(() => {
		hybridGateway?.stop();
		upstreamA?.stop();
		upstreamB?.stop();
	});

	test("GET /v1/models merges catalogs from both upstreams", async () => {
		const res = await fetch(`http://127.0.0.1:${gwPort}/v1/models`);
		expect(res.status).toBe(200);
		const data: any = await res.json();
		const ids = data.data.map((m: any) => m.id);
		expect(ids).toContain("google-antigravity/gemini-3.8-flash");
		expect(ids).toContain("deepseek/deepseek-v4-flash");
		expect(ids).toContain("xiamoi/mimo-pro");
		expect(res.headers.get("X-GN-Upstreams")).toBe("2");
	});

	test("POST routes gemini model to upstream A (OMP)", async () => {
		const res = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "google-antigravity/gemini-3.8-flash",
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		const data: any = await res.json();
		expect(data.model).toBe("google-antigravity/gemini-3.8-flash");
		expect(data.choices[0].message.content).toBe(
			"A:google-antigravity/gemini-3.8-flash",
		);
	});

	test("POST routes deepseek model to upstream B (VansRouter)", async () => {
		const res = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "deepseek/deepseek-v4-flash",
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		const data: any = await res.json();
		expect(data.model).toBe("deepseek/deepseek-v4-flash");
		expect(data.choices[0].message.content).toBe(
			"B:deepseek/deepseek-v4-flash",
		);
	});

	test("unknown model defaults to upstream A (OMP)", async () => {
		const res = await fetch(`http://127.0.0.1:${gwPort}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "mystery/model-xyz",
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		const data: any = await res.json();
		expect(data.choices[0].message.content).toBe("A:mystery/model-xyz");
	});
});

describe("7. Access Log & Fallback Chain Analytics", () => {
	const logFile = join(TEST_DIR, "test-access.jsonl");
	let logManager: AccessLogManager;

	beforeAll(() => {
		if (!existsSync(TEST_DIR)) {
			mkdirSync(TEST_DIR, { recursive: true });
		}
		if (existsSync(logFile)) rmSync(logFile, { force: true });
		logManager = new AccessLogManager(logFile);
	});

	afterAll(() => {
		if (existsSync(logFile)) rmSync(logFile, { force: true });
	});

	test("records and filters access log entries", () => {
		const now = Date.now();
		const entry1: AccessLogEntry = {
			ts: now - 5000,
			method: "POST",
			path: "/v1/chat/completions",
			initialModel: "kilo-auto/free",
			servedModel: "minimax-m3",
			status: 200,
			latencyMs: 1500,
			cache: "MISS",
			stream: true,
			fallback: {
				chain: [
					{ model: "kilo-auto/free", status: 503, ok: false },
					{ model: "minimax-m3", status: 200, ok: true },
				],
				hopCount: 2,
			},
			shieldRedacted: 2,
		};

		const entry2: AccessLogEntry = {
			ts: now,
			method: "POST",
			path: "/v1/chat/completions",
			initialModel: "minimax-m3",
			servedModel: "minimax-m3",
			status: 200,
			latencyMs: 12,
			cache: "HIT",
			stream: false,
			tokensInput: 1500,
			tokensOutput: 350,
			tokensCache: 1500,
			tokensTotal: 1850,
			shieldRedacted: 0,
		};

		logManager.write(entry1);
		logManager.write(entry2);

		const all = logManager.readLogs({ limit: 10 });
		expect(all.length).toBe(2);
		expect(all[0].servedModel).toBe("minimax-m3");
		expect(all[0].fallback?.hopCount).toBe(2);
		expect(all[1].tokensInput).toBe(1500);
		expect(all[1].tokensOutput).toBe(350);

		// Filter by model
		const filtered = logManager.readLogs({ model: "kilo" });
		expect(filtered.length).toBe(1);
		expect(filtered[0].initialModel).toBe("kilo-auto/free");

		// Filter by since (lifecycle window)
		const sinceFiltered = logManager.readLogs({ since: entry2.ts });
		expect(sinceFiltered.length).toBe(1);
		expect(sinceFiltered[0].servedModel).toBe("minimax-m3");
		expect(sinceFiltered[0].cache).toBe("HIT");

		// Filter by future since returns empty
		const futureFiltered = logManager.readLogs({ since: Date.now() + 100000 });
		expect(futureFiltered.length).toBe(0);
	});

	test("formats cascading fallback chains with symbols", () => {
		const fallbackEntry: AccessLogEntry = {
			ts: Date.now(),
			method: "POST",
			path: "/v1/chat/completions",
			initialModel: "kilo-auto/free",
			servedModel: "gemini-flash",
			status: 200,
			latencyMs: 2200,
			cache: "MISS",
			stream: true,
			fallback: {
				chain: [
					{ model: "kilo-auto/free", status: 503, ok: false },
					{ model: "minimax-m3", status: 503, ok: false },
					{ model: "gemini-flash", status: 200, ok: true },
				],
				hopCount: 3,
			},
			shieldRedacted: 0,
		};

		const chainStr = formatModelChain(fallbackEntry);
		expect(chainStr).toContain("✖ free");
		expect(chainStr).toContain("503");
		expect(chainStr).toContain("✖ minimax-m3");
		expect(chainStr).toContain("✓ gemini-flash");
	});

	test("renders visual box table with summary metrics", () => {
		const entries = logManager.readLogs({ limit: 10 });
		const table = renderAccessLogsTable(entries);
		expect(table).toContain("GATEWAY TRAFFIC & FALLBACK LOGS");
		expect(table).toContain("Traffic Summary");
		expect(table).toContain("Hit Rate");
	});
});

describe("7. Upstream reasoning normalization", () => {
	test("identifies known reasoning models", () => {
		expect(isReasoningModel("google-antigravity/gemini-3.1-pro")).toBe(true);
		expect(isReasoningModel("gemini-3-pro")).toBe(true);
		expect(isReasoningModel("deepseek-r1")).toBe(true);
		expect(isReasoningModel("claude-opus-4-6-thinking")).toBe(true);
		expect(isReasoningModel("gpt-4o-mini")).toBe(false);
	});

	test("injects fallback reasoning_effort when missing for reasoning model", () => {
		const rawPayload = JSON.stringify({
			model: "google-antigravity/gemini-3.1-pro",
			messages: [{ role: "user", content: "hi" }],
		});
		const normalized = normalizeUpstreamReasoning(
			rawPayload,
			"google-antigravity/gemini-3.1-pro",
		);
		const parsed = JSON.parse(normalized);
		expect(parsed.reasoning_effort).toBe("high");
	});

	test("preserves existing reasoning_effort when present", () => {
		const rawPayload = JSON.stringify({
			model: "google-antigravity/gemini-3.1-pro",
			reasoning_effort: "low",
			messages: [{ role: "user", content: "hi" }],
		});
		const normalized = normalizeUpstreamReasoning(
			rawPayload,
			"google-antigravity/gemini-3.1-pro",
		);
		const parsed = JSON.parse(normalized);
		expect(parsed.reasoning_effort).toBe("low");
	});

	test("does not inject reasoning_effort for non-reasoning models", () => {
		const rawPayload = JSON.stringify({
			model: "gpt-4o-mini",
			messages: [{ role: "user", content: "hi" }],
		});
		const normalized = normalizeUpstreamReasoning(rawPayload, "gpt-4o-mini");
		const parsed = JSON.parse(normalized);
		expect(parsed.reasoning_effort).toBeUndefined();
	});
});

describe("8. Antigravity tool schema armor", () => {
	test("sanitizeSchemaForGemini strips keywords and normalizes object properties", () => {
		const dirty = {
			$schema: "http://json-schema.org/draft-07/schema#",
			title: "SearchOptions",
			type: "OBJECT",
			additionalProperties: false,
			patternProperties: { "^x-": { type: "string" } },
			properties: {
				query: {
					type: "STRING",
					title: "Query",
					description: "Search text",
				},
				limit: {
					type: "NUMBER",
					title: "Limit",
				},
			},
			required: ["query", "nonExistentField"],
		};

		const cleaned = sanitizeSchemaForGemini(dirty);
		expect(cleaned.$schema).toBeUndefined();
		expect(cleaned.title).toBeUndefined();
		expect(cleaned.additionalProperties).toBeUndefined();
		expect(cleaned.patternProperties).toBeUndefined();
		expect(cleaned.type).toBe("object");
		expect(cleaned.properties.query.title).toBeUndefined();
		expect(cleaned.properties.query.type).toBe("string");
		expect(cleaned.required).toEqual(["query"]);
	});

	test("normalizeUpstreamTools sanitizes tools for Gemini models", () => {
		const payload = {
			model: "google-antigravity/gemini-3.8-flash",
			tools: [
				{
					type: "function",
					function: {
						name: "testTool",
						parameters: {
							$schema: "draft-07",
							title: "test",
							type: "object",
							properties: {
								input: { type: "string", title: "Input text" },
							},
						},
					},
				},
			],
		};

		const result = normalizeUpstreamTools(
			JSON.stringify(payload),
			"http://127.0.0.1:4000/v1",
			"google-antigravity/gemini-3.8-flash",
		);
		const parsed = JSON.parse(result);
		const params = parsed.tools[0].function.parameters;
		expect(params.$schema).toBeUndefined();
		expect(params.title).toBeUndefined();
		expect(params.properties.input.title).toBeUndefined();
		expect(params.properties.input.type).toBe("string");
	});
});

describe("9. Outbound SSE Error Salvager", () => {
	test("detectSalvagableError identifies thought-only and malformed-call errors", () => {
		expect(
			detectSalvagableError(
				'data: {"error":{"message":"thought-only response without final output","type":"upstream_error"}}',
			),
		).toBe("thought-only");

		expect(
			detectSalvagableError(
				'data: {"error":{"message":"Cloud Code Assist API error: MALFORMED_FUNCTION_CALL","type":"upstream_error"}}',
			),
		).toBe("malformed-call");

		expect(
			detectSalvagableError(
				'data: {"error":{"message":"unknown backend fault","type":"upstream_error"}}',
			),
		).toBe("upstream-error");

		expect(
			detectSalvagableError(
				'data: {"choices":[{"delta":{"content":"valid text"}}]}',
			),
		).toBeNull();
	});

	test("buildSalvagedChunks generates valid OpenAI and Anthropic streams", () => {
		const openAiChunks = buildSalvagedChunks("thought-only", "gemini-3.8-flash", false);
		expect(openAiChunks.length).toBe(3);
		expect(openAiChunks[0]).toContain("chatcmpl-gn-salvaged");
		expect(openAiChunks[0]).toContain("[Note: Reasoning concluded");
		expect(openAiChunks[1]).toContain('"finish_reason":"stop"');
		expect(openAiChunks[2]).toBe("data: [DONE]\n\n");

		const anthropicChunks = buildSalvagedChunks("malformed-call", "claude", true);
		expect(anthropicChunks.length).toBe(3);
		expect(anthropicChunks[0]).toContain("content_block_delta");
		expect(anthropicChunks[1]).toContain('"stop_reason":"end_turn"');
		expect(anthropicChunks[2]).toContain("message_stop");
	});
});
