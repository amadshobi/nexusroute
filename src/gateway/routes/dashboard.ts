import { defaultPricingEngine } from "../openrouter-pricing";
import { defaultQuotaRegistry } from "../../quota";
import { saveGatewayConfig } from "../rules";
import { GN_VERSION } from "../../version";
import { resolveRealProvider } from "../provider-resolver";
import {
	parseTimeBounds,
	isLocalhostAddress,
	type GatewayContext,
} from "../context";

function isLocalhostRequest(req: Request, ctx: GatewayContext): boolean {
	const peerIp = ctx.getRequestIP(req);
	// In test environments where socket IP might not be bound to Bun.serve or is loopback
	if (!peerIp) {
		// Fallback only if no peerIp was provided by runtime, verify host/forwarded with IPv6 normalization
		const forwarded = req.headers.get("x-forwarded-for");
		if (forwarded) {
			const firstIp = forwarded.split(",")[0].trim();
			if (!isLocalhostAddress(firstIp)) return false;
		}
		const hostHeader = req.headers.get("host") || "";
		const hostname = hostHeader.replace(/^\[([^\]]+)\].*/, "$1").split(":")[0];
		return isLocalhostAddress(hostname);
	}
	return isLocalhostAddress(peerIp);
}

/** Build a fixed-length array of empty activity buckets anchored at `start`. */
function createEmptyActivityBuckets(count: number, start: number, step: number) {
	return Array.from({ length: count }, (_, i) => ({
		timestamp: Math.round(start + i * step),
		requests: 0,
		cacheHits: 0,
		tokensInputFresh: 0,
		tokensCacheRead: 0,
		tokensOutput: 0,
		tokensTotal: 0,
		costUsd: 0,
		providers: {} as Record<string, { requests: number; tokens: number; costUsd: number }>,
		models: {} as Record<string, { requests: number; tokens: number; costUsd: number }>,
	}));
}

