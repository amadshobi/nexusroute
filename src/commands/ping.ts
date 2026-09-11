import * as fs from "fs";
import * as net from "net";
import * as p from "@clack/prompts";
import { getOpenCodeDb } from "../utils/db";
import { readGnCache, writeGnCache } from "../utils/paths";
import {
	resolveProviderAlias,
	formatModelDisplayId,
	parseModelsYml,
} from "../utils/ping-config";
import {
	printGnHeader,
	formatBoxTable,
	ANSI_BOLD,
	ANSI_RESET,
	ANSI_GRAY,
	ANSI_CYAN,
	ANSI_GREEN,
	ANSI_RED,
	ANSI_YELLOW,
} from "../utils/formatter";

export interface PingItem {
	id: string;
	status: "OK" | "FAIL" | "RATELIMIT" | "TIMEOUT";
	statusCode: number;
	latencyMs: number;
	detail: string;
}

export interface PingCachePayload {
	timestamp: number;
	provider: string;
	items: PingItem[];
	logLines?: string[];
}

function showPingHelp(): void {
	printGnHeader("PING ENGINE MANUAL");
	console.log("USAGE");
	console.log("  $ gn p <provider|local> [flags]");
	console.log("");
	console.log("TARGETS");
	console.log(
		"  <provider>   Nama provider / alias di ~/.config/gn/config.json",
	);
	console.log(
		"  local        Status port & service lokal (Gateway 4000, Broker 4001, Ollama, DB)",
	);
	console.log("");
	console.log("FLAGS");
	console.log("  -f, --force  Bypass cache & hit live request per-model");
	console.log("  --json       Output mentah format JSON");
	console.log("");
	console.log("EXAMPLES");
	console.log(
		"  $ gn p <provider>          # Baca cache model provider (Instant & 200 OK only)",
	);
	console.log("  $ gn p <provider> --force  # Hit live request ke provider");
	console.log(
		"  $ gn p local               # Cek kesehatan service & port lokal",
	);
	console.log("");
}

/**
 * Generates dynamic thin latency bar (━━━━────────).
 * If isOk is false or latencyMs < 0, returns a solid RED bar.
 */
function formatLatencyBar(
	latencyMs: number,
	isOk: boolean,
	width: number = 12,
): string {
	if (!isOk || latencyMs < 0) {
		return `${ANSI_RED}${"─".repeat(width)}${ANSI_RESET}`;
	}

	const fraction = Math.min(1, Math.max(0.1, latencyMs / 5000));
	const filled = Math.round(fraction * width);
	const empty = width - filled;

	let color = ANSI_GREEN;
	if (latencyMs >= 3000) color = ANSI_RED;
	else if (latencyMs >= 1000) color = ANSI_YELLOW;

	const filledStr = `${color}${"━".repeat(filled)}${ANSI_RESET}`;
	const emptyStr = `${ANSI_GRAY}${"─".repeat(empty)}${ANSI_RESET}`;
	return `${filledStr}${emptyStr}`;
}

const PING_BAR_WIDTH = 12;
const PING_STATUS_WIDTH = 6;
const PING_LATENCY_WIDTH = 8;
const PING_ROW_GAP = "  ";
const PING_REQUEST_TIMEOUT_MS = 10000;
const PING_MAX_TOKENS = 50;

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

function getPingModelWidth(labels: string[]): number {
	const terminalWidth = process.stdout.columns || 88;
	const fixedWidth =
		2 +
		PING_ROW_GAP.length +
		PING_LATENCY_WIDTH +
		PING_ROW_GAP.length +
		PING_BAR_WIDTH +
		PING_ROW_GAP.length +
		PING_STATUS_WIDTH;
	const available = Math.max(18, terminalWidth - fixedWidth);
	const longest = Math.max(18, ...labels.map((label) => visibleWidth(label)));
	return Math.min(longest, available, 48);
}

function formatPingStatus(item: PingItem): string {
	if (item.status === "OK" && item.statusCode === 200) {
		return `${ANSI_GREEN}${padVisible("200", PING_STATUS_WIDTH, "right")}${ANSI_RESET}`;
	}
	if (item.status === "RATELIMIT" || item.statusCode === 429) {
		return `${ANSI_YELLOW}${padVisible(String(item.statusCode || 429), PING_STATUS_WIDTH, "right")}${ANSI_RESET}`;
	}
	return `${ANSI_RED}${padVisible(String(item.statusCode || 500), PING_STATUS_WIDTH, "right")}${ANSI_RESET}`;
}

