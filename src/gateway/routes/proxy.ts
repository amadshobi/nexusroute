import { calculateCost } from "../../../telemetry/pricing";
import { logTelemetry } from "../../../telemetry/db";
import { computePromptHash, formatCachedStreamChunks } from "../cache";
import { defaultCommandCodeAdapter } from "../../adapters/commandcode";
import {
	buildFallbackBody,
	extractModelFromBody,
	recordModelFailure,
	recordModelSuccess,
	resolveFallbackCandidates,
	shouldTriggerFallback,
} from "../circuit-breaker";
import { DEFAULT_FALLBACK } from "../rules";
import {
	sanitizeText,
	normalizeUpstreamTools,
	normalizeUpstreamReasoning,
	detectSalvagableError,
	buildSalvagedChunks,
} from "../sanitizer";
import type { FallbackHop, AccessLogEntry } from "../access-log";
import { isStaticAssetPath, isProbePath } from "../access-log";
import { isModelBlacklisted, type GatewayContext } from "../context";
import { detectClientApp, resolveRealProvider } from "../provider-resolver";

function fireTelemetry(
	model: string,
	rawBody: string,
	statusCode = 200,
	latencyMs = 0,
): void {
	try {
		let provider = "unknown";
		if (model.includes("/")) {
			provider = model.split("/")[0];
		} else if (model.startsWith("gemini") || model.startsWith("antigravity")) {
			provider = "google-antigravity";
		} else if (model.startsWith("claude")) {
			provider = "anthropic";
		}

		let parsed: any = null;
		try {
			parsed = JSON.parse(rawBody);
		} catch {
			return;
		}

		const usage = parsed?.usage;
		if (!usage) return;
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
			clientApp: "nexus-gateway",
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

function buildOutboundHeaders(
	reqHeaders: Headers,
	privacyHeaders: Record<string, string>,
): Headers {
	const outbound = new Headers(reqHeaders);
	outbound.delete("host");
	// Strip internal & mock headers
	outbound.delete("x-mock-status");
	outbound.delete("x-force-fallback");
	outbound.delete("X-Mock-Status");
	outbound.delete("X-Force-Fallback");
	// Internal no-cache header (dual: NexusRoute baru + legacy GN)
	outbound.delete("x-nexus-no-cache");
	outbound.delete("X-Nexus-No-Cache");
	outbound.delete("x-gn-no-cache");
	outbound.delete("X-GN-No-Cache");
	outbound.delete("x-gn-fixture");
	outbound.delete("X-GN-Fixture");

	for (const [hKey, hVal] of Object.entries(privacyHeaders)) {
		outbound.set(hKey, hVal);
	}
	return outbound;
}

function buildResponseHeaders(
	upstreamHeaders: Headers,
	privacyHeaders: Record<string, string>,
): Headers {
	const respHeaders = new Headers(upstreamHeaders);
	for (const [hKey, hVal] of Object.entries(privacyHeaders)) {
		respHeaders.set(hKey, hVal);
	}
	return respHeaders;
}

/**
 * Handle reverse proxying for LLM completion requests (/v1/chat/completions, /v1/messages).
 */
export async function handleProxyRequest(
	req: Request,
	url: URL,
	ctx: GatewayContext,
	reqStartTime: number,
): Promise<Response> {
	const method = req.method.toUpperCase();

	// Hard guard: static bundle assets and discovery probes must never enter
	// the LLM proxy pipeline (they are handled upstream in server.ts).
	if (isStaticAssetPath(url.pathname) || isProbePath(url.pathname)) {
		return new Response("Not Found", { status: 404 });
	}

	// Mock mode handler
	if (ctx.config.mode === "mock" && ctx.config.mockFixtureFile) {
		let bodyObj: any = null;
		try {
			bodyObj = await req.json();
		} catch {
			bodyObj = {};
		}
		const mocked = ctx.fixtureManager.mock(ctx.config.mockFixtureFile, bodyObj);
		if (mocked) return mocked;
	}

	const noCacheHeader =
		req.headers.get("x-nexus-no-cache") ||
		req.headers.get("X-Nexus-No-Cache") ||
		req.headers.get("x-gn-no-cache") ||
		req.headers.get("X-GN-No-Cache");
	const forceNoCache = noCacheHeader === "true" || noCacheHeader === "1";

	let reqBodyStr = "";
	if (req.body) {
		reqBodyStr = await req.text();
	}

	// Shield sanitization
	let finalReqBody = reqBodyStr;
	let maskedTokensCount = 0;
	if (ctx.config.shieldEnabled && !ctx.config.sanitizeLogsOnly && reqBodyStr) {
		const { sanitized, maskedCount } = sanitizeText(reqBodyStr, ctx.rules);
		maskedTokensCount = maskedCount;
		if (maskedCount > 0) {
			console.log(
				`[SHIELD] [GN Gateway Shield] Redacted ${maskedCount} token(s) from incoming payload -> ${url.pathname}`,
			);
		}
		finalReqBody = sanitized;
	}

	const outboundHeaders = buildOutboundHeaders(req.headers, ctx.privacyHeaders);
	const isLlmEndpoint =
		url.pathname.includes("/chat/completions") ||
		url.pathname.includes("/messages");
	const parsedBodyInfo = isLlmEndpoint
		? extractModelFromBody(finalReqBody)
		: null;
	let primaryModel = parsedBodyInfo?.model ?? null;

	// Global blacklist check: reject blacklisted models at proxy level
	if (primaryModel && isModelBlacklisted(primaryModel, ctx.rules.modelFilter)) {
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
	const clientApp = detectClientApp(req);

	// Caching check
	let promptHash = "";
	if (
		ctx.config.cacheEnabled &&
		!forceNoCache &&
		isLlmEndpoint &&
		parsedBodyInfo?.parsed
	) {
		promptHash = computePromptHash(parsedBodyInfo.parsed);
		const cached = ctx.cacheManager.get(promptHash);

		if (cached) {
			ctx.stats.cacheHits++;
			const respHeaders = new Headers(cached.meta.headers || {});
			respHeaders.set("X-GN-Cache", "HIT");
			respHeaders.set("X-Nexus-Cache", "HIT");
			respHeaders.set("X-GN-Cache-Hash", promptHash);

			const approxReqPromptTokens = Math.max(
				1,
				Math.ceil((reqBodyStr?.length || 100) / 3.8),
			);
			const hitPrompt = cached.meta.promptTokens || approxReqPromptTokens;
			const hitCompletion =
				cached.meta.completionTokens ||
				Math.max(1, Math.ceil((cached.body?.length || 500) / 3.5));
			const cachedServedModel = cached.meta.model || primaryModel || "unknown";

			const entry = {
				ts: reqStartTime,
				method,
				path: url.pathname,
				initialModel,
				servedModel: cachedServedModel,
				status: cached.meta.status || 200,
				latencyMs: Date.now() - reqStartTime,
				cache: "HIT" as const,
				stream: cached.isStream,
				tokensInput: hitPrompt,
				tokensOutput: hitCompletion,
				tokensCache: hitPrompt,
				tokensTotal: hitPrompt + hitCompletion,
				shieldRedacted: maskedTokensCount,
				upstream: "cache",
				provider: resolveRealProvider(cachedServedModel),
				client: clientApp,
			};
			ctx.accessLog.write(entry);
			if (ctx.eventBus.subscriberCount() > 0) {
				ctx.eventBus.emit({ type: "request_complete", ts: entry.ts, data: entry });
			}

			if (cached.isStream && cached.chunks.length > 0) {
				respHeaders.set("content-type", "text/event-stream; charset=utf-8");
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
			ctx.stats.cacheMisses++;
		}
	}

	// Resolve upstream tujuan berdasarkan model (multi-upstream router).
	const route = await ctx.resolveRouteForRequest(
		url.pathname,
		url.search,
		primaryModel,
	);
	const targetUrl = route.url;
	for (const [h, v] of Object.entries(route.authHeaders)) {
		outboundHeaders.set(h, v);
	}

	// Special check: Direct CommandCode Adapter (bypasses VansRouter entirely!)
	// Triggers when target upstream is commandcode or model explicitly uses cmc/ / commandcode/ prefix.
	const isCommandCodeTarget =
		route.upstream.name === "commandcode" ||
		route.upstream.name === "cmc" ||
		(primaryModel &&
			(primaryModel.startsWith("cmc/") ||
				primaryModel.startsWith("commandcode/")));

	if (
		isLlmEndpoint &&
		primaryModel &&
		defaultCommandCodeAdapter.isAvailable() &&
		isCommandCodeTarget &&
		parsedBodyInfo
	) {
		const abortController = new AbortController();
		if (req.signal) {
			req.signal.addEventListener("abort", () => {
				abortController.abort();
			});
		}

		try {
			const directResp = await defaultCommandCodeAdapter.execute(
				parsedBodyInfo.parsed,
				abortController.signal,
			);
			// Pass through to caching & logging pipeline
			let effectiveStatus = directResp.status;
			const stream =
				directResp.headers.get("content-type")?.includes("event-stream") ||
				false;

			if (stream && directResp.body) {
				ctx.stats.activeStreams++;
				let logged = false;
				let cmcUsage: {
					prompt_tokens: number;
					completion_tokens: number;
					total_tokens: number;
					cache_read_tokens?: number;
				} | null = null;

				const decoder = new TextDecoder();
				const logOnce = () => {
					if (logged) return;
					logged = true;
					ctx.stats.activeStreams = Math.max(0, ctx.stats.activeStreams - 1);
					const cmcModel = primaryModel || "unknown";
					const latencyMs = Date.now() - reqStartTime;

					const promptTok = cmcUsage?.prompt_tokens ?? 0;
					const compTok = cmcUsage?.completion_tokens ?? 0;
					const totTok = cmcUsage?.total_tokens ?? promptTok + compTok;
					const cacheTok = cmcUsage?.cache_read_tokens ?? 0;

					const entry = {
						ts: reqStartTime,
						method,
						path: url.pathname,
						initialModel: initialModel || "unknown",
						servedModel: cmcModel,
						status: effectiveStatus,
						latencyMs,
						cache: "BYPASS" as const,
						stream: true,
						tokensInput: promptTok > 0 ? promptTok : undefined,
						tokensOutput: compTok > 0 ? compTok : undefined,
						tokensTotal: totTok > 0 ? totTok : undefined,
						tokensCache: cacheTok,
						shieldRedacted: 0,
						upstream: "commandcode",
						provider: "commandcode",
						client: clientApp,
					};
					ctx.accessLog.write(entry);
					if (ctx.eventBus.subscriberCount() > 0) {
						ctx.eventBus.emit({
							type: "request_complete",
							ts: entry.ts,
							data: entry,
						});
					}

					if (promptTok > 0 || compTok > 0) {
						try {
							const cost = calculateCost(
								"commandcode",
								cmcModel,
								promptTok,
								compTok,
								cacheTok,
							);
							logTelemetry({
								provider: "commandcode",
								model: cmcModel,
								clientApp: clientApp || "unknown",
								promptTokens: promptTok,
								completionTokens: compTok,
								cacheReadTokens: cacheTok,
								cacheWriteTokens: 0,
								totalTokens: totTok,
								costUsd: cost.total,
								latencyMs,
								statusCode: effectiveStatus,
								timestamp: Date.now(),
							});
						} catch {}
					}
				};

				let lineBuffer = "";
				const streamWithTeardown = directResp.body.pipeThrough(
					new TransformStream({
						transform(chunk, controller) {
							controller.enqueue(chunk);
							try {
								const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
								lineBuffer += text;
								const lines = lineBuffer.split("\n");
								// Keep the last partial line in buffer
								lineBuffer = lines.pop() ?? "";

								for (const l of lines) {
									const trimmed = l.trim();
									if (trimmed.startsWith("data:") && trimmed !== "data: [DONE]") {
										try {
											const parsed = JSON.parse(trimmed.slice(5).trim());
											if (parsed.usage) {
												const u = parsed.usage;
												const cachedTok = Number(
													u.prompt_tokens_details?.cached_tokens ??
													u.cache_read_input_tokens ??
													0,
												);
												cmcUsage = {
													prompt_tokens: Number(u.prompt_tokens || u.input_tokens || 0),
													completion_tokens: Number(u.completion_tokens || u.output_tokens || 0),
													total_tokens: Number(u.total_tokens || 0),
													cache_read_tokens: cachedTok,
												};
											}
										} catch {}
									}
								}
							} catch {}
						},
						flush() {
							if (lineBuffer.trim().startsWith("data:") && lineBuffer.trim() !== "data: [DONE]") {
								try {
									const parsed = JSON.parse(lineBuffer.trim().slice(5).trim());
									if (parsed.usage) {
										const u = parsed.usage;
										cmcUsage = {
											prompt_tokens: Number(u.prompt_tokens || u.input_tokens || 0),
											completion_tokens: Number(u.completion_tokens || u.output_tokens || 0),
											total_tokens: Number(u.total_tokens || 0),
											cache_read_tokens: Number(u.prompt_tokens_details?.cached_tokens ?? 0),
										};
									}
								} catch {}
							}
							logOnce();
						},
					}),
				);

				return new Response(streamWithTeardown, {
					status: 200,
					headers: directResp.headers,
				});
			}

			return directResp;
		} catch (directErr: any) {
			// fallback to standard routing if direct adapter fails
		}
	}

	// Upstream tool schema and reasoning normalization
	if (isLlmEndpoint && finalReqBody) {
		finalReqBody = normalizeUpstreamTools(
			finalReqBody,
			targetUrl,
			initialModel,
		);
		finalReqBody = normalizeUpstreamReasoning(
			finalReqBody,
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
					body: ["GET", "HEAD"].includes(method) ? undefined : finalReqBody,
					signal: abortController.signal,
				}),
				timeoutPromise,
			]);
		} catch (fetchErr: any) {
			if (fetchErr.message === "TTFB_TIMEOUT") {
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
				ctx.rules.fallback || DEFAULT_FALLBACK,
			)
		) {
			ctx.stats.fallbacksTriggered++;
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
				ctx.rules.fallback || DEFAULT_FALLBACK,
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
							ctx.rules.fallback || DEFAULT_FALLBACK,
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
		const respHeaders = buildResponseHeaders(
			upstreamResp.headers,
			ctx.privacyHeaders,
		);
		if (fallbackUsedInfo) {
			respHeaders.set("X-GN-Fallback", fallbackUsedInfo);
		}
		if (promptHash) {
			respHeaders.set("X-GN-Cache", "MISS");
			respHeaders.set("X-Nexus-Cache", "MISS");
			respHeaders.set("X-GN-Cache-Hash", promptHash);
		}

		const contentType = upstreamResp.headers.get("content-type") || "";
		const isMessagesReq = url.pathname.includes("/messages");
		const isStreamingResponse =
			(contentType.includes("text/event-stream") || isStreamReq) &&
			(!isMessagesReq ||
				isStreamReq ||
				contentType.includes("text/event-stream"));

		if (isStreamingResponse && upstreamResp.body) {
			ctx.stats.activeStreams++;
			const reader = upstreamResp.body.getReader();
			const decoder = new TextDecoder();
			const encoder = new TextEncoder();
			const recordedChunks: string[] = [];
			let hasUsageChunk = false;
			let streamedContentLength = 0;

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
									streamTokens.promptTokens + streamTokens.completionTokens;
							}

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

							ctx.stats.activeStreams = Math.max(
								0,
								ctx.stats.activeStreams - 1,
							);
							controller.close();

							if (
								ctx.config.cacheEnabled &&
								promptHash &&
								recordedChunks.length > 0 &&
								upstreamResp.ok
							) {
								const headerObj: Record<string, string> = {};
								respHeaders.forEach((v, k) => {
									headerObj[k] = v;
								});
								ctx.cacheManager.set(
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
									ctx.config.cacheTtlMs,
								);
							}

							const activeServedModel = primaryModel || initialModel || "unknown";
							const entry = {
								ts: reqStartTime,
								method,
								path: url.pathname,
								initialModel: initialModel || "unknown",
								servedModel: activeServedModel,
								status: upstreamResp.status,
								latencyMs: Date.now() - reqStartTime,
								cache: promptHash ? ("MISS" as const) : ("BYPASS" as const),
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
								upstream: route.upstream.name,
								provider: resolveRealProvider(activeServedModel, route.upstream.name),
								client: clientApp,
							};
							ctx.accessLog.write(entry);
							if (ctx.eventBus.subscriberCount() > 0) {
								ctx.eventBus.emit({
									type: "request_complete",
									ts: entry.ts,
									data: entry,
								});
							}

							if (ctx.config.mode === "record") {
								const recordedReqBody = ctx.config.shieldEnabled
									? sanitizeText(
											JSON.stringify(parsedBodyInfo?.parsed || {}),
											ctx.rules,
										).sanitized
									: parsedBodyInfo?.parsed;

								ctx.fixtureManager.record(
									ctx.config.mockFixtureFile || "default-session",
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

							// ── OUTBOUND SSE ERROR SALVAGER ──
							const salvagable = detectSalvagableError(text);
							if (salvagable) {
								console.warn(
									`[SALVAGER] Intercepted in-band fatal error (${salvagable}). Synthesizing graceful completion.`,
								);
								const salvagedChunks = buildSalvagedChunks(
									salvagable,
									primaryModel || initialModel || "unknown",
									isMessagesReq,
								);
								for (const chunk of salvagedChunks) {
									controller.enqueue(encoder.encode(chunk));
									recordedChunks.push(chunk);
								}

								ctx.stats.activeStreams = Math.max(
									0,
									ctx.stats.activeStreams - 1,
								);
								controller.close();
								try {
									await reader.cancel();
								} catch {
									/* noop */
								}
								abortController.abort();

								const activeServedModel =
									primaryModel || initialModel || "unknown";
								const entry: AccessLogEntry = {
									ts: reqStartTime,
									method,
									path: url.pathname,
									initialModel: initialModel || "unknown",
									servedModel: activeServedModel,
									status: 200,
									latencyMs: Date.now() - reqStartTime,
									cache: "BYPASS",
									stream: true,
									tokensInput: streamTokens.promptTokens,
									tokensOutput: Math.max(
										1,
										Math.ceil(streamedContentLength / 3.5),
									),
									tokensCache: streamTokens.cacheReadTokens,
									tokensTotal:
										streamTokens.promptTokens +
										Math.max(1, Math.ceil(streamedContentLength / 3.5)),
									fallback:
										fallbackChain.length > 1
											? {
													chain: fallbackChain,
													hopCount: fallbackChain.length,
												}
											: undefined,
									shieldRedacted: maskedTokensCount,
									upstream: route.upstream.name,
									provider: resolveRealProvider(
										activeServedModel,
										route.upstream.name,
									),
									client: clientApp,
									salvaged: salvagable,
									error: `[SALVAGED] ${salvagable}`,
								};
								ctx.accessLog.write(entry);
								if (ctx.eventBus.subscriberCount() > 0) {
									ctx.eventBus.emit({
										type: "request_complete",
										ts: entry.ts,
										data: entry,
									});
								}
								return;
							}

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
											const parsed = JSON.parse(trimmed.slice(5).trim());
											const u =
												parsed.usage ||
												(parsed.type === "message_delta" ? parsed.usage : null);
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
						ctx.stats.activeStreams = Math.max(0, ctx.stats.activeStreams - 1);
						controller.error(err);
					}
				},
				cancel() {
					ctx.stats.activeStreams = Math.max(0, ctx.stats.activeStreams - 1);
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

		// Non-streaming response
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
					nonStreamUsage.promptTokens = u.prompt_tokens ?? u.input_tokens;
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
						u.prompt_tokens_details?.cached_tokens ?? u.cache_read_input_tokens;
				}
				nonStreamUsage.totalTokens =
					u.total_tokens ??
					nonStreamUsage.promptTokens + nonStreamUsage.completionTokens;
			}
		} catch {
			// Best-effort approximation
		}

		if (primaryModel && upstreamResp.ok) {
			fireTelemetry(primaryModel, bodyText, upstreamResp.status, latency);
		}

		const nonStreamServedModel = primaryModel || initialModel || "unknown";
		const entry = {
			ts: reqStartTime,
			method,
			path: url.pathname,
			initialModel: initialModel || "unknown",
			servedModel: nonStreamServedModel,
			status: upstreamResp.status,
			latencyMs: latency,
			cache: promptHash ? ("MISS" as const) : ("BYPASS" as const),
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
			upstream: route.upstream.name,
			provider: resolveRealProvider(nonStreamServedModel, route.upstream.name),
			client: clientApp,
		};
		ctx.accessLog.write(entry);
		if (ctx.eventBus.subscriberCount() > 0) {
			ctx.eventBus.emit({ type: "request_complete", ts: entry.ts, data: entry });
		}

		if (ctx.config.cacheEnabled && promptHash && upstreamResp.ok) {
			const headerObj: Record<string, string> = {};
			respHeaders.forEach((v, k) => {
				headerObj[k] = v;
			});
			ctx.cacheManager.set(
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
				ctx.config.cacheTtlMs,
			);
		}

		if (ctx.config.mode === "record") {
			const recordedReqBody = ctx.config.shieldEnabled
				? sanitizeText(JSON.stringify(parsedBodyInfo?.parsed || {}), ctx.rules)
						.sanitized
				: parsedBodyInfo?.parsed;

			ctx.fixtureManager.record(
				ctx.config.mockFixtureFile || "default-session",
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
		ctx.stats.errorsCount++;
		const errServedModel = primaryModel || initialModel || "unknown";
		const entry = {
			ts: reqStartTime,
			method,
			path: url.pathname,
			initialModel: initialModel || "unknown",
			servedModel: errServedModel,
			status: 502,
			latencyMs: Date.now() - reqStartTime,
			cache: "NONE" as const,
			stream: isStreamReq,
			fallback:
				fallbackChain.length > 1
					? {
							chain: fallbackChain,
							hopCount: fallbackChain.length,
						}
					: undefined,
			shieldRedacted: maskedTokensCount,
			upstream: "error",
			provider: resolveRealProvider(errServedModel),
			client: clientApp,
			error: err.message,
		};
		ctx.accessLog.write(entry);
		if (ctx.eventBus.subscriberCount() > 0) {
			ctx.eventBus.emit({ type: "request_complete", ts: entry.ts, data: entry });
		}
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
}
