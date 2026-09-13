/**
 * ─────────────────────────────────────────────────────────────
 * Goblin Nexus — Master Gateway Interceptor Server
 * ─────────────────────────────────────────────────────────────
 */

import { GN_VERSION } from "../version";
import { PromptCacheManager } from "./cache";
import {
	getUnifiedConfigPath,
	loadGatewayRules,
	loadPrivacyHeaders,
} from "./rules";
import { FixtureManager } from "./replay";
import { AccessLogManager } from "./access-log";
import type {
	GatewayServerConfig,
	GatewayStats,
	ResolvedRoute,
	UpstreamTarget,
} from "./types";
import {
	buildUpstreamUrl,
	collectCatalogs,
	loadUpstreamsFromConfig,
	resolveAuthHeaders,
	resolveUpstreamForModel,
} from "./upstream-router";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
	GatewayContext,
	GatewayEventBus,
	GatewayEventPayload,
} from "./context";
import { handleStaticSpa, handleStaticAsset } from "./routes/static";
import { handleAgentsTelemetry } from "./routes/agents";
import { handlePingTree, handlePingProbe } from "./routes/ping-probe";
import { handleDashboardApi } from "./routes/dashboard";
import { defaultCommandCodeAdapter } from "../adapters/commandcode";
import { handleModelsCatalog, handleModelDetail } from "./routes/models";
import { handleProxyRequest } from "./routes/proxy";
import { isStaticAssetPath, isProbePath } from "./access-log";

function detectWebDistDir(): string | undefined {
	try {
		const candidate = join(import.meta.dir, "..", "..", "web", "dist");
		if (existsSync(candidate)) return candidate;
	} catch {
		// ignore
	}
	return undefined;
}

/**
 * Baca env var berlapis: var `NEXUS_*` diutamakan, lalu fallback ke
 * `GN_*` legacy. Mengembalikan nilai pertama yang terdefinisi.
 */
function envLayered(nexusVar: string, gnVar: string, fallback: string): string {
	return process.env[nexusVar] ?? process.env[gnVar] ?? fallback;
}

/** Varian `envLayered` yang mengembalikan `undefined` bila tak ada var. */
function envLayeredOpt(nexusVar: string, gnVar: string): string | undefined {
	return process.env[nexusVar] ?? process.env[gnVar];
}

/**
 * Zero-dependency in-process event bus. Handlers are stored in a Set so
 * duplicate subscriptions are idempotent and no dependency is added.
 */
export function createEventBus(): GatewayEventBus {
	const handlers = new Set<(event: GatewayEventPayload) => void>();
	return {
		subscribe(handler) {
			handlers.add(handler);
			return () => {
				handlers.delete(handler);
			};
		},
		emit(event) {
			for (const handler of handlers) {
				try {
					handler(event);
				} catch {
					// A faulty subscriber must never break the request pipeline.
				}
			}
		},
		subscriberCount() {
			return handlers.size;
		},
	};
}