function formatPingLatency(item: PingItem): string {
	if (item.status === "OK" && item.statusCode === 200 && item.latencyMs >= 0) {
		return `${ANSI_CYAN}${padVisible(`${item.latencyMs} ms`, PING_LATENCY_WIDTH, "right")}${ANSI_RESET}`;
	}
	return `${ANSI_GRAY}${padVisible(item.status === "TIMEOUT" ? "timeout" : "error", PING_LATENCY_WIDTH, "right")}${ANSI_RESET}`;
}

function formatPingRow(
	label: string,
	item: PingItem,
	modelWidth: number,
): string {
	const isOk = item.status === "OK" && item.statusCode === 200;
	const modelLabel = padVisible(truncateMiddle(label, modelWidth), modelWidth);
	const latency = formatPingLatency(item);
	const bar = formatLatencyBar(item.latencyMs, isOk, PING_BAR_WIDTH);
	const status = formatPingStatus(item);
	return `  ${ANSI_BOLD}${modelLabel}${ANSI_RESET}${PING_ROW_GAP}${latency}${PING_ROW_GAP}${bar}${PING_ROW_GAP}${status}`;
}

function printPingRows(items: PingItem[], labels: string[]): void {
	const modelWidth = getPingModelWidth(labels);
	items.forEach((item, index) => {
		console.log(formatPingRow(labels[index] || item.id, item, modelWidth));
	});
}

function checkPort(
	port: number,
	host = "127.0.0.1",
	timeoutMs = 1000,
): Promise<number> {
	return new Promise((resolve) => {
		const start = performance.now();
		const socket = new net.Socket();
		socket.setTimeout(timeoutMs);

		socket.on("connect", () => {
			const lat = Math.round(performance.now() - start);
			socket.destroy();
			resolve(lat);
		});

		socket.on("timeout", () => {
			socket.destroy();
			resolve(-1);
		});

		socket.on("error", () => {
			socket.destroy();
			resolve(-1);
		});

		socket.connect(port, host);
	});
}

async function pingLocalServices(): Promise<PingCachePayload> {
	const items: PingItem[] = [];

	// 1. OMP Gateway (Port 4000)
	const gatewayLat = await checkPort(4000);
	items.push({
		id: "OMP Gateway (Port 4000)",
		status: gatewayLat >= 0 ? "OK" : "FAIL",
		statusCode: gatewayLat >= 0 ? 200 : 503,
		latencyMs: gatewayLat,
		detail:
			gatewayLat >= 0 ? "127.0.0.1:4000 (Connected)" : "Port 4000 unreachable",
	});

	// 2. OMP Broker (Port 4001)
	const brokerLat = await checkPort(4001);
	items.push({
		id: "OMP Broker (Port 4001)",
		status: brokerLat >= 0 ? "OK" : "FAIL",
		statusCode: brokerLat >= 0 ? 200 : 503,
		latencyMs: brokerLat,
		detail:
			brokerLat >= 0 ? "127.0.0.1:4001 (Connected)" : "Port 4001 unreachable",
	});

	// 3. Ollama API (Port 11434)
	const ollamaLat = await checkPort(11434);
	items.push({
		id: "Ollama Engine (Port 11434)",
		status: ollamaLat >= 0 ? "OK" : "FAIL",
		statusCode: ollamaLat >= 0 ? 200 : 503,
		latencyMs: ollamaLat,
		detail: ollamaLat >= 0 ? "127.0.0.1:11434 (Connected)" : "Engine offline",
	});

	// 4. OpenCode SQLite Database
	const startDb = Bun.nanoseconds();
	let dbOk = false;
	const dbPath = getOpenCodeDb();
	if (dbPath && fs.existsSync(dbPath)) {
		try {
			const fd = fs.openSync(dbPath, "r");
			fs.closeSync(fd);
			dbOk = true;
		} catch {}
	}
	const dbLat = Math.round((Bun.nanoseconds() - startDb) / 1000000);
	items.push({
		id: "OpenCode SQLite Database",
		status: dbOk ? "OK" : "FAIL",
		statusCode: dbOk ? 200 : 500,
		latencyMs: dbOk ? dbLat : -1,
		detail: dbOk ? "Read access OK" : "DB file inaccessible",
	});

	return {
		timestamp: Date.now(),
		provider: "local",
		items,
	};
}

