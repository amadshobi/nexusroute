import * as p from "@clack/prompts";
import { readGnCache, writeGnCache, getGnCacheFilePath } from "../utils/paths";
import {
	resolveProviderAlias,
	formatModelDisplayId,
	parseModelsYml,
} from "../utils/ping-config";
import type { PingCachePayload } from "./ping";
import {
	printGnHeader,
	ANSI_BOLD,
	ANSI_RESET,
	ANSI_GRAY,
	ANSI_CYAN,
	ANSI_GREEN,
	ANSI_RED,
	ANSI_YELLOW,
} from "../utils/formatter";

export interface BenchModelMetric {
	model: string;
	status: "OK" | "FAIL" | "RATELIMIT" | "TIMEOUT";
	statusCode: number;
	latencyMs: number;
	tokensPerSec: number;
	completionTokens: number;
	detail?: string;
	logLine?: string;
}

export interface BenchCachePayload {
	timestamp: number;
	provider: string;
	engineVersion: string;
	metrics: {
		totalTested: number;
		successful: number;
		failed: number;
		avgLatencyMs: number;
		avgTokensPerSec: number;
		maxTokensPerSec?: number;
		championModel?: string;
	};
	results: {
		logLines?: string[];
		models: BenchModelMetric[];
	};
}

function showBenchHelp(): void {
	printGnHeader("BENCHMARK ENGINE MANUAL");
	console.log("USAGE");
	console.log("  $ gn b [provider] [flags]");
	console.log("");
	console.log("TARGETS");
	console.log(
		"  [provider]   Nama provider atau alias (default: google-antigravity)",
	);
	console.log("               Contoh alias: agy, oa, ant, copilot, ollama");
	console.log("");
	console.log("FLAGS");
	console.log("  -f, --force  Bypass cache & jalankan live speed benchmark");
	console.log(
		"  -a, --all    Benchmark semua model (abaikan filter 200 OK dari ping cache)",
	);
	console.log("  --top <N>    Tampilkan hanya N model teratas di leaderboard");
	console.log("  --json       Output mentah format JSON");
	console.log("  -h, --help   Tampilkan panduan Level-2 ini");
	console.log("");
	console.log("SMART PING FILTER");
	console.log(
		"  gn bench secara otomatis memanfaatkan hasil cache 'gn ping'. Jika ada,",
	);
	console.log(
		"  bench HANYA menguji model yang berstatus 200 OK agar hemat waktu",
	);
	console.log(
		"  dan token. Gunakan -a atau --all untuk menguji seluruh model.",
	);
	console.log("");
	console.log("EXAMPLES");
	console.log(
		"  $ gn b                     # Tampilkan cache benchmark default (Instant ~5ms)",
	);
	console.log(
		"  $ gn b agy -f              # Live bench model sehat (200 OK) dari ping cache",
	);
	console.log(
		"  $ gn b agy -f -a           # Live bench SEMUA model dari gateway tanpa filter",
	);
	console.log("  $ gn b agy --top 3         # Tampilkan top 3 model tercepat");
	console.log("");
}

