import { defaultPricingEngine } from "../openrouter-pricing";
import { defaultQuotaRegistry } from "../../quota";
import { saveGatewayConfig } from "../rules";
import { GN_VERSION } from "../../version";
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

		const bucketCount = 10;
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

	return null;
}
