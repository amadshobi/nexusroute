/**
 * ─────────────────────────────────────────────────────────────
 * NexusRoute — Agent Probes, Static Assets & Access Log Filtering
 * ─────────────────────────────────────────────────────────────
 *
 * Covers:
 *   - GET /v1/models/:model single-model detail probe
 *   - GET /api/tags, /version, /props, /v1/props discovery probes
 *   - Static asset routing (serve from dist, 404 when missing)
 *   - Access log filtering of internal/static/probe paths
 *
 * Strictly ephemeral: dynamic gateway port, no live network dependencies.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGatewayServer } from "../../src/gateway/server";
import {
	AccessLogManager,
	isInternalRequestPath,
	isStaticAssetPath,
	isProbePath,
	type AccessLogEntry,
} from "../../src/gateway/access-log";

const TEST_DIR = join(process.cwd(), ".tmp-test-gateway");
const CONFIG_PATH = join(TEST_DIR, "probes-isolated-config.json");
process.env.NEXUS_CONFIG_PATH = CONFIG_PATH;
process.env.GN_CONFIG_PATH = CONFIG_PATH;

if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
writeFileSync(
	CONFIG_PATH,
	JSON.stringify({ gateway: { enabled: true, modelFilter: { whitelist: {}, blacklist: [] } } }),
);

describe("1. Internal request path classification", () => {
	test("flags static asset extensions and /assets paths", () => {
		expect(isStaticAssetPath("/assets/index-abc.js")).toBe(true);
		expect(isStaticAssetPath("/favicon.ico")).toBe(true);
		expect(isStaticAssetPath("/logo.svg")).toBe(true);
		expect(isStaticAssetPath("/fonts/inter.woff2")).toBe(true);
		expect(isStaticAssetPath("/style.css")).toBe(true);
		expect(isStaticAssetPath("/v1/chat/completions")).toBe(false);
	});

	test("flags discovery probe paths", () => {
		expect(isProbePath("/api/tags")).toBe(true);
		expect(isProbePath("/version")).toBe(true);
		expect(isProbePath("/props")).toBe(true);
		expect(isProbePath("/v1/props")).toBe(true);
		expect(isProbePath("/v1/chat/completions")).toBe(false);
	});

	test("isInternalRequestPath combines dashboard, assets, and probes", () => {
		expect(isInternalRequestPath("/dashboard/index.html")).toBe(true);
		expect(isInternalRequestPath("/dashboard/assets/x.css")).toBe(true);
		expect(isInternalRequestPath("/assets/app.js")).toBe(true);
		expect(isInternalRequestPath("/api/tags")).toBe(true);
		expect(isInternalRequestPath("/v1/chat/completions")).toBe(false);
	});

	test("AccessLogManager.write drops internal paths", () => {
		const logFile = join(TEST_DIR, "probes-access.jsonl");
		if (existsSync(logFile)) rmSync(logFile, { force: true });
		const manager = new AccessLogManager(logFile);

		const internal: AccessLogEntry = {
			ts: Date.now(),
			method: "GET",
			path: "/assets/index-abc.js",
			initialModel: "unknown",
			servedModel: "unknown",
			status: 200,
			latencyMs: 1,
			cache: "NONE",
			stream: false,
			shieldRedacted: 0,
		};
		const probe: AccessLogEntry = { ...internal, path: "/api/tags" };
		const real: AccessLogEntry = {
			...internal,
			path: "/v1/chat/completions",
			initialModel: "deepseek/deepseek-v4-flash",
		};

		manager.write(internal);
		manager.write(probe);
		manager.write(real);

		const logs = manager.readLogs({ limit: 10 });
		expect(logs.length).toBe(1);
		expect(logs[0].path).toBe("/v1/chat/completions");

		rmSync(logFile, { force: true });
	});
});

describe("2. Probe & model-detail endpoints", () => {
	let gateway: ReturnType<typeof createGatewayServer>;
	let baseUrl = "";

	beforeAll(() => {
		gateway = createGatewayServer({
			port: 0,
			cacheEnabled: false,
			shieldEnabled: false,
			mode: "live",
			upstreams: [{ name: "omp", host: "127.0.0.1", port: 1, basePath: "/v1" }],
		});
		const instance = gateway.start();
		baseUrl = `http://127.0.0.1:${instance.port}`;
	});

	afterAll(() => {
		gateway?.stop();
		if (existsSync(CONFIG_PATH)) rmSync(CONFIG_PATH, { force: true });
	});

	test("GET /v1/models/:model returns a model detail object", async () => {
		const res = await fetch(
			`${baseUrl}/v1/models/google-antigravity/gemini-3.8-flash`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/json");
		const data: any = await res.json();
		expect(data.id).toBe("google-antigravity/gemini-3.8-flash");
		expect(data.object).toBe("model");
		expect(data.owned_by).toBe("antigravity");
		expect(typeof data.created).toBe("number");
	});

	test("GET /api/tags returns an empty model list", async () => {
		const res = await fetch(`${baseUrl}/api/tags`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(await res.json()).toEqual({ models: [] });
	});

	test("GET /version returns the gateway version", async () => {
		const res = await fetch(`${baseUrl}/version`);
		expect(res.status).toBe(200);
		const data: any = await res.json();
		expect(typeof data.version).toBe("string");
		expect(data.version.length).toBeGreaterThan(0);
	});

	test("GET /props and /v1/props return ok status", async () => {
		for (const path of ["/props", "/v1/props"]) {
			const res = await fetch(`${baseUrl}${path}`);
			expect(res.status).toBe(200);
			const data: any = await res.json();
			expect(data.status).toBe("ok");
			expect(typeof data.version).toBe("string");
		}
	});

	test("unknown static asset returns 404 without proxying", async () => {
		const res = await fetch(`${baseUrl}/assets/does-not-exist.js`);
		expect(res.status).toBe(404);
	});
});

describe("3. Static asset serving from dist", () => {
	let gateway: ReturnType<typeof createGatewayServer>;
	let baseUrl = "";
	const distDir = join(TEST_DIR, "probes-dist");

	beforeAll(() => {
		mkdirSync(join(distDir, "assets"), { recursive: true });
		writeFileSync(join(distDir, "index.html"), "<html>spa</html>");
		writeFileSync(join(distDir, "assets", "app.js"), "console.log('ok')");
		writeFileSync(join(distDir, "favicon.ico"), "icon");

		gateway = createGatewayServer({
			port: 0,
			cacheEnabled: false,
			shieldEnabled: false,
			mode: "live",
			webDistDir: distDir,
			upstreams: [{ name: "omp", host: "127.0.0.1", port: 1, basePath: "/v1" }],
		});
		const instance = gateway.start();
		baseUrl = `http://127.0.0.1:${instance.port}`;
	});

	afterAll(() => {
		gateway?.stop();
		if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
	});

	test("serves a real dist asset", async () => {
		const res = await fetch(`${baseUrl}/assets/app.js`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("console.log('ok')");
	});

	test("serves a root-level static file", async () => {
		const res = await fetch(`${baseUrl}/favicon.ico`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("icon");
	});

	test("serves the dashboard SPA shell", async () => {
		const res = await fetch(`${baseUrl}/dashboard/`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("spa");
	});
});
