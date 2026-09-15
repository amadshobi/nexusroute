/**
 * ─────────────────────────────────────────────────────────────
 * NexusRoute — Dashboard Activity Timeline Test Suite
 * ─────────────────────────────────────────────────────────────
 *
 * Covers the 24-bucket `activity` time-series aggregation emitted by
 * GET /api/dashboard/overview, while guarding backward compatibility
 * for the legacy 10-bucket sparklines.
 *
 * Strictly ephemeral: dynamic port, isolated access log, zero live
 * network dependencies.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGatewayServer } from "../../src/gateway/server";
import type { AccessLogEntry } from "../../src/gateway/access-log";

const TEST_DIR = join(process.cwd(), ".tmp-test-gateway");
const ISOLATED_CONFIG_PATH = join(TEST_DIR, "activity-isolated-config.json");
const ACCESS_LOG_PATH = join(TEST_DIR, "activity-access.jsonl");

process.env.NEXUS_CONFIG_PATH = ISOLATED_CONFIG_PATH;
process.env.GN_CONFIG_PATH = ISOLATED_CONFIG_PATH;

if (!existsSync(TEST_DIR)) {
	mkdirSync(TEST_DIR, { recursive: true });
}
writeFileSync(
	ISOLATED_CONFIG_PATH,
	JSON.stringify({
		gateway: {
			enabled: true,
			modelFilter: { whitelist: { omp: [] }, blacklist: [] },
		},
	}),
);
if (existsSync(ACCESS_LOG_PATH)) {
	rmSync(ACCESS_LOG_PATH, { force: true });
}

interface ActivityBucketShape {
	timestamp: number;
	requests: number;
	cacheHits: number;
	tokensInputFresh: number;
	tokensCacheRead: number;
	tokensOutput: number;
	tokensTotal: number;
	costUsd: number;
	providers: Record<string, { requests: number; tokens: number; costUsd: number }>;
	models: Record<string, { requests: number; tokens: number; costUsd: number }>;
}

describe("Dashboard overview activity timeline", () => {
	let gateway: ReturnType<typeof createGatewayServer>;
	let baseUrl = "";

	beforeAll(() => {
		gateway = createGatewayServer({
			port: 0, // dynamic ephemeral port
			cacheEnabled: false,
			shieldEnabled: false,
			mode: "live",
			accessLogPath: ACCESS_LOG_PATH,
			upstreams: [{ name: "omp", host: "127.0.0.1", port: 1, basePath: "/v1" }],
		});
		const instance = gateway.start();
		baseUrl = `http://127.0.0.1:${instance.port}`;

		// Both entries share one timestamp so they land in the same bucket.
		const ts = Date.now();
		const entries: AccessLogEntry[] = [
			{
				ts,
				method: "POST",
				path: "/v1/chat/completions",
				initialModel: "claude-3-5-sonnet",
				servedModel: "claude-3-5-sonnet",
				status: 200,
				latencyMs: 120,
				cache: "HIT",
				stream: true,
				tokensInput: 1000,
				tokensOutput: 200,
				tokensCache: 800,
				tokensTotal: 1200,
				shieldRedacted: 0,
				provider: "anthropic",
				upstream: "omp",
			},
			{
				ts,
				method: "POST",
				path: "/v1/chat/completions",
				initialModel: "gemini-3.8-flash",
				servedModel: "gemini-3.8-flash",
				status: 200,
				latencyMs: 80,
				cache: "MISS",
				stream: true,
				tokensInput: 500,
				tokensOutput: 100,
				tokensCache: 0,
				tokensTotal: 600,
				shieldRedacted: 0,
				provider: "google-antigravity",
				upstream: "omp",
			},
		];
		for (const entry of entries) {
			gateway.context.accessLog.write(entry);
		}
	});

	afterAll(() => {
		gateway?.stop();
		for (const artifact of [ISOLATED_CONFIG_PATH, ACCESS_LOG_PATH]) {
			if (existsSync(artifact)) {
				rmSync(artifact, { force: true });
			}
		}
	});

	test("returns 24 activity buckets with decomposed token/providers/models data", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/overview?range=all`);
		expect(res.status).toBe(200);

		const data: any = await res.json();
		expect(Array.isArray(data.activity)).toBe(true);
		expect(data.activity.length).toBe(24);

		const buckets = data.activity as ActivityBucketShape[];
		const populated = buckets.find((b) => b.requests === 2);

		expect(populated).toBeDefined();
		const bucket = populated as ActivityBucketShape;

		// Cache decomposition.
		expect(bucket.cacheHits).toBe(1);
		expect(bucket.tokensInputFresh).toBe(700);
		expect(bucket.tokensCacheRead).toBe(800);
		expect(bucket.tokensOutput).toBe(300);
		expect(bucket.costUsd).toBeGreaterThan(0);

		// Provider / model decomposition.
		expect(bucket.providers["anthropic"]).toBeDefined();
		expect(bucket.providers["google-antigravity"]).toBeDefined();
		expect(bucket.providers["anthropic"].requests).toBe(1);
		expect(bucket.providers["google-antigravity"].requests).toBe(1);
		expect(bucket.models["claude-3-5-sonnet"]).toBeDefined();
		expect(bucket.models["gemini-3.8-flash"]).toBeDefined();

		// Every bucket carries the full schema.
		for (const b of buckets) {
			expect(typeof b.timestamp).toBe("number");
			expect(typeof b.requests).toBe("number");
			expect(typeof b.tokensTotal).toBe("number");
			expect(typeof b.costUsd).toBe("number");
			expect(typeof b.providers).toBe("object");
			expect(typeof b.models).toBe("object");
		}
	});

	test("preserves backward-compatible 10-bucket sparklines", async () => {
		const res = await fetch(`${baseUrl}/api/dashboard/overview?range=all`);
		expect(res.status).toBe(200);

		const data: any = await res.json();
		expect(Array.isArray(data.sparklines.cost)).toBe(true);
		expect(Array.isArray(data.sparklines.req)).toBe(true);
		expect(data.sparklines.cost.length).toBe(10);
		expect(data.sparklines.req.length).toBe(10);
	});
});
