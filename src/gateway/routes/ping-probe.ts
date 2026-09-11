import { buildUpstreamUrl, fetchUpstreamCatalog } from "../upstream-router";
import type { GatewayContext } from "../context";

export async function handlePingTree(
	_req: Request,
	_url: URL,
	ctx: GatewayContext,
): Promise<Response> {
	const gateways: any[] = [];
	for (const u of ctx.upstreams) {
		const authHeaders = await ctx.getAuthHeadersFor(u);
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

export async function handlePingProbe(
	req: Request,
	_url: URL,
	ctx: GatewayContext,
): Promise<Response> {
	try {
		const body = (await req.json()) as any;
		const { type, gateway, provider, modelId } = body || {};

		const targetUpstream =
			ctx.upstreams.find((u) => u.name === gateway) || ctx.upstreams[0];
		const authHeaders = await ctx.getAuthHeadersFor(targetUpstream);

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
						detail: res.ok ? `HTTP ${res.status} OK` : `HTTP ${res.status}`,
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
			const catalog = await fetchUpstreamCatalog(targetUpstream, authHeaders);
			const matching = catalog.filter((m) => m.startsWith(`${provider}/`));
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
		const compUrl = buildUpstreamUrl(targetUpstream, "/v1/chat/completions");
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
				err.name === "TimeoutError" || err.message?.includes("timeout");
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
