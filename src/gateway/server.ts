/**
 * ─────────────────────────────────────────────────────────────
 * Goblin Nexus — Master Gateway Interceptor Server
 * ─────────────────────────────────────────────────────────────
 */

import { calculateCost } from "../../telemetry/pricing";
import { logTelemetry } from "../../telemetry/db";
import { GN_VERSION } from "../version";
import {
	computePromptHash,
	formatCachedStreamChunks,
	PromptCacheManager,
} from "./cache";
import {
	buildFallbackBody,
	extractModelFromBody,
	recordModelFailure,
	recordModelSuccess,
	resolveFallbackCandidates,
	shouldTriggerFallback,
} from "./circuit-breaker";
import {
	DEFAULT_FALLBACK,
	getUnifiedConfigPath,
	loadGatewayRules,
	loadPrivacyHeaders,
	saveGatewayConfig,
} from "./rules";
import { FixtureManager } from "./replay";
import { sanitizeText, normalizeUpstreamTools } from "./sanitizer";
import { AccessLogManager, type FallbackHop } from "./access-log";
import { defaultPricingEngine } from "./openrouter-pricing";
import type { GatewayServerConfig, GatewayStats } from "./types";
import {
	buildUpstreamUrl,
	collectCatalogs,
	fetchUpstreamCatalog,
	loadUpstreamsFromConfig,
	mergeModelResponses,
	resolveAuthHeaders,
	resolveUpstreamForModel,
} from "./upstream-router";
import { readFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, sep } from "node:path";
import { defaultQuotaRegistry } from "../quota";

/**
 * Check if a model is allowed by the whitelist.
 * Empty whitelist for an upstream = all models pass.
 */
function isModelWhitelisted(
	modelId: string,
	upstreamName: string,
	modelFilter: import("./types").ModelFilterConfig | undefined,
): boolean {
	if (!modelFilter) return true;
	const whitelist = modelFilter.whitelist;
	if (!whitelist) return true;
	const allowed = whitelist[upstreamName];
	if (!allowed || allowed.length === 0) return true;
	return allowed.includes(modelId);
}

/**
 * Check if a model is in the global blacklist.
 */
function isModelBlacklisted(
	modelId: string,
	modelFilter: import("./types").ModelFilterConfig | undefined,
): boolean {
	if (!modelFilter) return false;
	const blacklist = modelFilter.blacklist;
	if (!blacklist || blacklist.length === 0) return false;
	return blacklist.includes(modelId);
}

/**
 * Hitung batas waktu milidetik sesuai zona WIB (UTC+7).
 * Module scope agar tidak dibuat ulang pada setiap request di hot path.
 */
function parseTimeBounds(range: string | null): {
	startMs: number;
	endMs: number;
} {
	const now = Date.now();
	// Hitung start hari ini WIB (UTC+7) secara presisi
	const msPerDay = 24 * 3600 * 1000;
	const wibOffsetMs = 7 * 3600 * 1000;
	const startOfTodayWib =
		Math.floor((now + wibOffsetMs) / msPerDay) * msPerDay - wibOffsetMs;
	const startOfYesterdayWib = startOfTodayWib - msPerDay;

	switch (range) {
		case "15m":
			return { startMs: now - 15 * 60 * 1000, endMs: now };
		case "today":
			return { startMs: startOfTodayWib, endMs: now };
		case "yesterday":
			return { startMs: startOfYesterdayWib, endMs: startOfTodayWib };
		case "24h":
			return { startMs: now - 24 * 3600000, endMs: now };
		case "7d":
			return { startMs: now - 7 * 24 * 3600000, endMs: now };
		case "30d":
			return { startMs: now - 30 * 24 * 3600000, endMs: now };
		case "all":
		default:
			return { startMs: 0, endMs: Infinity };
	}
}

/**
 * Cek apakah alamat IP merupakan loopback (localhost).
 * Menormalkan bentuk IPv4-mapped IPv6 (::ffff:127.0.0.1).
 */
function isLocalhostAddress(address: string | null | undefined): boolean {
	if (!address) return false;
	const normalized = address.startsWith("::ffff:")
		? address.slice("::ffff:".length)
		: address;
	// Loopback
	if (
		normalized === "127.0.0.1" ||
		normalized === "::1" ||
		normalized === "localhost"
	) {
		return true;
	}
	// Private LAN networks (RFC 1918)
	if (
		normalized.startsWith("192.168.") ||
		normalized.startsWith("10.") ||
		/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(normalized)
	) {
		return true;
	}
	return false;
}

