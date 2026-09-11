/**
 * ─────────────────────────────────────────────────────────────
 * Goblin Nexus — Model Governance Filter & CRUD Endpoint Tests
 * ─────────────────────────────────────────────────────────────
 *
 * Covers model whitelist/blacklist semantics end-to-end:
 *   - empty whitelist      => passthrough (all models allowed)
 *   - non-empty whitelist  => only listed models allowed
 *   - blacklist            => removed from /v1/models and rejected (403) at proxy
 *   - /api/dashboard/models/* CRUD endpoints + persistence
 *
 * ISOLATION: `GN_CONFIG_PATH` + `GOBLIN_VAULT_ROOT` are redirected to a
 * throwaway temp dir BEFORE the gateway server is created. Because
 * `getUserConfigPath()` resolves the path lazily on every call (see rules.ts),
 * `saveGatewayConfig()` never touches the real ~/.config/gn/config.json —
 * regardless of module load order across test files.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = mkdtempSync(join(tmpdir(), "gn-models-filter-"));
const CONFIG_PATH = join(TEST_HOME, ".config", "gn", "config.json");
// Sandbox persistence; also pin vault root so rule loading stays isolated.
process.env.NEXUS_CONFIG_PATH = CONFIG_PATH;
process.env.GN_CONFIG_PATH = CONFIG_PATH;
process.env.GOBLIN_VAULT_ROOT = join(TEST_HOME, "vault");

const { createGatewayServer } = await import("../../src/gateway/server");

const GW_PORT = 4630;
const OMP_PORT = 4632;
const VANS_PORT = 4633;

const OMP_MODELS = ["omp/model-a", "omp/model-b", "omp/blocked"];
const VANS_MODELS = ["vans/model-c"];

interface GatewayHandle {
	start: () => void;
	stop: () => void;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function readPersistedConfig(): { gateway?: { modelFilter?: unknown } } {
	return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

let ompServer: ReturnType<typeof Bun.serve>;
let vansServer: ReturnType<typeof Bun.serve>;
let gateway: GatewayHandle;

beforeAll(() => {
	ompServer = Bun.serve({
		port: OMP_PORT,
		hostname: "127.0.0.1",
		async fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/v1/models") {
				return jsonResponse({
					object: "list",
					data: OMP_MODELS.map((id) => ({ id })),
				});
			}
			if (url.pathname === "/v1/chat/completions") {
				const body = (await req.json()) as { model: string };
				return jsonResponse({
					id: "chatcmpl-omp",
					model: body.model,
					choices: [{ message: { role: "assistant", content: "omp-ok" } }],
				});
			}
			return new Response("Not found", { status: 404 });
		},
	});

	vansServer = Bun.serve({
		port: VANS_PORT,
		hostname: "127.0.0.1",
		async fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/api/v1/models") {
				return jsonResponse({
					object: "list",
					data: VANS_MODELS.map((id) => ({ id })),
				});
			}
			if (url.pathname === "/api/v1/chat/completions") {
				const body = (await req.json()) as { model: string };
				return jsonResponse({
					id: "chatcmpl-vans",
					model: body.model,
					choices: [{ message: { role: "assistant", content: "vans-ok" } }],
				});
			}
			return new Response("Not found", { status: 404 });
		},
	});

	gateway = createGatewayServer({
		port: GW_PORT,
		targetHost: "127.0.0.1",
		targetPort: OMP_PORT,
		cacheEnabled: false,
		shieldEnabled: false,
		mode: "live",
		accessLogPath: join(TEST_HOME, "access.jsonl"),
		upstreams: [
			{ name: "omp", host: "127.0.0.1", port: OMP_PORT, basePath: "/v1" },
			{
				name: "vansrouter",
				host: "127.0.0.1",
				port: VANS_PORT,
				basePath: "/api/v1",
			},
		],
	});
	gateway.start();
});

afterAll(() => {
	gateway?.stop();
	ompServer?.stop();
	vansServer?.stop();
	if (existsSync(TEST_HOME))
		rmSync(TEST_HOME, { recursive: true, force: true });
	delete process.env.GN_CONFIG_PATH;
	delete process.env.GOBLIN_VAULT_ROOT;
});

async function fetchModels(): Promise<string[]> {
	const res = await fetch(`http://127.0.0.1:${GW_PORT}/v1/models`);
	expect(res.status).toBe(200);
	const data = (await res.json()) as { data: Array<{ id: string }> };
	return data.data.map((m) => m.id);
}

async function putJson(path: string, body: unknown): Promise<Response> {
	return fetch(`http://127.0.0.1:${GW_PORT}${path}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function chat(model: string): Promise<Response> {
	return fetch(`http://127.0.0.1:${GW_PORT}/v1/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content: "hi" }],
		}),
	});
}

describe("Model Governance — config & catalog endpoints", () => {
	test("GET /api/dashboard/models/config returns the current (default) filter", async () => {
		const res = await fetch(
			`http://127.0.0.1:${GW_PORT}/api/dashboard/models/config`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			modelFilter: { whitelist: Record<string, string[]>; blacklist: string[] };
		};
		expect(body.modelFilter.whitelist).toEqual({});
		expect(body.modelFilter.blacklist).toEqual([]);
	});

	test("GET /api/dashboard/models/catalogs aggregates every upstream catalog", async () => {
		const res = await fetch(
			`http://127.0.0.1:${GW_PORT}/api/dashboard/models/catalogs`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { catalogs: Record<string, string[]> };
		expect(Object.keys(body.catalogs).sort()).toEqual(["omp", "vansrouter"]);
		expect(body.catalogs.omp).toEqual([...OMP_MODELS].sort());
		expect(body.catalogs.vansrouter).toEqual([...VANS_MODELS].sort());
	});
});

describe("Model Governance — whitelist semantics", () => {
	test("empty whitelist = passthrough (all models visible in /v1/models)", async () => {
		const ids = await fetchModels();
		for (const id of [...OMP_MODELS, ...VANS_MODELS]) {
			expect(ids).toContain(id);
		}
	});

	test("PUT whitelist restricts /v1/models to the listed models only", async () => {
		const put = await putJson("/api/dashboard/models/whitelist", {
			upstream: "omp",
			models: ["omp/model-a"],
		});
		expect(put.status).toBe(200);

		const ids = await fetchModels();
		expect(ids).toContain("omp/model-a");
		expect(ids).not.toContain("omp/model-b");
		expect(ids).not.toContain("omp/blocked");
		// vansrouter has no whitelist entry => still passthrough.
		expect(ids).toContain("vans/model-c");
	});

	test("GET config reflects the persisted whitelist", async () => {
		const res = await fetch(
			`http://127.0.0.1:${GW_PORT}/api/dashboard/models/config`,
		);
		const body = (await res.json()) as {
			modelFilter: { whitelist: Record<string, string[]> };
		};
		expect(body.modelFilter.whitelist.omp).toEqual(["omp/model-a"]);
	});

	test("whitelist change is persisted to the isolated config file", () => {
		expect(existsSync(CONFIG_PATH)).toBe(true);
		const persisted = readPersistedConfig() as any;
		expect(persisted.gateway.modelFilter.whitelist.omp).toEqual([
			"omp/model-a",
		]);
	});

	test("whitelist does NOT gate proxy traffic (only blacklist rejects)", async () => {
		// omp/model-b is not whitelisted, yet is not blacklisted => proxy allows it.
		const res = await chat("omp/model-b");
		expect(res.status).toBe(200);
	});
});

describe("Model Governance — blacklist semantics", () => {
	test("PUT blacklist removes models from /v1/models (overrides whitelist)", async () => {
		const put = await putJson("/api/dashboard/models/blacklist", {
			models: ["omp/model-a", "vans/model-c"],
		});
		expect(put.status).toBe(200);

		const ids = await fetchModels();
		expect(ids).not.toContain("omp/model-a");
		expect(ids).not.toContain("vans/model-c");
		// Remaining omp models were already excluded by the narrowed whitelist.
		expect(ids).not.toContain("omp/model-b");
		expect(ids).not.toContain("omp/blocked");
		expect(ids).toEqual([]);
	});

	test("blacklisted model is rejected at proxy with HTTP 403", async () => {
		const res = await chat("omp/model-a");
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("model_blacklisted");
	});

	test("blacklist is global across upstreams", async () => {
		const res = await chat("vans/model-c");
		expect(res.status).toBe(403);
	});

	test("non-blacklisted model still proxies successfully", async () => {
		const res = await chat("omp/model-b");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { model: string };
		expect(body.model).toBe("omp/model-b");
	});

	test("blacklist change is persisted to the isolated config file", () => {
		const persisted = readPersistedConfig() as any;
		expect(persisted.gateway.modelFilter.blacklist).toEqual([
			"omp/model-a",
			"vans/model-c",
		]);
	});
});