export async function handleDashboardApi(
	req: Request,
	url: URL,
	ctx: GatewayContext,
): Promise<Response | null> {
	const method = req.method.toUpperCase();

	// 1. Overview & Sparklines
	if (url.pathname === "/api/dashboard/overview") {
		const rangeParam = url.searchParams.get("range") || "all";
		const bounds = parseTimeBounds(rangeParam);
		const svc = ctx.getStats();
		const cacheCount = ctx.config.cacheEnabled ? ctx.cacheManager.count() : 0;

		let dbTotalRequests = svc.totalRequests;
		let dbTotalTokens = 0;
		let dbInputFreshTokens = 0;
		let dbCacheReadTokens = 0;
		let dbOutputTokens = 0;
		let dbCacheHits = svc.cacheHits;
		let dbMarketCostUsd = 0;
		let dbGrossCostUsd = 0;

		const bucketCount = 10;
		const activityBucketCount = 24;
		const now = Date.now();
		let windowStart = bounds.startMs > 0 ? bounds.startMs : now - 3600 * 1000;
		let windowEnd = bounds.endMs !== Infinity ? bounds.endMs : now;
		let windowSpan = windowEnd - windowStart;
		let step = windowSpan > 0 ? windowSpan / bucketCount : 1;

		let costSparkline = new Array(bucketCount).fill(0);
		let reqSparkline = new Array(bucketCount).fill(0);
		let tokenSparkline = new Array(bucketCount).fill(0);
		let cacheReadSparkline = new Array(bucketCount).fill(0);
		let inputFreshSparkline = new Array(bucketCount).fill(0);

		let activityStep = windowSpan > 0 ? windowSpan / activityBucketCount : 1;
		let activityBuckets = createEmptyActivityBuckets(
			activityBucketCount,
			windowStart,
			activityStep,
		);

		// Leaderboard aggregators
		const modelMap = new Map<string, {
			model: string;
			requests: number;
			tokensTotal: number;
			tokensInput: number;
			tokensOutput: number;
			tokensCache: number;
			costUsd: number;
			latencyTotalMs: number;
			sparkline: number[];
		}>();

		const providerMap = new Map<string, {
			provider: string;
			upstream: string;
			requests: number;
			tokensTotal: number;
			costUsd: number;
			latencyTotalMs: number;
			sparkline: number[];
		}>();

		const clientMap = new Map<string, {
			client: string;
			requests: number;
			tokensTotal: number;
			costUsd: number;
		}>();

		try {
			const allLogs = ctx.accessLog.readLogs({
				since: bounds.startMs > 0 ? bounds.startMs : undefined,
			});
			const rangedLogs =
				bounds.endMs !== Infinity
					? allLogs.filter((l) => l.ts < bounds.endMs)
					: allLogs;

			dbTotalRequests = rangedLogs.length;
			dbCacheHits = rangedLogs.filter((l) => l.cache === "HIT").length;

			if (bounds.startMs === 0 && rangedLogs.length > 0) {
				windowStart = rangedLogs[0].ts;
				windowSpan = windowEnd - windowStart;
				step = windowSpan > 0 ? windowSpan / bucketCount : 1;
			}

			activityStep = windowSpan > 0 ? windowSpan / activityBucketCount : 1;
			activityBuckets = createEmptyActivityBuckets(
				activityBucketCount,
				windowStart,
				activityStep,
			);

			costSparkline = new Array(bucketCount).fill(0);
			reqSparkline = new Array(bucketCount).fill(0);
			tokenSparkline = new Array(bucketCount).fill(0);
			cacheReadSparkline = new Array(bucketCount).fill(0);
			inputFreshSparkline = new Array(bucketCount).fill(0);

			for (const l of rangedLogs) {
				const inTok = l.tokensInput ?? 0;
				const outTok = l.tokensOutput ?? 0;
				const cacheTok = l.tokensCache ?? 0;
				const freshInTok = Math.max(0, inTok - cacheTok);
				const reqTokens = l.tokensTotal ?? inTok + outTok;
				dbTotalTokens += reqTokens;
				dbInputFreshTokens += freshInTok;
				dbCacheReadTokens += cacheTok;
				dbOutputTokens += outTok;

				let reqCost = 0;
				let grossCost = 0;
				const m = l.servedModel || l.initialModel || "unknown";
				if (freshInTok > 0 || outTok > 0 || cacheTok > 0) {
					const rates = defaultPricingEngine.resolveModelPricing(m);
					if (rates) {
						reqCost =
							(freshInTok / 1_000_000) * rates.inputUsdPer1M +
							(outTok / 1_000_000) * rates.outputUsdPer1M +
							(cacheTok / 1_000_000) * rates.cacheReadUsdPer1M;
						grossCost =
							(inTok / 1_000_000) * rates.inputUsdPer1M +
							(outTok / 1_000_000) * rates.outputUsdPer1M;
					} else {
						reqCost = ((freshInTok + outTok) / 1_000_000) * 1.5;
						grossCost = ((inTok + outTok) / 1_000_000) * 1.5;
					}
				}
				dbMarketCostUsd += reqCost;
				dbGrossCostUsd += grossCost;

				const ts = l.ts;
				let bucketIdx = -1;
				if (ts >= windowStart && ts <= windowEnd) {
					bucketIdx = Math.min(
						bucketCount - 1,
						Math.max(0, Math.floor((ts - windowStart) / step)),
					);
					reqSparkline[bucketIdx] += 1;
					tokenSparkline[bucketIdx] += reqTokens;
					costSparkline[bucketIdx] += reqCost;
					cacheReadSparkline[bucketIdx] += cacheTok;
					inputFreshSparkline[bucketIdx] += freshInTok;
				}

				// Leaderboard: Model
				let modelStat = modelMap.get(m);
				if (!modelStat) {
					modelStat = {
						model: m,
						requests: 0,
						tokensTotal: 0,
						tokensInput: 0,
						tokensOutput: 0,
						tokensCache: 0,
						costUsd: 0,
						latencyTotalMs: 0,
						sparkline: new Array(bucketCount).fill(0),
					};
					modelMap.set(m, modelStat);
				}
				modelStat.requests += 1;
				modelStat.tokensTotal += reqTokens;
				modelStat.tokensInput += inTok;
				modelStat.tokensOutput += outTok;
				modelStat.tokensCache += cacheTok;
				modelStat.costUsd += reqCost;
				modelStat.latencyTotalMs += l.latencyMs || 0;
				if (bucketIdx >= 0) {
					modelStat.sparkline[bucketIdx] += 1;
				}

				// Leaderboard: Provider (with upstream indicator)
				const prov = l.provider || resolveRealProvider(m, l.upstream);
				const up = l.upstream || (prov === "commandcode" ? "commandcode" : "omp");
				const provKey = `${prov}::${up}`;
				let provStat = providerMap.get(provKey);
				if (!provStat) {
					provStat = {
						provider: prov,
						upstream: up,
						requests: 0,
						tokensTotal: 0,
						costUsd: 0,
						latencyTotalMs: 0,
						sparkline: new Array(bucketCount).fill(0),
					};
					providerMap.set(provKey, provStat);
				}
				provStat.requests += 1;
				provStat.tokensTotal += reqTokens;
				provStat.costUsd += reqCost;
				provStat.latencyTotalMs += l.latencyMs || 0;
				if (bucketIdx >= 0) {
					provStat.sparkline[bucketIdx] += 1;
				}

				// Leaderboard: Client
				const cl = l.client || "unknown";
				let clStat = clientMap.get(cl);
				if (!clStat) {
					clStat = {
						client: cl,
						requests: 0,
						tokensTotal: 0,
						costUsd: 0,
					};
					clientMap.set(cl, clStat);
				}
				clStat.requests += 1;
				clStat.tokensTotal += reqTokens;
				clStat.costUsd += reqCost;

				// Activity timeline buckets (24 fixed slots)
				const actBucketIdx = Math.min(
					activityBucketCount - 1,
					Math.max(0, Math.floor((ts - windowStart) / activityStep)),
				);
				const actBucket = activityBuckets[actBucketIdx];
				actBucket.requests += 1;
				if (l.cache === "HIT") {
					actBucket.cacheHits += 1;
				}
				actBucket.tokensInputFresh += freshInTok;
				actBucket.tokensCacheRead += cacheTok;
				actBucket.tokensOutput += outTok;
				actBucket.tokensTotal += reqTokens;
				actBucket.costUsd += reqCost;

				const provBucket = actBucket.providers[prov] ?? {
					requests: 0,
					tokens: 0,
					costUsd: 0,
				};
				provBucket.requests += 1;
				provBucket.tokens += reqTokens;
				provBucket.costUsd += reqCost;
				actBucket.providers[prov] = provBucket;

				const modelBucket = actBucket.models[m] ?? {
					requests: 0,
					tokens: 0,
					costUsd: 0,
				};
				modelBucket.requests += 1;
				modelBucket.tokens += reqTokens;
				modelBucket.costUsd += reqCost;
				actBucket.models[m] = modelBucket;
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
					grossCostUsd: dbGrossCostUsd,
					localSpendUsd: 0,
					savingsUsd: Math.max(0, dbGrossCostUsd - dbMarketCostUsd),
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
						enabled: ctx.config.cacheEnabled,
						entries: cacheCount,
						hits: dbCacheHits,
						misses: Math.max(0, dbTotalRequests - dbCacheHits),
					},
					upstreams: ctx.upstreams.map((u) => ({
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
						mode: ctx.config.mode,
					},
					sparklines: {
						cost: costSparkline,
						req: reqSparkline,
						tokens: tokenSparkline,
						cacheRead: cacheReadSparkline,
						inputFresh: inputFreshSparkline,
					},
					activity: activityBuckets,
					leaderboard: {
						models: Array.from(modelMap.values())
							.map((m) => ({
								...m,
								avgLatencyMs: m.requests > 0 ? Math.round(m.latencyTotalMs / m.requests) : 0,
								cacheRate: m.tokensInput > 0 ? Number(((m.tokensCache / m.tokensInput) * 100).toFixed(1)) : 0,
							}))
							.sort((a, b) => b.requests - a.requests),
						providers: Array.from(providerMap.values())
							.map((p) => ({
								...p,
								avgLatencyMs: p.requests > 0 ? Math.round(p.latencyTotalMs / p.requests) : 0,
							}))
							.sort((a, b) => b.requests - a.requests),
						clients: Array.from(clientMap.values())
							.sort((a, b) => b.requests - a.requests),
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

	// 2. Multi-account Provider Quota
	if (url.pathname === "/api/dashboard/quota") {
		const providers = await defaultQuotaRegistry.fetchAll();
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
							resetsAt: b.resetTime ? new Date(b.resetTime).getTime() : 0,
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

	// 3. Access Logs
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
			since = ctx.startTime;
		}

		let logs = ctx.accessLog.readLogs({
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
					uptimeStartTime: ctx.startTime,
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

	// 4. Control Plane: Restart Daemon
	if (url.pathname === "/api/dashboard/control/gateway" && method === "POST") {
		if (!isLocalhostRequest(req, ctx)) {
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

	// 5. Models Config
	if (url.pathname === "/api/dashboard/models/config" && method === "GET") {
		const config = {
			modelFilter: ctx.rules.modelFilter || {
				whitelist: {},
				blacklist: [],
			},
			fallback: ctx.rules.fallback,
		};
		return new Response(JSON.stringify(config), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}

	// 6. Models Whitelist Update
	if (url.pathname === "/api/dashboard/models/whitelist" && method === "PUT") {
		if (!isLocalhostRequest(req, ctx)) {
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
			const currentFilter = ctx.rules.modelFilter || {
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
			ctx.rules.modelFilter = updatedFilter;
			saveGatewayConfig(ctx.rules);
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
			return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
				status: 400,
				headers: { "content-type": "application/json" },
			});
		}
	}

	// 7. Models Blacklist Update
	if (url.pathname === "/api/dashboard/models/blacklist" && method === "PUT") {
		if (!isLocalhostRequest(req, ctx)) {
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
			const currentFilter = ctx.rules.modelFilter || {
				whitelist: {},
				blacklist: [],
			};
			const updatedFilter = {
				...currentFilter,
				blacklist: body.models,
			};
			ctx.rules.modelFilter = updatedFilter;
			saveGatewayConfig(ctx.rules);
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
			return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
				status: 400,
				headers: { "content-type": "application/json" },
			});
		}
	}

	// 8. Models Catalogs Map
	if (url.pathname === "/api/dashboard/models/catalogs" && method === "GET") {
		try {
			const catalogMap = await ctx.getCatalog();
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

	// 9. Gateway Event Stream (Server-Sent Events)
	if (
		(url.pathname === "/api/gateway/events" ||
			url.pathname === "/api/dashboard/events") &&
		method === "GET"
	) {
		const encoder = new TextEncoder();
		const formatSse = (event: string, payload: unknown): Uint8Array =>
			encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);

		// Assigned inside start() so cancel() can tear the connection down too.
		let cleanup: () => void = () => {};

		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				let cleanedUp = false;
				let unsubscribe: (() => void) | null = null;
				let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

				const doCleanup = () => {
					if (cleanedUp) return;
					cleanedUp = true;
					if (heartbeatInterval !== null) {
						clearInterval(heartbeatInterval);
						heartbeatInterval = null;
					}
					if (unsubscribe) {
						unsubscribe();
						unsubscribe = null;
					}
				};
				cleanup = doCleanup;

				const send = (event: string, payload: unknown) => {
					if (cleanedUp) return;
					try {
						controller.enqueue(formatSse(event, payload));
					} catch {
						// Client already gone; stop the producers.
						doCleanup();
					}
				};

				// Greet the client with a stats snapshot.
				send("connected", {
					type: "connected",
					ts: Date.now(),
					stats: ctx.getStats(),
				});

				unsubscribe = ctx.eventBus.subscribe((event) => {
					send(event.type, event);
				});

				heartbeatInterval = setInterval(() => {
					send("heartbeat", { type: "heartbeat", ts: Date.now() });
				}, 15_000);

				req.signal.addEventListener("abort", doCleanup);
			},
			cancel() {
				cleanup();
			},
		});

		return new Response(stream, {
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				"X-Accel-Buffering": "no",
			},
		});
	}

	return null;
}