export function createGatewayServer(
	customConfig: Partial<GatewayServerConfig> = {},
) {
	const config: GatewayServerConfig = {
		port:
			customConfig.port ?? parseInt(process.env.GN_GATEWAY_PORT || "4010", 10),
		targetHost:
			customConfig.targetHost ??
			(process.env.GN_GATEWAY_TARGET_HOST || "127.0.0.1"),
		targetPort:
			customConfig.targetPort ??
			parseInt(process.env.GN_GATEWAY_TARGET_PORT || "4000", 10),
		cacheEnabled: customConfig.cacheEnabled ?? true,
		cacheTtlMs: customConfig.cacheTtlMs ?? 2 * 60 * 60 * 1000,
		cacheDir: customConfig.cacheDir ?? "",
		fixturesDir: customConfig.fixturesDir ?? "",
		mode: customConfig.mode ?? "live",
		mockFixtureFile: customConfig.mockFixtureFile,
		shieldEnabled: customConfig.shieldEnabled ?? true,
		sanitizeLogsOnly: customConfig.sanitizeLogsOnly ?? false,
		webDistDir:
			customConfig.webDistDir ??
			process.env.GN_GATEWAY_WEB_DIST ??
			detectWebDistDir(),
	};

	function detectWebDistDir(): string {
		try {
			const candidate = join(import.meta.dir, "..", "..", "web", "dist");
			if (existsSync(candidate)) {
				return candidate;
			}
		} catch {
			// Abaikan dan nonaktifkan SPA serving
		}
		return "";
	}

	const startTime = Date.now();
	let rules = loadGatewayRules();
	const privacyHeaders = loadPrivacyHeaders();
	const cacheManager = new PromptCacheManager(
		config.cacheDir ? config.cacheDir : undefined,
		config.cacheTtlMs,
	);
	const fixtureManager = new FixtureManager(
		config.fixturesDir ? config.fixturesDir : undefined,
	);
	const accessLog = new AccessLogManager(customConfig.accessLogPath);

	// ── Multi-upstream hybrid router state (Issue #38) ─────────────
	// Prioritas definisi upstream:
	//   1. customConfig.upstreams (dipakai test / embedding)
	//   2. Legacy single-upstream: targetHost/targetPort customConfig dipakai
	//      sebagai upstream "omp" (hindari tabrakan dgn OMP asli saat test)
	//   3. Config unified user (~/.config/gn/config.json), default OMP+Vans
	let upstreams: ReturnType<typeof loadUpstreamsFromConfig> = [];
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
	// Pastikan upstream default (omp) selalu ada sebagai fallback route.
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

	const CATALOG_TTL_MS = 30_000; // Refresh catalog tiap 30 detik max
	let catalogCache: Map<string, Set<string>> = new Map();
	let lastCatalogFetch = 0;
	let catalogFetchPromise: Promise<Map<string, Set<string>>> | null = null;

	// Auth headers di-memoize per upstream (jarang berubah; buka DB Vans mahal).
	const authHeaderCache = new Map<
		string,
		{ headers: Record<string, string>; at: number }
	>();
	const AUTH_CACHE_TTL_MS = 5 * 60_000;

	async function getAuthHeadersFor(
		upstream: (typeof upstreams)[number],
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
			.catch(() => catalogCache) // Jangan biarkan catalog error merusak request
			.finally(() => {
				catalogFetchPromise = null;
			});
		return catalogFetchPromise;
	}

	async function resolveRouteForRequest(
		reqPath: string,
		search: string,
		modelId: string | null,
	): Promise<{
		upstream: (typeof upstreams)[number];
		url: string;
		authHeaders: Record<string, string>;
	}> {
		// Coba resolve via catalog dulu (best-effort, jangan block request lama).
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
			// Default fallback bila catalog gagal
		}
		const authHeaders = await getAuthHeadersFor(target);
		return {
			upstream: target,
			url: buildUpstreamUrl(target, reqPath, search),
			authHeaders,
		};
	}

	// ── End multi-upstream state ────────────────────────────────────

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

	/**
	 * Cek apakah request berasal dari loopback. Endpoint control-plane yang
	 * berbahaya (restart, mutasi policy model) hanya boleh diakses dari lokal.
	 */
	function isLocalhostRequest(req: Request): boolean {
		const clientIp =
			serverInstance?.requestIP(req)?.address ||
			req.headers.get("x-forwarded-for") ||
			"127.0.0.1";
		return isLocalhostAddress(clientIp);
	}

	function splitProviderModel(model: string): {
		provider: string;
		model: string;
	} {
		if (!model || typeof model !== "string")
			return { provider: "unknown", model: "unknown" };
		const slashIdx = model.indexOf("/");
		if (slashIdx > 0 && slashIdx < model.length - 1) {
			return {
				provider: model.slice(0, slashIdx),
				model: model.slice(slashIdx + 1),
			};
		}
		return { provider: "unknown", model };
	}

	function fireTelemetry(
		modelString: string,
		bodyText: string,
		statusCode: number,
		latencyMs: number,
	) {
		try {
			const parsed = JSON.parse(bodyText);
			const usage = parsed?.usage;
			if (!usage) return;

			const { provider, model } = splitProviderModel(modelString);
			const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
			const completionTokens =
				usage.completion_tokens ?? usage.output_tokens ?? 0;
			const cacheReadTokens =
				usage.prompt_tokens_details?.cached_tokens ??
				usage.cache_read_input_tokens ??
				0;
			const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
			const totalTokens =
				usage.total_tokens ??
				promptTokens + completionTokens + cacheReadTokens + cacheWriteTokens;

			const cost = calculateCost(
				provider,
				model,
				promptTokens,
				completionTokens,
				cacheReadTokens + cacheWriteTokens,
			);

			logTelemetry({
				provider,
				model,
				clientApp: "gn-gateway",
				promptTokens,
				completionTokens,
				cacheReadTokens,
				cacheWriteTokens,
				totalTokens,
				costUsd: cost.total,
				latencyMs,
				statusCode,
				timestamp: Date.now(),
			});
		} catch {
			// Best-effort
		}
	}

	function buildOutboundHeaders(reqHeaders: Headers): Headers {
		const outbound = new Headers(reqHeaders);
		outbound.delete("host");
		// Strip internal & mock headers
		outbound.delete("x-mock-status");
		outbound.delete("x-force-fallback");
		outbound.delete("X-Mock-Status");
		outbound.delete("X-Force-Fallback");
		outbound.delete("x-gn-no-cache");
		outbound.delete("X-GN-No-Cache");
		outbound.delete("x-gn-fixture");
		outbound.delete("X-GN-Fixture");

		for (const [hKey, hVal] of Object.entries(privacyHeaders)) {
			outbound.set(hKey, hVal);
		}
		return outbound;
	}

	function buildResponseHeaders(upstreamHeaders: Headers): Headers {
		const respHeaders = new Headers(upstreamHeaders);
		for (const [hKey, hVal] of Object.entries(privacyHeaders)) {
			respHeaders.set(hKey, hVal);
		}
		return respHeaders;
	}

	const server = {
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
		},

		start() {
			serverInstance = Bun.serve({
				port: config.port,
				hostname: process.env.GN_GATEWAY_HOST || "0.0.0.0",
				idleTimeout: 255, // Max Bun idleTimeout (255s) to accommodate upstream long-lived SSE streams
				async fetch(req) {
					const reqStartTime = Date.now();
					const url = new URL(req.url);
					const method = req.method.toUpperCase();

					// Only count external/API requests towards totalRequests metric
					if (
						!url.pathname.startsWith("/api/dashboard") &&
						!url.pathname.startsWith("/dashboard")
					) {
						stats.totalRequests++;
					}

					// Health / Status Endpoints
					if (url.pathname === "/health" || url.pathname === "/gn/health") {
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

					if (url.pathname === "/gn/stats") {
						return new Response(JSON.stringify(server.getStats(), null, 2), {
							status: 200,
							headers: { "content-type": "application/json" },
						});
					}

					// ── Dashboard API & SPA serving ──────────────────────
					if (url.pathname === "/api/dashboard/overview") {
						const rangeParam = url.searchParams.get("range") || "all";
						const bounds = parseTimeBounds(rangeParam);
						const svc = server.getStats();
						const cacheCount = config.cacheEnabled ? cacheManager.count() : 0;

						// Scan access.jsonl sesuai range
						let dbTotalRequests = svc.totalRequests;
						let dbTotalTokens = 0;
						let dbInputFreshTokens = 0;
						let dbCacheReadTokens = 0;
						let dbOutputTokens = 0;
						let dbCacheHits = svc.cacheHits;
						let dbMarketCostUsd = 0;

						const bucketCount = 10;
						const now = Date.now();
						let windowStart =
							bounds.startMs > 0 ? bounds.startMs : now - 3600 * 1000;
						let windowEnd = bounds.endMs !== Infinity ? bounds.endMs : now;
						let windowSpan = windowEnd - windowStart;
						let step = windowSpan > 0 ? windowSpan / bucketCount : 1;

						let costSparkline = new Array(bucketCount).fill(0);
						let reqSparkline = new Array(bucketCount).fill(0);
						let tokenSparkline = new Array(bucketCount).fill(0);
						let cacheReadSparkline = new Array(bucketCount).fill(0);
						let inputFreshSparkline = new Array(bucketCount).fill(0);

						try {
							const allLogs = accessLog.readLogs({
								since: bounds.startMs > 0 ? bounds.startMs : undefined,
							});
							const rangedLogs =
								bounds.endMs !== Infinity
									? allLogs.filter((l) => l.ts < bounds.endMs)
									: allLogs;

							dbTotalRequests = rangedLogs.length;
							dbCacheHits = rangedLogs.filter((l) => l.cache === "HIT").length;

							// Compute 10-bucket sparklines across window bounds
							if (bounds.startMs === 0 && rangedLogs.length > 0) {
								windowStart = rangedLogs[0].ts;
								windowSpan = windowEnd - windowStart;
								step = windowSpan > 0 ? windowSpan / bucketCount : 1;
							}

							costSparkline = new Array(bucketCount).fill(0);
							reqSparkline = new Array(bucketCount).fill(0);
							tokenSparkline = new Array(bucketCount).fill(0);
							cacheReadSparkline = new Array(bucketCount).fill(0);
							inputFreshSparkline = new Array(bucketCount).fill(0);

							for (const l of rangedLogs) {
								const inTok = l.tokensInput ?? 0;
								const outTok = l.tokensOutput ?? 0;
								const cacheTok = l.tokensCache ?? 0;
								const reqTokens = l.tokensTotal ?? inTok + outTok + cacheTok;
								dbTotalTokens += reqTokens;
								dbInputFreshTokens += inTok;
								dbCacheReadTokens += cacheTok;
								dbOutputTokens += outTok;

								let reqCost = 0;
								if (inTok > 0 || outTok > 0 || cacheTok > 0) {
									const m = l.servedModel || l.initialModel || "";
									const rates = defaultPricingEngine.resolveModelPricing(m);
									if (rates) {
										reqCost =
											(inTok / 1_000_000) * rates.inputUsdPer1M +
											(outTok / 1_000_000) * rates.outputUsdPer1M +
											(cacheTok / 1_000_000) * rates.cacheReadUsdPer1M;
									} else {
										reqCost = ((inTok + outTok) / 1_000_000) * 1.5;
									}
								}
								dbMarketCostUsd += reqCost;

								const ts = l.ts;
								if (ts >= windowStart && ts <= windowEnd) {
									const idx = Math.min(
										bucketCount - 1,
										Math.max(0, Math.floor((ts - windowStart) / step)),
									);
									reqSparkline[idx] += 1;
									tokenSparkline[idx] += reqTokens;
									costSparkline[idx] += reqCost;
									cacheReadSparkline[idx] += cacheTok;
									inputFreshSparkline[idx] += inTok;
								}
							}
						} catch {
							// fallback
						}

						return new Response(
							JSON.stringify(
								{
									status: "ok",
									version: GN_VERSION,
									uptimeSeconds: svc.uptimeSeconds,
									timeRange: rangeParam,
									totalRequests: dbTotalRequests,
									totalTokens: dbTotalTokens,
									totalSpendUsd: dbMarketCostUsd,
									localSpendUsd: 0,
									savingsUsd: 0,
									tokens: {
										total: dbTotalTokens,
										inputFresh: dbInputFreshTokens,
										cacheRead: dbCacheReadTokens,
										output: dbOutputTokens,
										contextCacheRate:
											dbInputFreshTokens + dbCacheReadTokens > 0
												? Number(
														(
															(dbCacheReadTokens /
																(dbInputFreshTokens + dbCacheReadTokens)) *
															100
														).toFixed(1),
													)
												: 0,
									},
									tokensCacheRead: dbCacheReadTokens,
									tokensInputFresh: dbInputFreshTokens,
									contextCacheRate:
										dbInputFreshTokens + dbCacheReadTokens > 0
											? Number(
													(
														(dbCacheReadTokens /
															(dbInputFreshTokens + dbCacheReadTokens)) *
														100
													).toFixed(1),
												)
											: 0,
									cache: {
										enabled: config.cacheEnabled,
										entries: cacheCount,
										hits: dbCacheHits,
										misses: Math.max(0, dbTotalRequests - dbCacheHits),
									},
									upstreams: upstreams.map((u) => ({
										name: u.name,
										host: u.host,
										port: u.port,
										basePath: u.basePath,
										url: `http://${u.host}:${u.port}${u.basePath}`,
									})),
									stats: {
										fallbacksTriggered: svc.fallbacksTriggered,
										activeStreams: svc.activeStreams,
										errorsCount: svc.errorsCount,
										mode: config.mode,
									},
									sparklines: {
										cost: costSparkline,
										req: reqSparkline,
										tokens: tokenSparkline,
										cacheRead: cacheReadSparkline,
										inputFresh: inputFreshSparkline,
									},
								},
								null,
								2,
							),
							{
								status: 200,
								headers: { "content-type": "application/json" },
							},
						);
					}

					if (url.pathname === "/api/dashboard/agents") {
						const agentType = url.searchParams.get("type") || "all";
						const rangeParam = url.searchParams.get("range") || "all";
						const bounds = parseTimeBounds(rangeParam);
						const result: any = { timeRange: rangeParam };

						if (agentType === "all" || agentType === "opencode") {
							try {
								const { Database } = await import("bun:sqlite");
								const ocDbPath =
									process.env.OPENCODE_DB_PATH ??
									join(homedir(), ".local", "share", "opencode", "opencode.db");
								if (existsSync(ocDbPath)) {
									const ocDb = new Database(ocDbPath, { readonly: true });
									const isAll =
										bounds.startMs === 0 && bounds.endMs === Infinity;
									const isBounded = bounds.endMs !== Infinity;

									let countQ = "SELECT COUNT(*) as count FROM session";
									let msgQ = "SELECT COUNT(*) as count FROM message";
									let statsQ =
										"SELECT SUM(tokens_input) as input, SUM(tokens_output) as output, SUM(cost) as cost FROM session";
									let recentQ = `
										SELECT 
											s.id, 
											s.title, 
											s.time_created, 
											s.time_updated, 
											s.model, 
											s.agent,
											s.cost,
											s.tokens_input, 
											s.tokens_output, 
											s.tokens_reasoning, 
											s.tokens_cache_read, 
											s.tokens_cache_write,
											s.directory,
											s.project_id,
											CASE
												WHEN p.worktree IS NULL OR p.worktree = '/' THEN s.directory
												ELSE p.worktree
											END as project_path,
											p.name as project_name
										FROM session s
										LEFT JOIN project p ON s.project_id = p.id
									`;

									let sessionsCount = 0;
									let messagesCount = 0;
									let tokenStats: any = null;
									let recentSessions: any[] = [];

									if (isAll) {
										sessionsCount =
											(ocDb.query(countQ).get() as any)?.count || 0;
										messagesCount = (ocDb.query(msgQ).get() as any)?.count || 0;
										tokenStats = ocDb.query(statsQ).get() as any;
										recentSessions = ocDb
											.query(`${recentQ} ORDER BY s.time_updated DESC`)
											.all();
									} else if (isBounded) {
										countQ +=
											" WHERE time_updated >= :start AND time_updated < :end";
										msgQ +=
											" WHERE time_updated >= :start AND time_updated < :end";
										statsQ +=
											" WHERE time_updated >= :start AND time_updated < :end";
										recentQ +=
											" WHERE s.time_updated >= :start AND s.time_updated < :end ORDER BY s.time_updated DESC";

										sessionsCount =
											(
												ocDb.query(countQ).get({
													":start": bounds.startMs,
													":end": bounds.endMs,
												}) as any
											)?.count || 0;
										messagesCount =
											(
												ocDb.query(msgQ).get({
													":start": bounds.startMs,
													":end": bounds.endMs,
												}) as any
											)?.count || 0;
										tokenStats = ocDb.query(statsQ).get({
											":start": bounds.startMs,
											":end": bounds.endMs,
										}) as any;
										recentSessions = ocDb
											.query(recentQ)
											.all({ ":start": bounds.startMs, ":end": bounds.endMs });
									} else {
										countQ += " WHERE time_updated >= :start";
										msgQ += " WHERE time_updated >= :start";
										statsQ += " WHERE time_updated >= :start";
										recentQ +=
											" WHERE s.time_updated >= :start ORDER BY s.time_updated DESC";

										sessionsCount =
											(
												ocDb
													.query(countQ)
													.get({ ":start": bounds.startMs }) as any
											)?.count || 0;
										messagesCount =
											(
												ocDb
													.query(msgQ)
													.get({ ":start": bounds.startMs }) as any
											)?.count || 0;
										tokenStats = ocDb
											.query(statsQ)
											.get({ ":start": bounds.startMs }) as any;
										recentSessions = ocDb
											.query(recentQ)
											.all({ ":start": bounds.startMs });
									}

									ocDb.close();
									result.opencode = {
										available: true,
										sessionsCount,
										messagesCount,
										tokensInput: tokenStats?.input || 0,
										tokensOutput: tokenStats?.output || 0,
										totalCost: tokenStats?.cost || 0,
										recentSessions,
									};
								} else {
									result.opencode = {
										available: false,
										error: "Database not found",
									};
								}
							} catch (e: any) {
								result.opencode = { available: false, error: e.message };
							}
						}

						if (agentType === "all" || agentType === "hermes") {
							try {
								const { Database } = await import("bun:sqlite");
								const hermesDbPath =
									process.env.HERMES_DB_PATH ??
									join(homedir(), ".hermes", "state.db");
								if (existsSync(hermesDbPath)) {
									const hDb = new Database(hermesDbPath, { readonly: true });
									const isAll =
										bounds.startMs === 0 && bounds.endMs === Infinity;
									const isBounded = bounds.endMs !== Infinity;
									const startSec = bounds.startMs / 1000;
									const endSec = bounds.endMs / 1000;

									let countQ = "SELECT COUNT(*) as count FROM sessions";
									let msgQ = "SELECT COUNT(*) as count FROM messages";
									let statsQ =
										"SELECT SUM(input_tokens) as input, SUM(output_tokens) as output, SUM(actual_cost_usd) as cost FROM sessions";
									let recentQ =
										"SELECT id, title, started_at, last_activity_at, model, actual_cost_usd FROM sessions";

									let sessionsCount = 0;
									let messagesCount = 0;
									let tokenStats: any = null;
									let recentSessions: any[] = [];

									if (isAll) {
										sessionsCount =
											(hDb.query(countQ).get() as any)?.count || 0;
										messagesCount = (hDb.query(msgQ).get() as any)?.count || 0;
										tokenStats = hDb.query(statsQ).get() as any;
										recentSessions = hDb
											.query(
												`${recentQ} ORDER BY COALESCE(last_activity_at, started_at) DESC`,
											)
											.all();
									} else if (isBounded) {
										countQ +=
											" WHERE COALESCE(last_activity_at, started_at) >= :start AND COALESCE(last_activity_at, started_at) < :end";
										statsQ +=
											" WHERE COALESCE(last_activity_at, started_at) >= :start AND COALESCE(last_activity_at, started_at) < :end";
										recentQ +=
											" WHERE COALESCE(last_activity_at, started_at) >= :start AND COALESCE(last_activity_at, started_at) < :end ORDER BY COALESCE(last_activity_at, started_at) DESC";

										sessionsCount =
											(
												hDb.query(countQ).get({
													":start": startSec,
													":end": endSec,
												}) as any
											)?.count || 0;
										messagesCount = sessionsCount * 12; // Approximation from session count
										tokenStats = hDb.query(statsQ).get({
											":start": startSec,
											":end": endSec,
										}) as any;
										recentSessions = hDb
											.query(recentQ)
											.all({ ":start": startSec, ":end": endSec });
									} else {
										countQ +=
											" WHERE COALESCE(last_activity_at, started_at) >= :start";
										statsQ +=
											" WHERE COALESCE(last_activity_at, started_at) >= :start";
										recentQ +=
											" WHERE COALESCE(last_activity_at, started_at) >= :start ORDER BY COALESCE(last_activity_at, started_at) DESC";

										sessionsCount =
											(hDb.query(countQ).get({ ":start": startSec }) as any)
												?.count || 0;
										messagesCount = sessionsCount * 12;
										tokenStats = hDb
											.query(statsQ)
											.get({ ":start": startSec }) as any;
										recentSessions = hDb
											.query(recentQ)
											.all({ ":start": startSec });
									}

									hDb.close();
									result.hermes = {
										available: true,
										sessionsCount,
										messagesCount,
										tokensInput: tokenStats?.input || 0,
										tokensOutput: tokenStats?.output || 0,
										totalCost: tokenStats?.cost || 0,
										recentSessions,
									};
								} else {
									result.hermes = {
										available: false,
										error: "Database not found",
									};
								}
							} catch (e: any) {
								result.hermes = { available: false, error: e.message };
							}
						}

						return new Response(JSON.stringify(result, null, 2), {
							status: 200,
							headers: { "content-type": "application/json" },
						});
					}

					if (url.pathname === "/api/dashboard/quota") {
						const providers = await defaultQuotaRegistry.fetchAll();
						// Also create flattened entries for backward compatibility
						const entries: any[] = [];
						for (const p of providers) {
							for (const acc of p.accounts) {
								for (const grp of acc.groups) {
									for (const b of grp.buckets) {
										entries.push({
											provider: p.provider,
											email: acc.email,
											label: `${grp.displayName} (${b.displayName})`,
											windowLabel: b.window,
											usedFraction: 1 - b.remainingFraction,
											status:
												b.remainingFraction <= 0.2
													? "critical"
													: b.remainingFraction <= 0.5
														? "warning"
														: "ok",
											resetsAt: b.resetTime
												? new Date(b.resetTime).getTime()
												: 0,
										});
									}
								}
							}
						}

						return new Response(
							JSON.stringify(
								{
									available:
										providers.length > 0 &&
										providers.some((p) => p.accounts.length > 0),
									providers,
									entries,
								},
								null,
								2,
							),
							{
								status: 200,
								headers: { "content-type": "application/json" },
							},
						);
					}

					if (url.pathname === "/api/dashboard/logs") {
						const rangeParam = url.searchParams.get("range");
						const bounds = parseTimeBounds(rangeParam);
						const limitParam = url.searchParams.get("limit");
						const allParam = url.searchParams.get("all") === "true";
						const limit = limitParam
							? parseInt(limitParam, 10)
							: allParam
								? undefined
								: 150;
						const sinceParam = url.searchParams.get("since");

						let since: number | undefined;
						if (sinceParam) {
							since = parseInt(sinceParam, 10);
						} else if (rangeParam) {
							since = bounds.startMs > 0 ? bounds.startMs : undefined;
						} else if (allParam) {
							since = undefined;
						} else {
							since = startTime;
						}

						let logs = accessLog.readLogs({
							limit,
							since,
						});

						if (bounds.endMs !== Infinity) {
							logs = logs.filter((l) => l.ts < bounds.endMs);
						}

						return new Response(
							JSON.stringify(
								{
									logs,
									uptimeStartTime: startTime,
									count: logs.length,
								},
								null,
								2,
							),
							{
								status: 200,
								headers: { "content-type": "application/json" },
							},
						);
					}

					// Control plane endpoints
					if (
						url.pathname === "/api/dashboard/control/gateway" &&
						method === "POST"
					) {
						if (!isLocalhostRequest(req)) {
							return new Response(
								JSON.stringify({
									error: "Forbidden: control plane is localhost-only",
								}),
								{
									status: 403,
									headers: { "content-type": "application/json" },
								},
							);
						}
						try {
							const body = (await req.json()) as any;
							const action = body?.action;
							if (action === "restart") {
								setTimeout(() => {
									process.exit(0);
								}, 500);
								return new Response(
									JSON.stringify({
										ok: true,
										message: "Gateway restarting...",
									}),
									{
										status: 200,
										headers: { "content-type": "application/json" },
									},
								);
							}
							return new Response(JSON.stringify({ error: "Unknown action" }), {
								status: 400,
							});
						} catch (e: any) {
							return new Response(JSON.stringify({ error: e.message }), {
								status: 500,
							});
						}
					}

					// Ping Tree Endpoint (Gateway -> Provider -> Model hierarchy)
					if (url.pathname === "/api/dashboard/ping/tree" && method === "GET") {
						const gateways: any[] = [];
						for (const u of upstreams) {
							const authHeaders = await getAuthHeadersFor(u);
							const modelIds = await fetchUpstreamCatalog(u, authHeaders);

							const provMap = new Map<
								string,
								Array<{ id: string; displayName: string }>
							>();
							for (const mId of modelIds) {
								let prov = "default";
								let disp = mId;
								if (mId.includes("/")) {
									const parts = mId.split("/");
									prov = parts[0];
									disp = parts.slice(1).join("/");
								}
								if (!provMap.has(prov)) {
									provMap.set(prov, []);
								}
								provMap.get(prov)!.push({ id: mId, displayName: disp });
							}

							const providers = Array.from(provMap.entries())
								.map(([pName, models]) => ({
									name: pName,
									displayName: pName,
									models: models.sort((a, b) =>
										a.displayName.localeCompare(b.displayName),
									),
								}))
								.sort((a, b) => a.name.localeCompare(b.name));

							gateways.push({
								name: u.name,
								displayName:
									u.name === "omp"
										? "OMP Gateway"
										: u.name === "vansrouter"
											? "Vans Gateway"
											: u.name,
								host: u.host,
								port: u.port,
								basePath: u.basePath,
								providers,
							});
						}

						return new Response(JSON.stringify({ gateways }, null, 2), {
							status: 200,
							headers: { "content-type": "application/json" },
						});
					}

					// Ping Probe Endpoint (Live connectivity & health probe)
					if (
						url.pathname === "/api/dashboard/ping/probe" &&
						method === "POST"
					) {
						try {
							const body = (await req.json()) as any;
							const { type, gateway, provider, modelId } = body || {};

							const targetUpstream =
								upstreams.find((u) => u.name === gateway) || upstreams[0];
							const authHeaders = await getAuthHeadersFor(targetUpstream);

							// 1. Probe Gateway port
							if (type === "gateway") {
								const start = performance.now();
								try {
									const testUrl = `http://${targetUpstream.host}:${targetUpstream.port}${targetUpstream.basePath || ""}/models`;
									const res = await fetch(testUrl, {
										headers: { ...authHeaders, accept: "application/json" },
										signal: AbortSignal.timeout(5000),
									});
									const latencyMs = Math.round(performance.now() - start);
									const gwName =
										targetUpstream.name === "omp"
											? "OMP Gateway"
											: targetUpstream.name === "vansrouter"
												? "Vans Gateway"
												: targetUpstream.name;
									return new Response(
										JSON.stringify({
											status: res.ok ? "OK" : "FAIL",
											statusCode: res.status,
											latencyMs,
											target: gwName,
											detail: res.ok
												? `HTTP ${res.status} OK`
												: `HTTP ${res.status}`,
										}),
										{
											status: 200,
											headers: { "content-type": "application/json" },
										},
									);
								} catch (err: any) {
									const latencyMs = Math.round(performance.now() - start);
									const gwName =
										targetUpstream.name === "omp"
											? "OMP Gateway"
											: targetUpstream.name === "vansrouter"
												? "Vans Gateway"
												: targetUpstream.name;
									return new Response(
										JSON.stringify({
											status: "FAIL",
											statusCode: 503,
											latencyMs,
											target: gwName,
											detail:
												err.name === "TimeoutError"
													? "Connection Timeout"
													: err.message || "Gateway unreachable",
										}),
										{
											status: 200,
											headers: { "content-type": "application/json" },
										},
									);
								}
							}

							// 2. Probe Provider or Model
							let targetModelId = modelId;
							if (type === "provider") {
								const catalog = await fetchUpstreamCatalog(
									targetUpstream,
									authHeaders,
								);
								const matching = catalog.filter((m) =>
									m.startsWith(`${provider}/`),
								);
								targetModelId = matching[0] || `${provider}/default`;
							}

							if (!targetModelId) {
								return new Response(
									JSON.stringify({ error: "Missing modelId for probe" }),
									{
										status: 400,
										headers: { "content-type": "application/json" },
									},
								);
							}

							const start = performance.now();
							const compUrl = buildUpstreamUrl(
								targetUpstream,
								"/v1/chat/completions",
							);
							try {
								const res = await fetch(compUrl, {
									method: "POST",
									headers: {
										...authHeaders,
										"content-type": "application/json",
									},
									body: JSON.stringify({
										model: targetModelId,
										messages: [{ role: "user", content: "ping" }],
										max_tokens: 5,
									}),
									signal: AbortSignal.timeout(10000),
								});
								const latencyMs = Math.round(performance.now() - start);

								let detail = `HTTP ${res.status}`;
								let status: "OK" | "FAIL" | "RATELIMIT" | "TIMEOUT" = "FAIL";

								if (res.ok) {
									status = "OK";
									detail = "HTTP 200 OK";
								} else if (res.status === 429) {
									status = "RATELIMIT";
									detail = "429 Too Many Requests";
								} else if (res.status === 400) {
									detail = "400 Bad Request";
								} else if (res.status === 401) {
									detail = "401 Unauthorized";
								} else if (res.status === 403) {
									detail = "403 Forbidden";
								} else if (res.status === 404) {
									detail = "404 Not Found";
								} else if (res.status >= 500) {
									detail = `HTTP ${res.status} Internal Error`;
								}

								return new Response(
									JSON.stringify({
										status,
										statusCode: res.status,
										latencyMs,
										target: targetModelId,
										detail,
									}),
									{
										status: 200,
										headers: { "content-type": "application/json" },
									},
								);
							} catch (err: any) {
								const latencyMs = Math.round(performance.now() - start);
								const isTimeout =
									err.name === "TimeoutError" ||
									err.message?.includes("timeout");
								return new Response(
									JSON.stringify({
										status: isTimeout ? "TIMEOUT" : "FAIL",
										statusCode: isTimeout ? 504 : 500,
										latencyMs,
										target: targetModelId,
										detail: isTimeout
											? "504 Gateway Timeout"
											: err.message || "Request Error",
									}),
									{
										status: 200,
										headers: { "content-type": "application/json" },
									},
								);
							}
						} catch (e: any) {
							return new Response(JSON.stringify({ error: e.message }), {
								status: 500,
								headers: { "content-type": "application/json" },
							});
						}
					}

					// Model filter config CRUD endpoints
					if (
						url.pathname === "/api/dashboard/models/config" &&
						method === "GET"
					) {
						const config = {
							modelFilter: rules.modelFilter || {
								whitelist: {},
								blacklist: [],
							},
							fallback: rules.fallback,
						};
						return new Response(JSON.stringify(config), {
							status: 200,
							headers: { "content-type": "application/json" },
						});
					}

					if (
						url.pathname === "/api/dashboard/models/whitelist" &&
						method === "PUT"
					) {
						if (!isLocalhostRequest(req)) {
							return new Response(
								JSON.stringify({
									error: "Forbidden: control plane is localhost-only",
								}),
								{
									status: 403,
									headers: { "content-type": "application/json" },
								},
							);
						}
						try {
							const body = (await req.json()) as {
								upstream: string;
								models: string[];
							};
							if (!body.upstream || !Array.isArray(body.models)) {
								return new Response(
									JSON.stringify({
										error: "upstream (string) and models (string[]) required",
									}),
									{
										status: 400,
										headers: { "content-type": "application/json" },
									},
								);
							}
							const currentFilter = rules.modelFilter || {
								whitelist: {},
								blacklist: [],
							};
							const updatedFilter = {
								...currentFilter,
								whitelist: {
									...currentFilter.whitelist,
									[body.upstream]: body.models,
								},
							};
							rules = { ...rules, modelFilter: updatedFilter };
							saveGatewayConfig(rules);
							return new Response(
								JSON.stringify({
									ok: true,
									whitelist: updatedFilter.whitelist,
								}),
								{
									status: 200,
									headers: { "content-type": "application/json" },
								},
							);
						} catch {
							return new Response(
								JSON.stringify({ error: "Invalid JSON body" }),
								{
									status: 400,
									headers: { "content-type": "application/json" },
								},
							);
						}
					}

					if (
						url.pathname === "/api/dashboard/models/blacklist" &&
						method === "PUT"
					) {
						if (!isLocalhostRequest(req)) {
							return new Response(
								JSON.stringify({
									error: "Forbidden: control plane is localhost-only",
								}),
								{
									status: 403,
									headers: { "content-type": "application/json" },
								},
							);
						}
						try {
							const body = (await req.json()) as { models: string[] };
							if (!Array.isArray(body.models)) {
								return new Response(
									JSON.stringify({ error: "models (string[]) required" }),
									{
										status: 400,
										headers: { "content-type": "application/json" },
									},
								);
							}
							const currentFilter = rules.modelFilter || {
								whitelist: {},
								blacklist: [],
							};
							const updatedFilter = {
								...currentFilter,
								blacklist: body.models,
							};
							rules = { ...rules, modelFilter: updatedFilter };
							saveGatewayConfig(rules);
							return new Response(
								JSON.stringify({
									ok: true,
									blacklist: updatedFilter.blacklist,
								}),
								{
									status: 200,
									headers: { "content-type": "application/json" },
								},
							);
						} catch {
							return new Response(
								JSON.stringify({ error: "Invalid JSON body" }),
								{
									status: 400,
									headers: { "content-type": "application/json" },
								},
							);
						}
					}

					if (
						url.pathname === "/api/dashboard/models/catalogs" &&
						method === "GET"
					) {
						try {
							const catalogMap = await getCatalog();
							const catalogs: Record<string, string[]> = {};
							for (const [upstreamName, modelSet] of catalogMap.entries()) {
								catalogs[upstreamName] = Array.from(modelSet).sort();
							}
							return new Response(JSON.stringify({ catalogs }), {
								status: 200,
								headers: { "content-type": "application/json" },
							});
						} catch {
							return new Response(JSON.stringify({ catalogs: {} }), {
								status: 200,
								headers: { "content-type": "application/json" },
							});
						}
					}

					// Serve SPA dashboard static assets (build output in web/dist).
					if (
						config.webDistDir &&
						(url.pathname === "/dashboard" ||
							url.pathname === "/dashboard/" ||
							url.pathname.startsWith("/dashboard/"))
					) {
						if (method !== "GET" && method !== "HEAD") {
							return new Response("Method Not Allowed", { status: 405 });
						}

						const distRoot = normalize(config.webDistDir);
						let relative = url.pathname
							.replace(/^\/dashboard\/?/, "")
							.split("?")[0];
						if (!relative || relative.endsWith("/")) {
							relative = "index.html";
						}
						// Prevent path traversal outside dist.
						const target = normalize(join(distRoot, relative));
						if (!target.startsWith(distRoot + sep) && target !== distRoot) {
							return new Response("Not Found", { status: 404 });
						}

						// Coba file aset dulu; kalau ada, serve langsung (biar
						// JS/CSS/image dapat content-type benar dari Bun.file).
						if (
							relative !== "index.html" &&
							existsSync(target) &&
							statSync(target).isFile()
						) {
							const assetFile = Bun.file(target);
							if (await assetFile.exists()) {
								return new Response(assetFile);
							}
						}

						// SPA fallback: semua path non-file mengarah ke index.html.
						const indexFile = Bun.file(join(distRoot, "index.html"));
						return new Response(indexFile);
					}

					// Mock mode handler
					if (config.mode === "mock" && config.mockFixtureFile) {
						let bodyObj: any = null;
						try {
							bodyObj = await req.json();
						} catch {
							bodyObj = {};
						}
						const mocked = fixtureManager.mock(config.mockFixtureFile, bodyObj);
						if (mocked) return mocked;
					}

					// ── Unified /v1/models aggregator (Issue #38) ──────────
					// Intercept & merge catalog dari semua upstream sekaligus,
					// bukan proxy passthrough ke upstream tunggal.
					if (
						method === "GET" &&
						(url.pathname === "/v1/models" || url.pathname.endsWith("/models"))
					) {
						const routes = await Promise.all(
							upstreams.map(async (u) => {
								const authHeaders = await getAuthHeadersFor(u);
								const target = buildUpstreamUrl(u, "/v1/models", url.search);
								return { u, authHeaders, target };
							}),
						);
						const responses = await Promise.all(
							routes.map(async (r) => {
								try {
									const res = await fetch(r.target, {
										headers: { ...r.authHeaders, accept: "application/json" },
										signal: AbortSignal.timeout(5000),
									});
									if (!res.ok)
										return { upstreamName: r.u.name, bodyText: null };
									return { upstreamName: r.u.name, bodyText: await res.text() };
								} catch {
									return { upstreamName: r.u.name, bodyText: null };
								}
							}),
						);
						const merged = mergeModelResponses(responses);

						// Filter merged.data by whitelist per-upstream and global blacklist
						if (rules.modelFilter) {
							const catalogMap = await getCatalog();
							const filteredData: any[] = [];
							for (const entry of merged.data) {
								const modelId = entry.id as string;
								// Skip if globally blacklisted
								if (isModelBlacklisted(modelId, rules.modelFilter)) continue;

								// Check per-upstream whitelist
								// Find which upstream this model came from by checking catalogMap
								let allowed = true;
								for (const [upstreamName, catalog] of catalogMap.entries()) {
									if (catalog.has(modelId)) {
										allowed = isModelWhitelisted(
											modelId,
											upstreamName,
											rules.modelFilter,
										);
										break;
									}
								}
								if (allowed) filteredData.push(entry);
							}
							merged.data = filteredData;
						}

						// Enrich each model with dynamic OpenRouter pricing metadata
						if (Array.isArray(merged.data)) {
							merged.data = merged.data.map((m: any) => {
								const rates = defaultPricingEngine.resolveModelPricing(m.id);
								if (rates) {
									return {
										...m,
										pricing: {
											prompt: (rates.inputUsdPer1M / 1_000_000).toString(),
											completion: (rates.outputUsdPer1M / 1_000_000).toString(),
											input_cache_read: (
												rates.cacheReadUsdPer1M / 1_000_000
											).toString(),
											usd_per_1m: {
												input: rates.inputUsdPer1M,
												output: rates.outputUsdPer1M,
												cache: rates.cacheReadUsdPer1M,
											},
											source: rates.matchedModelId || "openrouter",
										},
									};
								}
								return m;
							});
						}

						return new Response(JSON.stringify(merged), {
							status: 200,
							headers: {
								"content-type": "application/json",
								"X-GN-Upstreams": merged.upstreamCount.toString(),
							},
						});
					}

					const noCacheHeader =
						req.headers.get("x-gn-no-cache") ||
						req.headers.get("X-GN-No-Cache");
					const forceNoCache =
						noCacheHeader === "true" || noCacheHeader === "1";

					let reqBodyStr = "";
					if (req.body) {
						reqBodyStr = await req.text();
					}

					// Shield sanitization
					let finalReqBody = reqBodyStr;
					let maskedTokensCount = 0;
					if (config.shieldEnabled && !config.sanitizeLogsOnly && reqBodyStr) {
						const { sanitized, maskedCount } = sanitizeText(reqBodyStr, rules);
						maskedTokensCount = maskedCount;
						if (maskedCount > 0) {
							console.log(
								`[SHIELD] [GN Gateway Shield] Redacted ${maskedCount} token(s) from incoming payload -> ${url.pathname}`,
							);
						}
						finalReqBody = sanitized;
					}

					const outboundHeaders = buildOutboundHeaders(req.headers);
					const isLlmEndpoint =
						url.pathname.includes("/chat/completions") ||
						url.pathname.includes("/messages");
					const parsedBodyInfo = isLlmEndpoint
						? extractModelFromBody(finalReqBody)
						: null;
					let primaryModel = parsedBodyInfo?.model ?? null;

					// Global blacklist check: reject blacklisted models at proxy level
					if (
						primaryModel &&
						isModelBlacklisted(primaryModel, rules.modelFilter)
					) {
						return new Response(
							JSON.stringify({
								error: {
									message: `Model "${primaryModel}" is blacklisted by Goblin Nexus policy.`,
									type: "invalid_request_error",
									code: "model_blacklisted",
								},
							}),
							{
								status: 403,
								headers: { "content-type": "application/json" },
							},
						);
					}

					const initialModel = primaryModel ?? "unknown";
					const isStreamReq = parsedBodyInfo?.parsed?.stream === true;
					const fallbackChain: FallbackHop[] = [];

					// Caching check
					let promptHash = "";
					if (
						config.cacheEnabled &&
						!forceNoCache &&
						isLlmEndpoint &&
						parsedBodyInfo?.parsed
					) {
						promptHash = computePromptHash(parsedBodyInfo.parsed);
						const cached = cacheManager.get(promptHash);

						if (cached) {
							stats.cacheHits++;
							const respHeaders = new Headers(cached.meta.headers || {});
							respHeaders.set("X-GN-Cache", "HIT");
							respHeaders.set("X-GN-Cache-Hash", promptHash);

							const approxReqPromptTokens = Math.max(
								1,
								Math.ceil((reqBodyStr?.length || 100) / 3.8),
							);
							const hitPrompt =
								cached.meta.promptTokens || approxReqPromptTokens;
							const hitCompletion =
								cached.meta.completionTokens ||
								Math.max(1, Math.ceil((cached.body?.length || 500) / 3.5));

							accessLog.write({
								ts: reqStartTime,
								method,
								path: url.pathname,
								initialModel,
								servedModel: cached.meta.model || primaryModel || "unknown",
								status: cached.meta.status || 200,
								latencyMs: Date.now() - reqStartTime,
								cache: "HIT",
								stream: cached.isStream,
								tokensInput: hitPrompt,
								tokensOutput: hitCompletion,
								tokensCache: hitPrompt,
								tokensTotal: hitPrompt + hitCompletion,
								shieldRedacted: maskedTokensCount,
							});

							if (cached.isStream && cached.chunks.length > 0) {
								respHeaders.set(
									"content-type",
									"text/event-stream; charset=utf-8",
								);
								respHeaders.set("cache-control", "no-cache");
								respHeaders.set("connection", "keep-alive");
								respHeaders.set("x-accel-buffering", "no");

								const stream = formatCachedStreamChunks(cached.chunks);
								return new Response(stream, {
									status: cached.meta.status || 200,
									headers: respHeaders,
								});
							} else {
								return new Response(cached.body || "", {
									status: cached.meta.status || 200,
									headers: respHeaders,
								});
							}
						} else {
							stats.cacheMisses++;
						}
					}

					// Resolve upstream tujuan berdasarkan model (multi-upstream router).
					// Dipanggil setelah cache-check supaya request yang cache-hit tidak
					// menanggung biaya fetch catalog / buka DB Vans.
					const route = await resolveRouteForRequest(
						url.pathname,
						url.search,
						primaryModel,
					);
					const targetUrl = route.url;
					for (const [h, v] of Object.entries(route.authHeaders)) {
						outboundHeaders.set(h, v);
					}

					// Upstream tool schema normalization (e.g. CommandCode Anthropic tools)
					if (isLlmEndpoint && finalReqBody) {
						finalReqBody = normalizeUpstreamTools(
							finalReqBody,
							targetUrl,
							initialModel,
						);
					}

					// Upstream forwarder with abort propagation & TTFB timeout (15s)
					const abortController = new AbortController();
					if (req.signal) {
						req.signal.addEventListener("abort", () => {
							abortController.abort();
						});
					}

					try {
						const TTFB_TIMEOUT_MS = 15_000;
						let timeoutId: any = null;
						const timeoutPromise = new Promise<never>((_, reject) => {
							timeoutId = setTimeout(() => {
								abortController.abort();
								reject(new Error("TTFB_TIMEOUT"));
							}, TTFB_TIMEOUT_MS);
						});

						let upstreamResp: Response;
						try {
							upstreamResp = await Promise.race([
								fetch(targetUrl, {
									method,
									headers: outboundHeaders,
									body: ["GET", "HEAD"].includes(method)
										? undefined
										: finalReqBody,
									signal: abortController.signal,
								}),
								timeoutPromise,
							]);
						} catch (fetchErr: any) {
							if (fetchErr.message === "TTFB_TIMEOUT") {
								// Mock 504 Gateway Timeout for fallback eligibility
								upstreamResp = new Response(
									JSON.stringify({ error: "Gateway TTFB Timeout" }),
									{
										status: 504,
										headers: { "content-type": "application/json" },
									},
								);
							} else {
								throw fetchErr;
							}
						} finally {
							if (timeoutId) clearTimeout(timeoutId);
						}

						let effectiveStatus = upstreamResp.status;
						let fallbackUsedInfo: string | null = null;

						// Check if fallback applies
						const fallbackEligible =
							isLlmEndpoint && Boolean(primaryModel) && Boolean(parsedBodyInfo);

						if (
							fallbackEligible &&
							shouldTriggerFallback(
								effectiveStatus,
								rules.fallback || DEFAULT_FALLBACK,
							)
						) {
							stats.fallbacksTriggered++;
							recordModelFailure(primaryModel!);
							fallbackChain.push({
								model: primaryModel!,
								status: effectiveStatus,
								ok: false,
							});
							try {
								await upstreamResp.body?.cancel();
							} catch {
								/* noop */
							}

							const candidates = resolveFallbackCandidates(
								primaryModel!,
								rules.fallback || DEFAULT_FALLBACK,
							);
							let fallbackResp: Response | null = null;
							let successfulCandidate: string | null = null;

							for (const candidate of candidates) {
								const fallbackBody = buildFallbackBody(
									parsedBodyInfo!.parsed,
									candidate,
								);
								if (!fallbackBody) continue;

								try {
									const retryResp = await fetch(targetUrl, {
										method,
										headers: outboundHeaders,
										body: fallbackBody,
										signal: abortController.signal,
									});

									if (
										retryResp.ok ||
										!shouldTriggerFallback(
											retryResp.status,
											rules.fallback || DEFAULT_FALLBACK,
										)
									) {
										fallbackChain.push({
											model: candidate,
											status: retryResp.status,
											ok: true,
										});
										fallbackResp = retryResp;
										successfulCandidate = candidate;
										recordModelSuccess(candidate);
										break;
									} else {
										fallbackChain.push({
											model: candidate,
											status: retryResp.status,
											ok: false,
										});
										recordModelFailure(candidate);
										try {
											await retryResp.body?.cancel();
										} catch {
											/* noop */
										}
									}
								} catch {
									fallbackChain.push({
										model: candidate,
										status: 500,
										ok: false,
									});
									recordModelFailure(candidate);
								}
							}

							if (fallbackResp && successfulCandidate) {
								fallbackUsedInfo = `primary=${primaryModel}; fallback=${successfulCandidate}; trigger=${effectiveStatus}`;
								upstreamResp = fallbackResp;
								primaryModel = successfulCandidate;
							}
						} else if (primaryModel && upstreamResp.ok) {
							recordModelSuccess(primaryModel);
						}

						// Normal Streaming or Standard response
						const respHeaders = buildResponseHeaders(upstreamResp.headers);
						if (fallbackUsedInfo) {
							respHeaders.set("X-GN-Fallback", fallbackUsedInfo);
						}
						if (promptHash) {
							respHeaders.set("X-GN-Cache", "MISS");
							respHeaders.set("X-GN-Cache-Hash", promptHash);
						}

						// If streaming response
						const contentType = upstreamResp.headers.get("content-type") || "";
						const isMessagesReq = url.pathname.includes("/messages");
						const isStreamingResponse =
							(contentType.includes("text/event-stream") || isStreamReq) &&
							(!isMessagesReq ||
								isStreamReq ||
								contentType.includes("text/event-stream"));

						if (isStreamingResponse && upstreamResp.body) {
							stats.activeStreams++;
							const reader = upstreamResp.body.getReader();
							const decoder = new TextDecoder();
							const encoder = new TextEncoder();
							const recordedChunks: string[] = [];
							let hasUsageChunk = false;
							let streamedContentLength = 0;

							// Approximate prompt token size from input payload
							const approxPromptTokens = Math.max(
								1,
								Math.ceil((reqBodyStr?.length || 100) / 3.8),
							);
							const streamTokens = {
								promptTokens: approxPromptTokens,
								completionTokens: 0,
								cacheReadTokens: 0,
								totalTokens: 0,
							};

							const stream = new ReadableStream({
								async pull(controller) {
									try {
										const { done, value } = await reader.read();
										if (done) {
											const approxCompletionTokens = Math.max(
												1,
												Math.ceil(streamedContentLength / 3.5),
											);
											if (!streamTokens.completionTokens) {
												streamTokens.completionTokens = approxCompletionTokens;
											}
											if (!streamTokens.totalTokens) {
												streamTokens.totalTokens =
													streamTokens.promptTokens +
													streamTokens.completionTokens;
											}

											// If upstream did not provide a usage chunk (e.g. CommandCode for OpenAI chat completions)
											if (!hasUsageChunk && upstreamResp.ok && !isMessagesReq) {
												const usagePayload = {
													id: "chatcmpl-gn-usage",
													object: "chat.completion.chunk",
													created: Math.floor(Date.now() / 1000),
													model: primaryModel || initialModel,
													choices: [],
													usage: {
														prompt_tokens: streamTokens.promptTokens,
														completion_tokens: streamTokens.completionTokens,
														total_tokens: streamTokens.totalTokens,
													},
												};
												const usageChunkStr = `data: ${JSON.stringify(usagePayload)}\n\n`;
												recordedChunks.push(usageChunkStr);
												controller.enqueue(encoder.encode(usageChunkStr));

												// Fire telemetry for stream
												fireTelemetry(
													primaryModel || initialModel,
													JSON.stringify({
														usage: {
															prompt_tokens: streamTokens.promptTokens,
															completion_tokens: streamTokens.completionTokens,
															total_tokens: streamTokens.totalTokens,
														},
													}),
													upstreamResp.status,
													Date.now() - reqStartTime,
												);
											}

											stats.activeStreams = Math.max(
												0,
												stats.activeStreams - 1,
											);
											controller.close();

											// Cache streamed response chunks
											if (
												config.cacheEnabled &&
												promptHash &&
												recordedChunks.length > 0 &&
												upstreamResp.ok
											) {
												const headerObj: Record<string, string> = {};
												respHeaders.forEach((v, k) => {
													headerObj[k] = v;
												});
												cacheManager.set(
													promptHash,
													{
														model: primaryModel || "unknown",
														status: upstreamResp.status,
														headers: headerObj,
														isStream: true,
														totalChunks: recordedChunks.length,
														promptTokens: streamTokens.promptTokens,
														completionTokens: streamTokens.completionTokens,
													},
													recordedChunks,
													config.cacheTtlMs,
												);
											}

											// Catat access log untuk streaming selesai
											accessLog.write({
												ts: reqStartTime,
												method,
												path: url.pathname,
												initialModel: initialModel || "unknown",
												servedModel: primaryModel || initialModel || "unknown",
												status: upstreamResp.status,
												latencyMs: Date.now() - reqStartTime,
												cache: promptHash ? "MISS" : "BYPASS",
												stream: true,
												tokensInput: streamTokens.promptTokens,
												tokensOutput: streamTokens.completionTokens,
												tokensCache: streamTokens.cacheReadTokens,
												tokensTotal: streamTokens.totalTokens,
												fallback:
													fallbackChain.length > 1
														? {
																chain: fallbackChain,
																hopCount: fallbackChain.length,
															}
														: undefined,
												shieldRedacted: maskedTokensCount,
											});

											// Record fixture if in record mode
											if (config.mode === "record") {
												const recordedReqBody = config.shieldEnabled
													? sanitizeText(
															JSON.stringify(parsedBodyInfo?.parsed || {}),
															rules,
														).sanitized
													: parsedBodyInfo?.parsed;

												fixtureManager.record(
													config.mockFixtureFile || "default-session",
													{
														url: url.pathname,
														method,
														model: primaryModel || undefined,
														body:
															typeof recordedReqBody === "string"
																? JSON.parse(recordedReqBody)
																: recordedReqBody,
													},
													{
														status: upstreamResp.status,
														headers: {},
														isStream: true,
														chunks: recordedChunks,
													},
												);
											}

											return;
										}

										if (value) {
											const text = decoder.decode(value, { stream: true });
											recordedChunks.push(text);
											if (
												text.includes('"usage":') ||
												text.includes('"prompt_tokens":') ||
												text.includes('"input_tokens":')
											) {
												hasUsageChunk = true;
												const lines = text.split("\n");
												for (const l of lines) {
													const trimmed = l.trim();
													if (
														trimmed.startsWith("data:") &&
														trimmed !== "data: [DONE]"
													) {
														try {
															const parsed = JSON.parse(
																trimmed.slice(5).trim(),
															);
															const u =
																parsed.usage ||
																(parsed.type === "message_delta"
																	? parsed.usage
																	: null);
															if (u) {
																if (
																	u.prompt_tokens !== undefined ||
																	u.input_tokens !== undefined
																) {
																	streamTokens.promptTokens =
																		u.prompt_tokens ?? u.input_tokens ?? 0;
																}
																if (
																	u.completion_tokens !== undefined ||
																	u.output_tokens !== undefined
																) {
																	streamTokens.completionTokens =
																		u.completion_tokens ?? u.output_tokens ?? 0;
																}
																if (
																	u.prompt_tokens_details?.cached_tokens !==
																		undefined ||
																	u.cache_read_input_tokens !== undefined
																) {
																	streamTokens.cacheReadTokens =
																		u.prompt_tokens_details?.cached_tokens ??
																		u.cache_read_input_tokens ??
																		0;
																}
																if (u.total_tokens !== undefined) {
																	streamTokens.totalTokens = u.total_tokens;
																}
															}
														} catch {
															// Best effort for partial chunks
														}
													}
												}
											}
											streamedContentLength += text.length;
											controller.enqueue(value);
										}
									} catch (err) {
										stats.activeStreams = Math.max(0, stats.activeStreams - 1);
										controller.error(err);
									}
								},
								cancel() {
									stats.activeStreams = Math.max(0, stats.activeStreams - 1);
									reader.cancel();
									abortController.abort();
								},
							});

							return new Response(stream, {
								status: upstreamResp.status,
								statusText: upstreamResp.statusText,
								headers: respHeaders,
							});
						}

						// Non-streaming response: read body text safely to eliminate race conditions
						const bodyText = await upstreamResp.text();
						const latency = Date.now() - reqStartTime;

						const approxNonStreamPrompt = Math.max(
							1,
							Math.ceil((reqBodyStr?.length || 100) / 3.8),
						);
						const approxNonStreamCompletion = Math.max(
							1,
							Math.ceil(bodyText.length / 3.5),
						);
						const nonStreamUsage = {
							promptTokens: approxNonStreamPrompt,
							completionTokens: approxNonStreamCompletion,
							cacheReadTokens: 0,
							totalTokens: approxNonStreamPrompt + approxNonStreamCompletion,
						};

						try {
							const parsed = JSON.parse(bodyText);
							const u = parsed?.usage;
							if (u) {
								if (u.prompt_tokens ?? u.input_tokens) {
									nonStreamUsage.promptTokens =
										u.prompt_tokens ?? u.input_tokens;
								}
								if (u.completion_tokens ?? u.output_tokens) {
									nonStreamUsage.completionTokens =
										u.completion_tokens ?? u.output_tokens;
								}
								if (
									u.prompt_tokens_details?.cached_tokens ??
									u.cache_read_input_tokens
								) {
									nonStreamUsage.cacheReadTokens =
										u.prompt_tokens_details?.cached_tokens ??
										u.cache_read_input_tokens;
								}
								nonStreamUsage.totalTokens =
									u.total_tokens ??
									nonStreamUsage.promptTokens + nonStreamUsage.completionTokens;
							}
						} catch {
							// Best-effort approximation
						}

						if (primaryModel && upstreamResp.ok) {
							fireTelemetry(
								primaryModel,
								bodyText,
								upstreamResp.status,
								latency,
							);
						}

						// Catat access log untuk non-streaming request
						accessLog.write({
							ts: reqStartTime,
							method,
							path: url.pathname,
							initialModel: initialModel || "unknown",
							servedModel: primaryModel || initialModel || "unknown",
							status: upstreamResp.status,
							latencyMs: latency,
							cache: promptHash ? "MISS" : "BYPASS",
							stream: false,
							tokensInput: nonStreamUsage.promptTokens,
							tokensOutput: nonStreamUsage.completionTokens,
							tokensCache: nonStreamUsage.cacheReadTokens,
							tokensTotal: nonStreamUsage.totalTokens,
							fallback:
								fallbackChain.length > 1
									? {
											chain: fallbackChain,
											hopCount: fallbackChain.length,
										}
									: undefined,
							shieldRedacted: maskedTokensCount,
						});

						if (config.cacheEnabled && promptHash && upstreamResp.ok) {
							const headerObj: Record<string, string> = {};
							respHeaders.forEach((v, k) => {
								headerObj[k] = v;
							});
							cacheManager.set(
								promptHash,
								{
									model: primaryModel || "unknown",
									status: upstreamResp.status,
									headers: headerObj,
									isStream: false,
									promptTokens: nonStreamUsage.promptTokens,
									completionTokens: nonStreamUsage.completionTokens,
								},
								bodyText,
								config.cacheTtlMs,
							);
						}

						if (config.mode === "record") {
							const recordedReqBody = config.shieldEnabled
								? sanitizeText(
										JSON.stringify(parsedBodyInfo?.parsed || {}),
										rules,
									).sanitized
								: parsedBodyInfo?.parsed;

							fixtureManager.record(
								config.mockFixtureFile || "default-session",
								{
									url: url.pathname,
									method,
									model: primaryModel || undefined,
									body:
										typeof recordedReqBody === "string"
											? JSON.parse(recordedReqBody)
											: recordedReqBody,
								},
								{
									status: upstreamResp.status,
									headers: {},
									isStream: false,
									body: bodyText,
								},
							);
						}

						return new Response(bodyText, {
							status: upstreamResp.status,
							statusText: upstreamResp.statusText,
							headers: respHeaders,
						});
					} catch (err: any) {
						stats.errorsCount++;
						accessLog.write({
							ts: reqStartTime,
							method,
							path: url.pathname,
							initialModel: initialModel || "unknown",
							servedModel: primaryModel || initialModel || "unknown",
							status: 502,
							latencyMs: Date.now() - reqStartTime,
							cache: "NONE",
							stream: isStreamReq,
							fallback:
								fallbackChain.length > 1
									? {
											chain: fallbackChain,
											hopCount: fallbackChain.length,
										}
									: undefined,
							shieldRedacted: maskedTokensCount,
							error: err.message,
						});
						return new Response(
							JSON.stringify({
								error: "GN Gateway Connection Error",
								details: err.message,
								target: targetUrl,
							}),
							{
								status: 502,
								headers: { "content-type": "application/json" },
							},
						);
					}
				},
			});

			return serverInstance;
		},
	};

	return server;
}