export function createGatewayServer(
	customConfig: Partial<GatewayServerConfig> = {},
) {
	const portRaw = envLayered("NEXUS_GATEWAY_PORT", "GN_GATEWAY_PORT", "4010");
	const targetHostRaw = envLayered(
		"NEXUS_GATEWAY_TARGET_HOST",
		"GN_GATEWAY_TARGET_HOST",
		"127.0.0.1",
	);
	const targetPortRaw = envLayered(
		"NEXUS_GATEWAY_TARGET_PORT",
		"GN_GATEWAY_TARGET_PORT",
		"4000",
	);
	const cacheEnabledRaw = envLayeredOpt(
		"NEXUS_GATEWAY_CACHE_ENABLED",
		"GN_GATEWAY_CACHE_ENABLED",
	);
	const shieldEnabledRaw = envLayeredOpt(
		"NEXUS_GATEWAY_SHIELD_ENABLED",
		"GN_GATEWAY_SHIELD_ENABLED",
	);
	const modeRaw = envLayered("NEXUS_GATEWAY_MODE", "GN_GATEWAY_MODE", "live");
	const webDistRaw =
		envLayeredOpt("NEXUS_GATEWAY_WEB_DIST_DIR", "GN_GATEWAY_WEB_DIST_DIR") ??
		envLayeredOpt("NEXUS_GATEWAY_WEB_DIST", "GN_GATEWAY_WEB_DIST") ??
		detectWebDistDir();

	const config: GatewayServerConfig = {
		port: customConfig.port ?? parseInt(portRaw, 10),
		targetHost: customConfig.targetHost ?? targetHostRaw,
		targetPort: customConfig.targetPort ?? parseInt(targetPortRaw, 10),
		cacheEnabled:
			customConfig.cacheEnabled ??
			(cacheEnabledRaw ? cacheEnabledRaw === "true" : true),
		cacheTtlMs:
			customConfig.cacheTtlMs ??
			parseInt(
				envLayered(
					"NEXUS_GATEWAY_CACHE_TTL_MS",
					"GN_GATEWAY_CACHE_TTL_MS",
					"7200000",
				),
				10,
			),
		cacheDir:
			customConfig.cacheDir ??
			envLayered("NEXUS_GATEWAY_CACHE_DIR", "GN_GATEWAY_CACHE_DIR", ""),
		fixturesDir:
			customConfig.fixturesDir ??
			envLayered("NEXUS_GATEWAY_FIXTURES_DIR", "GN_GATEWAY_FIXTURES_DIR", ""),
		mode:
			customConfig.mode ??
			(["live", "mock", "record"].includes(modeRaw)
				? (modeRaw as GatewayServerConfig["mode"])
				: "live"),
		mockFixtureFile:
			customConfig.mockFixtureFile ??
			envLayeredOpt("NEXUS_GATEWAY_MOCK_FIXTURE", "GN_GATEWAY_MOCK_FIXTURE"),
		shieldEnabled:
			customConfig.shieldEnabled ??
			(shieldEnabledRaw !== undefined ? shieldEnabledRaw !== "false" : true),
		sanitizeLogsOnly:
			customConfig.sanitizeLogsOnly ??
			envLayered(
				"NEXUS_GATEWAY_SHIELD_LOGS_ONLY",
				"GN_GATEWAY_SHIELD_LOGS_ONLY",
				"false",
			) === "true",
		webDistDir: customConfig.webDistDir ?? webDistRaw,
		accessLogPath: customConfig.accessLogPath,
	};

	const startTime = Date.now();
	let rules = { ...loadGatewayRules() };
	const privacyHeaders = loadPrivacyHeaders();
	const cacheManager = new PromptCacheManager(
		config.cacheDir ? config.cacheDir : undefined,
		config.cacheTtlMs,
	);
	const fixtureManager = new FixtureManager(
		config.fixturesDir ? config.fixturesDir : undefined,
	);
	const accessLog = new AccessLogManager(customConfig.accessLogPath);

	// Multi-upstream hybrid router state
	let upstreams: UpstreamTarget[] = [];
	const defaultName = "omp";
	if (customConfig.upstreams && customConfig.upstreams.length > 0) {
		upstreams = [...customConfig.upstreams];
	} else if (customConfig.targetPort && customConfig.targetPort !== 4000) {
		upstreams = [
			{
				name: defaultName,
				host: customConfig.targetHost || "127.0.0.1",
				port: customConfig.targetPort,
				basePath: "/v1",
			},
			{
				name: "vansrouter",
				host: "127.0.0.1",
				port: 20128,
				basePath: "/api/v1",
			},
		];
	} else {
		try {
			const cfgPath = getUnifiedConfigPath();
			const rawConfig = cfgPath
				? JSON.parse(readFileSync(cfgPath, "utf-8"))
				: {};
			upstreams = loadUpstreamsFromConfig(rawConfig);
		} catch {
			upstreams = loadUpstreamsFromConfig({});
		}
	}

	if (!upstreams.some((u) => u.name === defaultName)) {
		upstreams = [
			...upstreams,
			{
				name: defaultName,
				host: "127.0.0.1",
				port: config.targetPort,
				basePath: "/v1",
			},
		];
	}

	if (
		!customConfig.upstreams &&
		defaultCommandCodeAdapter.isAvailable() &&
		!upstreams.some((u) => u.name === "commandcode" || u.name === "cmc")
	) {
		upstreams = [
			...upstreams,
			{
				name: "commandcode",
				host: "api.commandcode.ai",
				port: 443,
				basePath: "/alpha",
			},
		];
	}

	const CATALOG_TTL_MS = 30_000;
	let catalogCache: Map<string, Set<string>> = new Map();
	let lastCatalogFetch = 0;
	let catalogFetchPromise: Promise<Map<string, Set<string>>> | null = null;

	const authHeaderCache = new Map<
		string,
		{ headers: Record<string, string>; at: number }
	>();
	const AUTH_CACHE_TTL_MS = 5 * 60_000;

	async function getAuthHeadersFor(
		upstream: UpstreamTarget,
	): Promise<Record<string, string>> {
		const cached = authHeaderCache.get(upstream.name);
		if (cached && Date.now() - cached.at < AUTH_CACHE_TTL_MS) {
			return cached.headers;
		}
		const headers = await resolveAuthHeaders(upstream);
		authHeaderCache.set(upstream.name, { headers, at: Date.now() });
		return headers;
	}

	async function getCatalog(): Promise<Map<string, Set<string>>> {
		const now = Date.now();
		if (catalogFetchPromise) return catalogFetchPromise;
		if (now - lastCatalogFetch < CATALOG_TTL_MS) return catalogCache;

		catalogFetchPromise = collectCatalogs(upstreams)
			.then((map) => {
				catalogCache = map;
				lastCatalogFetch = Date.now();
				return map;
			})
			.catch(() => catalogCache)
			.finally(() => {
				catalogFetchPromise = null;
			});
		return catalogFetchPromise;
	}

	function updateCatalogCache(map: Map<string, Set<string>>) {
		catalogCache = map;
		lastCatalogFetch = Date.now();
	}

	async function resolveRouteForRequest(
		reqPath: string,
		search: string,
		modelId: string | null,
	): Promise<ResolvedRoute> {
		let target = upstreams.find((u) => u.name === defaultName) ?? upstreams[0];
		try {
			const catalog = await getCatalog();
			target = resolveUpstreamForModel(
				upstreams,
				catalog,
				modelId,
				defaultName,
			);
		} catch {
			// fallback
		}
		const authHeaders = await getAuthHeadersFor(target);
		return {
			upstream: target,
			url: buildUpstreamUrl(target, reqPath, search),
			authHeaders,
		};
	}

	const stats: GatewayStats = {
		uptimeSeconds: 0,
		totalRequests: 0,
		cacheHits: 0,
		cacheMisses: 0,
		fallbacksTriggered: 0,
		activeStreams: 0,
		errorsCount: 0,
		mode: config.mode,
	};

	let serverInstance: any = null;
	let gatewayContext: GatewayContext | null = null;

	const server = {
		/**
		 * The live GatewayContext, available only after start().
		 * Exposes the event bus and shared managers to tests and future
		 * in-process consumers.
		 */
		get context(): GatewayContext {
			if (!gatewayContext) {
				throw new Error("Gateway context is only available after start()");
			}
			return gatewayContext;
		},

		getStats(): GatewayStats {
			return {
				...stats,
				uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
			};
		},

		stop() {
			if (serverInstance) {
				serverInstance.stop(true);
				serverInstance = null;
			}
			gatewayContext = null;
		},

		start() {
			const ctx: GatewayContext = {
				config,
				rules,
				privacyHeaders,
				upstreams,
				defaultName,
				stats,
				startTime,
				cacheManager,
				accessLog,
				fixtureManager,
				eventBus: createEventBus(),
				getAuthHeadersFor,
				getCatalog,
				updateCatalogCache,
				resolveRouteForRequest,
				getRequestIP(req: Request) {
					return serverInstance?.requestIP(req)?.address ?? null;
				},
				reloadRules() {
					rules = { ...loadGatewayRules() };
					ctx.rules = rules;
				},
				getStats() {
					return server.getStats();
				},
			};
			gatewayContext = ctx;

			serverInstance = Bun.serve({
				port: config.port,
				hostname: envLayered(
					"NEXUS_GATEWAY_HOST",
					"GN_GATEWAY_HOST",
					"0.0.0.0",
				),
				idleTimeout: 255,
				async fetch(req) {
					const reqStartTime = Date.now();
					const url = new URL(req.url);
					const method = req.method.toUpperCase();

					// Only count real LLM/API traffic towards totalRequests; skip
					// dashboard, SSE, static assets, and discovery probes.
					if (
						url.pathname !== "/api/gateway/events" &&
						!url.pathname.startsWith("/api/dashboard") &&
						!url.pathname.startsWith("/dashboard") &&
						!isStaticAssetPath(url.pathname) &&
						!isProbePath(url.pathname)
					) {
						stats.totalRequests++;
					}

					// Health / Status Endpoints (dual: /nexus/health + legacy /gn/health)
					if (
						url.pathname === "/health" ||
						url.pathname === "/nexus/health" ||
						url.pathname === "/gn/health"
					) {
						return new Response(
							JSON.stringify({
								status: "ok",
								version: GN_VERSION,
								port: config.port,
								target: `http://${config.targetHost}:${config.targetPort}`,
								upstreams: upstreams.map((u) => ({
									name: u.name,
									url: `http://${u.host}:${u.port}${u.basePath}`,
								})),
								uptime: Math.floor((Date.now() - startTime) / 1000),
								mode: config.mode,
								cacheEnabled: config.cacheEnabled,
								shieldEnabled: config.shieldEnabled,
							}),
							{
								status: 200,
								headers: { "content-type": "application/json" },
							},
						);
					}

					if (url.pathname === "/nexus/stats" || url.pathname === "/gn/stats") {
						return new Response(JSON.stringify(server.getStats(), null, 2), {
							status: 200,
							headers: { "content-type": "application/json" },
						});
					}

					// ── Lightweight discovery probes (Ollama/agent compatible) ──
					// Answered directly so they never reach the proxy or access log.
					if (method === "GET" && url.pathname === "/api/tags") {
						return new Response(JSON.stringify({ models: [] }), {
							status: 200,
							headers: { "content-type": "application/json" },
						});
					}

					if (method === "GET" && url.pathname === "/version") {
						return new Response(JSON.stringify({ version: GN_VERSION }), {
							status: 200,
							headers: { "content-type": "application/json" },
						});
					}

					if (
						method === "GET" &&
						(url.pathname === "/props" || url.pathname === "/v1/props")
					) {
						return new Response(
							JSON.stringify({ status: "ok", version: GN_VERSION }),
							{
								status: 200,
								headers: { "content-type": "application/json" },
							},
						);
					}

					// ── Dashboard REST APIs ──────────────────────────────
					if (url.pathname === "/api/dashboard/agents") {
						return handleAgentsTelemetry(req, url, ctx);
					}

					if (url.pathname === "/api/dashboard/ping/tree" && method === "GET") {
						return handlePingTree(req, url, ctx);
					}

					if (
						url.pathname === "/api/dashboard/ping/probe" &&
						method === "POST"
					) {
						return handlePingProbe(req, url, ctx);
					}

					if (
						url.pathname === "/api/gateway/events" ||
						url.pathname.startsWith("/api/dashboard")
					) {
						const dashResp = await handleDashboardApi(req, url, ctx);
						if (dashResp) return dashResp;
					}

					// ── Static SPA web console (/dashboard/*) ────────────
					if (
						ctx.config.webDistDir &&
						(url.pathname === "/dashboard" ||
							url.pathname === "/dashboard/" ||
							url.pathname.startsWith("/dashboard/"))
					) {
						const staticResp = await handleStaticSpa(req, url, ctx);
						if (staticResp) return staticResp;
					}

					// ── Static bundle assets (JS/CSS/images/fonts, /assets/*) ──
					// Served from web/dist and 404 when missing; never proxied.
					if (isStaticAssetPath(url.pathname)) {
						return handleStaticAsset(req, url, ctx);
					}

					// ── Unified /v1/models catalog aggregator ───────────
					if (
						method === "GET" &&
						(url.pathname === "/v1/models" || url.pathname.endsWith("/models"))
					) {
						return handleModelsCatalog(req, url, ctx);
					}

					// ── Single model detail probe (/v1/models/:model) ───
					if (
						method === "GET" &&
						url.pathname.startsWith("/v1/models/")
					) {
						return handleModelDetail(req, url, ctx);
					}

					// ── Core Reverse Proxy Hot Path (/v1/chat/completions & /v1/messages) ──
					return handleProxyRequest(req, url, ctx, reqStartTime);
				},
			});

			return serverInstance;
		},
	};

	return server;
}