function stripAnsi(value: string): string {
	return value.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function visibleWidth(value: string): number {
	return Array.from(stripAnsi(value)).length;
}

function padVisible(
	value: string,
	width: number,
	align: "left" | "right" = "left",
): string {
	const padSize = Math.max(0, width - visibleWidth(value));
	const padding = " ".repeat(padSize);
	return align === "right" ? `${padding}${value}` : `${value}${padding}`;
}

function truncateMiddle(value: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	if (visibleWidth(value) <= maxWidth) return value;
	if (maxWidth <= 1) return "…";

	const chars = Array.from(value);
	const headWidth = Math.max(1, Math.ceil((maxWidth - 1) * 0.55));
	const tailWidth = Math.max(1, maxWidth - headWidth - 1);
	return `${chars.slice(0, headWidth).join("")}…${chars.slice(-tailWidth).join("")}`;
}

function formatThroughputBar(
	tokPerSec: number,
	maxTokPerSec: number,
	width = 14,
): string {
	if (tokPerSec <= 0 || maxTokPerSec <= 0) {
		return `${ANSI_GRAY}${"─".repeat(width)}${ANSI_RESET}`;
	}
	const fraction = Math.min(1, Math.max(0.08, tokPerSec / maxTokPerSec));
	const filled = Math.round(fraction * width);
	const empty = Math.max(0, width - filled);

	let color = ANSI_CYAN;
	if (tokPerSec >= 40) color = ANSI_CYAN;
	else if (tokPerSec >= 20) color = ANSI_GREEN;
	else color = ANSI_YELLOW;

	const filledStr = `${color}${"█".repeat(filled)}${ANSI_RESET}`;
	const emptyStr = `${ANSI_GRAY}${"░".repeat(empty)}${ANSI_RESET}`;
	return `${filledStr}${emptyStr}`;
}

function formatBenchStatus(status: string, statusCode: number): string {
	if (status === "OK" && statusCode === 200) {
		return `${ANSI_GREEN}󰄬 200${ANSI_RESET}`;
	}
	if (status === "RATELIMIT" || statusCode === 429) {
		return `${ANSI_YELLOW}󰀦 429${ANSI_RESET}`;
	}
	if (status === "TIMEOUT" || statusCode === 504) {
		return `${ANSI_RED}󰅖 504${ANSI_RESET}`;
	}
	return `${ANSI_RED}󰅚 ${statusCode || 500}${ANSI_RESET}`;
}

const BENCH_RANK_WIDTH = 4;
const BENCH_LATENCY_WIDTH = 8;
const BENCH_BAR_WIDTH = 14;
const BENCH_TOKENS_WIDTH = 8;
const BENCH_STATUS_WIDTH = 6;
const BENCH_GAP = "  ";

function getBenchModelLabel(modelId: string, provider: string): string {
	const prefix = `${provider.toLowerCase()}/`;
	if (modelId.toLowerCase().startsWith(prefix)) {
		return modelId.slice(prefix.length);
	}
	return modelId;
}

function getBenchModelWidth(labels: string[]): number {
	const terminalWidth = process.stdout.columns || 100;
	const fixedWidth =
		2 +
		BENCH_RANK_WIDTH +
		BENCH_GAP.length +
		BENCH_GAP.length +
		BENCH_LATENCY_WIDTH +
		BENCH_GAP.length +
		BENCH_BAR_WIDTH +
		1 +
		6 +
		BENCH_GAP.length +
		BENCH_TOKENS_WIDTH +
		BENCH_GAP.length +
		BENCH_STATUS_WIDTH;
	const available = Math.max(20, terminalWidth - fixedWidth);
	const longest = Math.max(20, ...labels.map((label) => visibleWidth(label)));
	return Math.min(longest, available, 48);
}

interface RunBenchOptions {
	all?: boolean;
	interactive?: boolean;
}

async function runLiveBenchmark(
	provider: string,
	options: RunBenchOptions = {},
): Promise<BenchCachePayload> {
	const models: BenchModelMetric[] = [];
	let targetList: Array<{ id: string; owned_by?: string }> = [];

	// 1. Cek cache ping (Smart Filter: 200 OK only unless --all is set)
	if (!options.all) {
		const pingCache = readGnCache<PingCachePayload>("ping", provider);
		if (
			pingCache &&
			Array.isArray(pingCache.items) &&
			pingCache.items.length > 0
		) {
			const healthyItems = pingCache.items.filter(
				(it) => it.status === "OK" && it.statusCode === 200,
			);
			if (healthyItems.length > 0) {
				targetList = healthyItems.map((it) => ({
					id: it.id,
					owned_by: provider,
				}));
			}
		}
	}

	// 2. Fallback jika ping cache tidak ada atau kosong
	if (targetList.length === 0) {
		try {
			const res = await fetch("http://127.0.0.1:4000/v1/models", {
				signal: AbortSignal.timeout(3000),
			});
			if (res.ok) {
				const data = (await res.json()) as {
					data?: Array<{ id: string; owned_by?: string }>;
				};
				const allModels = data.data || [];
				const provLower = provider.toLowerCase();
				const filtered = allModels.filter((m) => {
					const owned = (m.owned_by || "").toLowerCase();
					const id = (m.id || "").toLowerCase();
					return (
						provLower === "all" ||
						owned.includes(provLower) ||
						id.startsWith(provLower + "/")
					);
				});
				if (filtered.length > 0) {
					targetList = filtered;
				}
			}
		} catch {}

		// Custom models di ~/.omp/agent/models.yml
		const customModels = parseModelsYml();
		const customForProv = customModels.filter((cm) => {
			const id = cm.id.toLowerCase();
			const owned = (cm.owned_by || "").toLowerCase();
			const provLower = provider.toLowerCase();
			return (
				provLower === "all" ||
				owned.includes(provLower) ||
				id.startsWith(provLower + "/")
			);
		});
		for (const cm of customForProv) {
			if (!targetList.some((t) => t.id === cm.id)) {
				targetList.push({ id: cm.id, owned_by: cm.owned_by || provider });
			}
		}

		if (targetList.length === 0) {
			targetList = [{ id: `${provider}/default` }];
		}
	}

	let totalTested = 0;
	let successful = 0;
	let failed = 0;
	let totalLatency = 0;
	let totalTokPerSec = 0;
	let maxTokensPerSec = 0;

	const spinner = options.interactive ? p.spinner() : null;

	for (const item of targetList) {
		totalTested++;
		const displayId = formatModelDisplayId(item.id, provider);
		if (spinner) {
			spinner.start(truncateMiddle(displayId, 42));
		}

		const start = Bun.nanoseconds();
		let statusCode = 0;
		let completionTokens = 0;
		let tokPerSec = 0;
		let status: "OK" | "FAIL" | "RATELIMIT" | "TIMEOUT" = "FAIL";
		let detail = "";

		let benchUrl = "http://127.0.0.1:4000/v1/chat/completions";
		const benchHeaders: Record<string, string> = {
			"Content-Type": "application/json",
		};
		let payloadModelId = item.id;

		const customModels = parseModelsYml();
		const customModel = customModels.find((cm) => cm.id === item.id);
		if (customModel && customModel.baseUrl) {
			const apiType = customModel.api || "openai-completions";
			const suffix =
				apiType === "openai-responses" ? "/responses" : "/chat/completions";
			const cleanBase = customModel.baseUrl.endsWith("/")
				? customModel.baseUrl.slice(0, -1)
				: customModel.baseUrl;
			benchUrl = `${cleanBase}${suffix}`;
			payloadModelId = customModel.localId;
			if (customModel.apiKey) {
				benchHeaders["Authorization"] = `Bearer ${customModel.apiKey}`;
			}
		}

		try {
			let benchRes = await fetch(benchUrl, {
				method: "POST",
				headers: benchHeaders,
				body: JSON.stringify({
					model: payloadModelId,
					messages: [
						{
							role: "user",
							content:
								"Write a 30-word response testing performance benchmark speed.",
						},
					],
					max_tokens: 60,
				}),
				signal: AbortSignal.timeout(10000),
			});

			// Auto-retry with reasoning_effort: "low" if thinking level MINIMAL is unsupported
			if (benchRes.status === 400) {
				try {
					const errRaw = await benchRes.clone().text();
					if (
						errRaw.toLowerCase().includes("thinking") ||
						errRaw.toLowerCase().includes("reasoning")
					) {
						benchRes = await fetch(benchUrl, {
							method: "POST",
							headers: benchHeaders,
							body: JSON.stringify({
								model: payloadModelId,
								messages: [
									{
										role: "user",
										content:
											"Write a 30-word response testing performance benchmark speed.",
									},
								],
								max_tokens: 150,
								reasoning_effort: "low",
							}),
							signal: AbortSignal.timeout(10000),
						});
					}
				} catch {}
			}

			statusCode = benchRes.status;
			const latencyMs = Math.round((Bun.nanoseconds() - start) / 1000000);

			if (benchRes.ok) {
				status = "OK";
				successful++;
				totalLatency += latencyMs;
				detail = "HTTP 200 OK";

				const json = (await benchRes.json()) as any;
				completionTokens = json.usage?.completion_tokens || 30;
				tokPerSec = parseFloat(
					(completionTokens / (latencyMs / 1000) || 0).toFixed(1),
				);
				totalTokPerSec += tokPerSec;
				if (tokPerSec > maxTokensPerSec) {
					maxTokensPerSec = tokPerSec;
				}

				if (spinner) {
					spinner.stop(
						`${ANSI_GREEN}󰄬${ANSI_RESET} ${displayId} (${ANSI_CYAN}${tokPerSec.toFixed(1)} tok/s${ANSI_RESET} • ${latencyMs}ms)`,
					);
				}

				models.push({
					model: item.id,
					status,
					statusCode,
					latencyMs,
					tokensPerSec: tokPerSec,
					completionTokens,
					detail,
				});
			} else {
				failed++;
				status = statusCode === 429 ? "RATELIMIT" : "FAIL";
				detail = `HTTP ${statusCode}`;
				if (spinner) {
					spinner.stop(
						`${status === "RATELIMIT" ? ANSI_YELLOW : ANSI_RED}󰅚${ANSI_RESET} ${displayId} (${detail})`,
					);
				}
				models.push({
					model: item.id,
					status,
					statusCode,
					latencyMs,
					tokensPerSec: 0,
					completionTokens: 0,
					detail,
				});
			}
		} catch (err: any) {
			failed++;
			const latencyMs = Math.round((Bun.nanoseconds() - start) / 1000000);
			status = "TIMEOUT";
			statusCode = 504;
			detail = "Connection Timeout";
			if (spinner) {
				spinner.stop(`${ANSI_RED}󰅖${ANSI_RESET} ${displayId} (Timeout)`);
			}
			models.push({
				model: item.id,
				status,
				statusCode,
				latencyMs,
				tokensPerSec: 0,
				completionTokens: 0,
				detail,
			});
		}
	}

	const avgLatencyMs =
		successful > 0 ? Math.round(totalLatency / successful) : 0;
	const avgTokensPerSec =
		successful > 0 ? parseFloat((totalTokPerSec / successful).toFixed(1)) : 0;

	// Sort successful models by tok/s desc
	const okSorted = models
		.filter((m) => m.status === "OK" && m.statusCode === 200)
		.sort((a, b) => b.tokensPerSec - a.tokensPerSec);

	const championModel = okSorted.length > 0 ? okSorted[0].model : undefined;

	return {
		timestamp: Date.now(),
		provider,
		engineVersion: "2.0.2",
		metrics: {
			totalTested,
			successful,
			failed,
			avgLatencyMs,
			avgTokensPerSec,
			maxTokensPerSec,
			championModel,
		},
		results: {
			models,
		},
	};
}

export async function handleBenchCommand(argv: string[]): Promise<number> {
	// Level-2 Help Check
	if (
		argv.includes("-h") ||
		argv.includes("--help") ||
		(argv.length > 0 && argv[0] === "help")
	) {
		showBenchHelp();
		return 0;
	}

	const hasJsonFlag = argv.includes("--json");
	const forceFlag = argv.includes("--force") || argv.includes("-f");
	const allFlag = argv.includes("--all") || argv.includes("-a");

	let inputProvider = "google-antigravity";
	let topN = 0;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--top") {
			const parsed = parseInt(argv[i + 1], 10);
			if (Number.isFinite(parsed) && parsed > 0) {
				topN = parsed;
				i++;
			}
		} else if (
			!arg.startsWith("-") &&
			arg !== "bench" &&
			arg !== "b" &&
			arg !== "help"
		) {
			inputProvider = arg;
		}
	}

	const { provider } = resolveProviderAlias(inputProvider);

	let payload: BenchCachePayload | null = null;
	let isFromCache = false;

	if (!forceFlag) {
		payload = readGnCache<BenchCachePayload>("bench", provider);
		if (payload) {
			isFromCache = true;
		}
	}

	if (!payload || forceFlag) {
		const isInteractive = Boolean(process.stdout.isTTY && !hasJsonFlag);
		payload = await runLiveBenchmark(provider, {
			all: allFlag,
			interactive: isInteractive,
		});
		writeGnCache("bench", provider, payload);
		isFromCache = false;
	}

	if (hasJsonFlag) {
		console.log(JSON.stringify(payload, null, 2));
		return 0;
	}

	const cachePath = getGnCacheFilePath("bench", provider);
	const timeStr = payload.timestamp
		? new Date(payload.timestamp).toLocaleString("id-ID")
		: "Unknown";

	const allModels = payload.results?.models || [];
	const okModels = allModels
		.filter((m) => m.status === "OK" && m.statusCode === 200)
		.sort(
			(a, b) => b.tokensPerSec - a.tokensPerSec || a.latencyMs - b.latencyMs,
		);

	const failedModels = allModels
		.filter((m) => m.status !== "OK" || m.statusCode !== 200)
		.sort((a, b) => a.statusCode - b.statusCode);

	const maxTokPerSec =
		payload.metrics?.maxTokensPerSec ||
		(okModels.length > 0
			? Math.max(...okModels.map((m) => m.tokensPerSec))
			: 0);

	const displayModels =
		topN > 0 ? okModels.slice(0, topN) : [...okModels, ...failedModels];

	const displayLabels = displayModels.map((m) =>
		getBenchModelLabel(m.model, provider),
	);
	const modelWidth = getBenchModelWidth(displayLabels);

	printGnHeader(`BENCHMARK SPEED MATRIX — ${provider.toUpperCase()}`);
	console.log(
		`  Source       : ${isFromCache ? `${ANSI_CYAN}CACHE (Instant ~5ms)${ANSI_RESET} [${cachePath}]` : `${ANSI_YELLOW}LIVE BENCHMARK HIT (--force)${ANSI_RESET}`}`,
	);
	console.log(`  Target       : ${provider}`);
	console.log(`  Last Tested  : ${timeStr}`);

	if (payload.metrics) {
		console.log(
			`  Metrics      : ${ANSI_GREEN}${payload.metrics.successful} PASSED${ANSI_RESET} / ${ANSI_RED}${payload.metrics.failed} FAILED${ANSI_RESET} (Total: ${payload.metrics.totalTested})`,
		);
		console.log(
			`  Performance  : Avg Latency: ${ANSI_CYAN}${payload.metrics.avgLatencyMs} ms${ANSI_RESET} | Avg Throughput: ${ANSI_BOLD}${payload.metrics.avgTokensPerSec} tok/s${ANSI_RESET}`,
		);
	}
	console.log("");

	if (displayModels.length === 0) {
		console.log(`  ${ANSI_GRAY}No benchmark models found.${ANSI_RESET}\n`);
		return 0;
	}

	// Print Leaderboard Header
	const rankHdr = padVisible("RANK", BENCH_RANK_WIDTH);
	const modelHdr = padVisible("MODEL", modelWidth);
	const latencyHdr = padVisible("LATENCY", BENCH_LATENCY_WIDTH, "right");
	const throughputHdr = padVisible(
		"THROUGHPUT (tok/s)",
		BENCH_BAR_WIDTH + 1 + 6,
	);
	const tokensHdr = padVisible("TOKENS", BENCH_TOKENS_WIDTH, "right");
	const statusHdr = padVisible("STATUS", BENCH_STATUS_WIDTH, "right");

	console.log(
		`  ${ANSI_BOLD}${rankHdr}${BENCH_GAP}${modelHdr}${BENCH_GAP}${latencyHdr}${BENCH_GAP}${throughputHdr}${BENCH_GAP}${tokensHdr}${BENCH_GAP}${statusHdr}${ANSI_RESET}`,
	);

	const sepWidth =
		BENCH_RANK_WIDTH +
		BENCH_GAP.length +
		modelWidth +
		BENCH_GAP.length +
		BENCH_LATENCY_WIDTH +
		BENCH_GAP.length +
		BENCH_BAR_WIDTH +
		1 +
		6 +
		BENCH_GAP.length +
		BENCH_TOKENS_WIDTH +
		BENCH_GAP.length +
		BENCH_STATUS_WIDTH;
	console.log(`  ${ANSI_GRAY}${"─".repeat(sepWidth)}${ANSI_RESET}`);

	// Print Rows
	let rankCounter = 1;
	for (const item of displayModels) {
		const isOk = item.status === "OK" && item.statusCode === 200;
		const displayId = getBenchModelLabel(item.model, provider);
		const modelLabel = padVisible(
			truncateMiddle(displayId, modelWidth),
			modelWidth,
		);

		let rankStr = `${ANSI_GRAY} -- ${ANSI_RESET}`;
		if (isOk) {
			const rNum = `#${rankCounter++}`;
			if (rankCounter - 1 === 1) {
				rankStr = `${ANSI_BOLD}${ANSI_CYAN}${padVisible(rNum, BENCH_RANK_WIDTH)}${ANSI_RESET}`;
			} else if (rankCounter - 1 <= 3) {
				rankStr = `${ANSI_BOLD}${ANSI_GREEN}${padVisible(rNum, BENCH_RANK_WIDTH)}${ANSI_RESET}`;
			} else {
				rankStr = `${ANSI_BOLD}${padVisible(rNum, BENCH_RANK_WIDTH)}${ANSI_RESET}`;
			}
		}

		let latencyStr = padVisible("-", BENCH_LATENCY_WIDTH, "right");
		if (isOk) {
			let latColor = ANSI_GREEN;
			if (item.latencyMs >= 3000) latColor = ANSI_RED;
			else if (item.latencyMs >= 1000) latColor = ANSI_YELLOW;
			latencyStr = `${latColor}${padVisible(`${item.latencyMs} ms`, BENCH_LATENCY_WIDTH, "right")}${ANSI_RESET}`;
		}

		const bar = formatThroughputBar(
			item.tokensPerSec,
			maxTokPerSec,
			BENCH_BAR_WIDTH,
		);
		const tokNumStr = padVisible(item.tokensPerSec.toFixed(1), 5, "right");
		const throughputStr = `${bar} ${tokNumStr}`;

		const tokensStr = padVisible(
			isOk ? `${item.completionTokens} tok` : "0 tok",
			BENCH_TOKENS_WIDTH,
			"right",
		);
		const statusStr = padVisible(
			formatBenchStatus(item.status, item.statusCode),
			BENCH_STATUS_WIDTH,
			"right",
		);

		console.log(
			`  ${rankStr}${BENCH_GAP}${ANSI_BOLD}${modelLabel}${ANSI_RESET}${BENCH_GAP}${latencyStr}${BENCH_GAP}${throughputStr}${BENCH_GAP}${tokensStr}${BENCH_GAP}${statusStr}`,
		);
	}

	// Champion Summary
	if (okModels.length > 0) {
		const champ = okModels[0];
		const champDisplay = getBenchModelLabel(champ.model, provider);
		console.log("");
		console.log(
			`  🏆 ${ANSI_BOLD}Champion${ANSI_RESET} : ${ANSI_BOLD}${ANSI_CYAN}${champDisplay}${ANSI_RESET} (${ANSI_BOLD}${champ.tokensPerSec.toFixed(1)} tok/s${ANSI_RESET} • ${ANSI_GREEN}${champ.latencyMs} ms${ANSI_RESET})`,
		);
	}

	console.log("");
	if (isFromCache) {
		console.log(
			`  ${ANSI_GRAY}💡 Hint: Jalankan '${ANSI_CYAN}gn bench ${provider} --force${ANSI_GRAY}' untuk live re-test & perbarui cache.${ANSI_RESET}\n`,
		);
	}

	return 0;
}