async function pingProviderLive(provider: string): Promise<PingCachePayload> {
	const items: PingItem[] = [];

	try {
		const res = await fetch("http://127.0.0.1:4000/v1/models", {
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) {
			items.push({
				id: provider,
				status: "FAIL",
				statusCode: res.status,
				latencyMs: -1,
				detail: `HTTP Error ${res.status}`,
			});
			return { timestamp: Date.now(), provider, items };
		}

		const data = (await res.json()) as {
			data?: Array<{ id: string; owned_by?: string }>;
		};
		const allModels = [...(data.data || []), ...parseModelsYml()];
		const filtered = allModels.filter((m) => {
			const owned = (m.owned_by || "").toLowerCase();
			const id = (m.id || "").toLowerCase();
			const provLower = provider.toLowerCase();
			return owned.includes(provLower) || id.startsWith(provLower + "/");
		});

		if (filtered.length === 0) {
			items.push({
				id: provider,
				status: "FAIL",
				statusCode: 404,
				latencyMs: -1,
				detail: "No active models found",
			});
			return { timestamp: Date.now(), provider, items };
		}

		console.log(
			`  ${ANSI_GRAY}Live test: ${filtered.length} models${ANSI_RESET}\n`,
		);

		const sampleModels = filtered;
		const displayIds = sampleModels.map((m) =>
			formatModelDisplayId(m.id, provider),
		);
		const modelWidth = getPingModelWidth(displayIds);

		for (let i = 0; i < sampleModels.length; i++) {
			const model = sampleModels[i];
			const displayId =
				displayIds[i] || formatModelDisplayId(model.id, provider);

			const start = Bun.nanoseconds();
			let status: "OK" | "FAIL" | "RATELIMIT" | "TIMEOUT" = "FAIL";
			let statusCode = 0;
			let latencyMs = -1;
			let detail = "";
			const spinner = p.spinner();
			spinner.start(truncateMiddle(displayId, 42));

			let pingUrl = "http://127.0.0.1:4000/v1/chat/completions";
			const pingHeaders: Record<string, string> = {
				"Content-Type": "application/json",
			};
			let payloadModelId = model.id;

			const customModels = parseModelsYml();
			const customModel = customModels.find((cm) => cm.id === model.id);
			if (customModel && customModel.baseUrl) {
				const apiType = customModel.api || "openai-completions";
				const suffix =
					apiType === "openai-responses" ? "/responses" : "/chat/completions";
				const cleanBase = customModel.baseUrl.endsWith("/")
					? customModel.baseUrl.slice(0, -1)
					: customModel.baseUrl;
				pingUrl = `${cleanBase}${suffix}`;
				payloadModelId = customModel.localId;
				if (customModel.apiKey) {
					pingHeaders["Authorization"] = `Bearer ${customModel.apiKey}`;
				}
			}

			try {
				let pingRes = await fetch(pingUrl, {
					method: "POST",
					headers: pingHeaders,
					body: JSON.stringify({
						model: payloadModelId,
						messages: [{ role: "user", content: "Reply with only: ok" }],
						max_tokens: PING_MAX_TOKENS,
					}),
					signal: AbortSignal.timeout(PING_REQUEST_TIMEOUT_MS),
				});

				// Auto-retry with reasoning_effort: "low" if thinking level MINIMAL is unsupported
				if (pingRes.status === 400) {
					try {
						const errRaw = await pingRes.clone().text();
						if (
							errRaw.toLowerCase().includes("thinking") ||
							errRaw.toLowerCase().includes("reasoning")
						) {
							pingRes = await fetch(pingUrl, {
								method: "POST",
								headers: pingHeaders,
								body: JSON.stringify({
									model: payloadModelId,
									messages: [{ role: "user", content: "Reply with only: ok" }],
									max_tokens: 150,
									reasoning_effort: "low",
								}),
								signal: AbortSignal.timeout(PING_REQUEST_TIMEOUT_MS),
							});
						}
					} catch {}
				}

				latencyMs = Math.round((Bun.nanoseconds() - start) / 1000000);
				statusCode = pingRes.status;

				if (pingRes.ok) {
					status = "OK";
					detail = "HTTP 200 OK";
				} else if (pingRes.status === 429) {
					status = "RATELIMIT";
					detail = "429 Quota Exceeded";
				} else {
					status = "FAIL";
					detail = `HTTP ${pingRes.status}`;
				}
			} catch (err: any) {
				latencyMs = Math.round((Bun.nanoseconds() - start) / 1000000);
				status = "TIMEOUT";
				statusCode = 504;
				detail = `Connection Timeout (${PING_REQUEST_TIMEOUT_MS / 1000}s)`;
			}
			const is200 = status === "OK" && statusCode === 200;
			const liveItem: PingItem = {
				id: model.id,
				status,
				statusCode,
				latencyMs: is200 ? latencyMs : -1,
				detail,
			};

			spinner.stop(formatPingRow(displayId, liveItem, modelWidth).trimStart());

			items.push(liveItem);
		}

		console.log("");
	} catch (err: any) {
		items.push({
			id: provider,
			status: "FAIL",
			statusCode: 500,
			latencyMs: -1,
			detail: `Gateway Error: ${err.message}`,
		});
	}

	return {
		timestamp: Date.now(),
		provider,
		items,
	};
}

function parseLegacyLogLines(lines: string[]): PingItem[] {
	const items: PingItem[] = [];
	for (const line of lines) {
		const isOk =
			line.includes("200 OK") || line.includes("✅") || line.includes("󰄬");
		const isRateLimit = line.includes("429") || line.includes("RATELIMIT");

		let cleanId = line.replace(/^\s*(?:[^\s]+\s+)?\[[^\]]+\]\s*/, "").trim();
		if (cleanId.includes("|")) {
			cleanId = cleanId.split("|")[0].trim();
		}

		const latencyPart = line.split("|").find((p) => p.includes("ms"));
		const latMatch = latencyPart ? latencyPart.match(/(\d+)\s*ms/) : null;
		const lat = latMatch ? parseInt(latMatch[1], 10) : -1;

		items.push({
			id: cleanId,
			status: isOk ? "OK" : isRateLimit ? "RATELIMIT" : "FAIL",
			statusCode: isOk ? 200 : isRateLimit ? 429 : 500,
			latencyMs: isOk ? lat : -1,
			detail: isOk ? "HTTP 200 OK" : "Error",
		});
	}
	return items;
}

