import { buildUpstreamUrl, mergeModelResponses } from "../upstream-router";
import { defaultPricingEngine } from "../openrouter-pricing";
import { defaultCommandCodeAdapter } from "../../adapters/commandcode";
import {
	isModelBlacklisted,
	isModelWhitelisted,
	type GatewayContext,
} from "../context";

/**
 * Intercept & merge catalog dari semua upstream sekaligus,
 * enrich dengan OpenRouter pricing metadata, filter dengan whitelist/blacklist.
 */
export async function handleModelsCatalog(
	_req: Request,
	url: URL,
	ctx: GatewayContext,
): Promise<Response> {
	const routes = await Promise.all(
		ctx.upstreams.map(async (u) => {
			const authHeaders = await ctx.getAuthHeadersFor(u);
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
				if (!res.ok) return { upstreamName: r.u.name, bodyText: null };
				return { upstreamName: r.u.name, bodyText: await res.text() };
			} catch {
				return { upstreamName: r.u.name, bodyText: null };
			}
		}),
	);

	// Inject CommandCode models from adapter if registered as an upstream or standalone
	if (
		defaultCommandCodeAdapter.isAvailable() &&
		ctx.upstreams.some((u) => u.name === "commandcode" || u.name === "cmc")
	) {
		const cmcModels = defaultCommandCodeAdapter.getModels().map((m) => ({
			id: m.id,
			object: "model",
			created: Math.floor(Date.now() / 1000),
			owned_by: "commandcode",
		}));
		responses.push({
			upstreamName: "commandcode",
			bodyText: JSON.stringify({ object: "list", data: cmcModels }),
		});
	}

	const merged = mergeModelResponses(responses);

	// Filter merged.data by whitelist per-upstream and global blacklist
	if (ctx.rules.modelFilter) {
		const catalogMap = await ctx.getCatalog();
		const filteredData: any[] = [];
		for (const entry of merged.data) {
			const modelId = entry.id as string;
			// Skip if globally blacklisted
			if (isModelBlacklisted(modelId, ctx.rules.modelFilter)) continue;

			// Check per-upstream whitelist
			let allowed = true;
			for (const [upstreamName, catalog] of catalogMap.entries()) {
				if (catalog.has(modelId)) {
					allowed = isModelWhitelisted(
						modelId,
						upstreamName,
						ctx.rules.modelFilter,
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
						input_cache_read: (rates.cacheReadUsdPer1M / 1_000_000).toString(),
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