export async function handlePingCommand(argv: string[]): Promise<number> {
	const hasJsonFlag = argv.includes("--json");
	const forceFlag = argv.includes("--force") || argv.includes("-f");

	if (
		argv.length === 0 ||
		argv.includes("--help") ||
		argv.includes("-h") ||
		argv.includes("help")
	) {
		showPingHelp();
		return 0;
	}

	let rawProviderArg = "";
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith("-") && arg !== "ping" && arg !== "p") {
			rawProviderArg = arg;
			break;
		}
	}

	if (!rawProviderArg) {
		showPingHelp();
		return 0;
	}

	if (
		rawProviderArg === "local" ||
		rawProviderArg === "sys" ||
		rawProviderArg === "core"
	) {
		printGnHeader("LOCAL SERVICE HEALTH");
		const localPayload = await pingLocalServices();
		if (hasJsonFlag) {
			console.log(JSON.stringify(localPayload, null, 2));
			return 0;
		}

		const labels = localPayload.items.map((item) => item.id);
		printPingRows(localPayload.items, labels);
		console.log("");
		return 0;
	}

	const { provider } = resolveProviderAlias(rawProviderArg);

	let payload: PingCachePayload | null = null;

	if (!forceFlag) {
		payload = readGnCache<PingCachePayload>("ping", provider);
	}

	if (forceFlag || !payload) {
		printGnHeader(`PING ENGINE — ${provider.toUpperCase()}`);
		payload = await pingProviderLive(provider);
		writeGnCache("ping", provider, payload);
		return 0;
	}

	if (hasJsonFlag) {
		console.log(JSON.stringify(payload, null, 2));
		return 0;
	}

	// --- CACHE MODE: keep cached provider view as boxed table (do not flatten cache output) ---
	printGnHeader(`PING ENGINE — ${provider.toUpperCase()}`);

	let items: PingItem[] = payload.items || [];
	// Cache format lama menyimpan log di payload.results.logLines (bukan items)
	const legacyPayload = payload as PingCachePayload & {
		results?: { logLines?: string[] };
	};
	if (
		items.length === 0 &&
		legacyPayload.results &&
		Array.isArray(legacyPayload.results.logLines)
	) {
		items = parseLegacyLogLines(legacyPayload.results.logLines);
	}

	// Filter ONLY HTTP 200 OK models
	const okItems = items.filter(
		(item) => item.status === "OK" || item.statusCode === 200,
	);

	if (okItems.length === 0) {
		console.log(
			`  ${ANSI_GRAY}No active 200 OK models found in cache.${ANSI_RESET}\n`,
		);
		return 0;
	}

	const rows = okItems.map((item) => {
		const displayId = formatModelDisplayId(item.id, provider);
		const latStr = item.latencyMs >= 0 ? `${item.latencyMs} ms` : "-";
		const statusBadge = `${ANSI_GREEN}󰄬 200${ANSI_RESET}`;
		return [displayId, latStr, statusBadge];
	});

	const tableTitle = `PING ENGINE — ${provider.toUpperCase()}`;
	console.log(formatBoxTable(tableTitle, [], rows));
	console.log("");

	return 0;
}
