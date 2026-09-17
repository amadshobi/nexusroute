/**
 * ─────────────────────────────────────────────────────────────
 * Goblin Nexus — Gateway Access Logger & Analytics Engine
 * ─────────────────────────────────────────────────────────────
 *
 * Logging terstruktur append-only JSONL untuk audit traffic gateway,
 * tracking performa cache, cascading fallback hop history,
 * dan rendering format CLI yang rapi.
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	openSync,
	readSync,
	closeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	ANSI_BOLD,
	ANSI_BOLD_WHITE,
	ANSI_CYAN,
	ANSI_GRAY,
	ANSI_GREEN,
	ANSI_RED,
	ANSI_RESET,
	ANSI_YELLOW,
	formatBoxTable,
} from "../utils/formatter";

export interface FallbackHop {
	model: string;
	status: number;
	ok: boolean;
}

export interface AccessLogEntry {
	ts: number;
	method: string;
	path: string;
	initialModel: string;
	servedModel: string;
	status: number;
	latencyMs: number;
	cache: "HIT" | "MISS" | "BYPASS" | "NONE";
	stream: boolean;
	tokensInput?: number;
	tokensOutput?: number;
	tokensCache?: number;
	tokensTotal?: number;
	fallback?: {
		chain: FallbackHop[];
		hopCount: number;
	};
	shieldRedacted: number;
	upstream?: string; // Transport Gateway: "omp" | "vansrouter" | "commandcode"
	provider?: string; // Real AI Engine: "antigravity" | "commandcode" | "deepseek" | "ollama" | etc.
	client?: string; // Caller Application: "opencode" | "hermes" | "curl" | etc.
	salvaged?: "thought-only" | "malformed-call" | "upstream-error";
	error?: string;
}

export interface AccessLogFilter {
	errorsOnly?: boolean;
	model?: string;
	limit?: number;
	since?: number;
}

const NEW_ACCESS_LOG_PATH = join(
	homedir(),
	".cache",
	"nexus",
	"gateway",
	"access.jsonl",
);
const LEGACY_ACCESS_LOG_PATH = join(
	homedir(),
	".cache",
	"gn",
	"gateway",
	"access.jsonl",
);

/**
 * Resolve default access log path: pakai `~/.cache/nexus/gateway/access.jsonl`
 * bila ada, fallback ke legacy `~/.cache/gn/gateway/access.jsonl` bila ada,
 * jika tidak default kanonik baru = `~/.cache/nexus/gateway/access.jsonl`.
 */
export function resolveDefaultAccessLogPath(): string {
	if (existsSync(NEW_ACCESS_LOG_PATH)) return NEW_ACCESS_LOG_PATH;
	if (existsSync(LEGACY_ACCESS_LOG_PATH)) return LEGACY_ACCESS_LOG_PATH;
	return NEW_ACCESS_LOG_PATH;
}

/** Backward-compatible snapshot default (dievaluasi saat import). */
export const DEFAULT_ACCESS_LOG_PATH = resolveDefaultAccessLogPath();

const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per log segment

/** Static web asset file extensions that must never enter the access log. */
const STATIC_ASSET_EXTENSIONS = [
	".svg",
	".ico",
	".png",
	".jpg",
	".js",
	".css",
	".woff",
	".woff2",
];

/** Exact paths used by lightweight discovery probes (Ollama-style). */
const PROBE_PATHS = new Set(["/api/tags", "/version", "/props", "/v1/props"]);

/** True when the path points at a compiled static web asset. */
export function isStaticAssetPath(pathname: string): boolean {
	if (!pathname) return false;
	const lower = pathname.toLowerCase();
	if (lower.startsWith("/assets/")) return true;
	for (const ext of STATIC_ASSET_EXTENSIONS) {
		if (lower.endsWith(ext)) return true;
	}
	return false;
}

/** True when the path is a lightweight discovery probe. */
export function isProbePath(pathname: string): boolean {
	return PROBE_PATHS.has((pathname || "").toLowerCase());
}

/**
 * Returns true when a request path is internal plumbing (static bundle assets,
 * dashboard SPA routes, or discovery probes) and therefore must not be written
 * to `access.jsonl`.
 */
export function isInternalRequestPath(pathname: string): boolean {
	if (!pathname) return false;
	const lower = pathname.toLowerCase();
	if (lower === "/dashboard" || lower.startsWith("/dashboard/")) return true;
	return isStaticAssetPath(lower) || isProbePath(lower);
}

export class AccessLogManager {
	private logPath: string;

	constructor(logPath: string = resolveDefaultAccessLogPath()) {
		this.logPath = logPath;
		this.ensureDir();
	}

	private ensureDir(): void {
		const dir = dirname(this.logPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
	}

	/**
	 * Append 1 entry log secara aman dengan rotasi otomatis jika > 10MB.
	 * Internal static assets and probe requests are dropped before writing.
	 */
	public write(entry: AccessLogEntry): void {
		if (isInternalRequestPath(entry.path)) {
			return;
		}

		try {
			this.ensureDir();

			// Rotasi jika melebihi ukuran batas
			if (existsSync(this.logPath)) {
				try {
					const stats = statSync(this.logPath);
					if (stats.size >= MAX_LOG_SIZE_BYTES) {
						const rotatedPath = `${this.logPath}.1`;
						renameSync(this.logPath, rotatedPath);
					}
				} catch {
					// Lanjutkan jika stat/rotasi gagal
				}
			}

			const line = JSON.stringify(entry) + "\n";
			appendFileSync(this.logPath, line, { mode: 0o600 });
		} catch (err) {
			// Best effort — jangan pernah throw ke pipeline request utama
			process.stderr.write(
				`⚠️  [GN AccessLog] Failed to append access log: ${(err as Error).message}\n`,
			);
		}
	}

	/**
	 * Baca entri log terkini dengan filter opsional.
	 */
	public readLogs(filter: AccessLogFilter = {}): AccessLogEntry[] {
		if (!existsSync(this.logPath)) {
			return [];
		}

		try {
			const filesToRead = [this.logPath];
			const rotated = `${this.logPath}.1`;
			if (existsSync(rotated)) {
				filesToRead.unshift(rotated);
			}

			const entries: AccessLogEntry[] = [];

			for (const file of filesToRead) {
				const content = readFileSync(file, "utf-8");
				const lines = content.split("\n").filter(Boolean);

				for (const line of lines) {
					try {
						const parsed = JSON.parse(line) as AccessLogEntry;
						if (this.matchesFilter(parsed, filter)) {
							entries.push(parsed);
						}
					} catch {
						// Abaikan baris rusak
					}
				}
			}

			// Kalau filter.limit dispesifikasikan, potong sesuai permintaan; kalau tidak ada, KELUARKAN SEMUA TANPA BATASAN!
			if (typeof filter.limit === "number" && filter.limit > 0) {
				return entries.slice(-filter.limit);
			}
			return entries;
		} catch {
			return [];
		}
	}

	/**
	 * Ambil limit entri log terbaru (tail).
	 * Konvenien wrapper untuk readLogs dengan limit eksplisit.
	 */
	public readTail(limit: number = 50): AccessLogEntry[] {
		return this.readLogs({ limit });
	}

	/**
	 * Stream live entries (polling tail -f loop).
	 */
	public async streamLogs(
		filter: AccessLogFilter,
		onEntry: (entry: AccessLogEntry) => void,
		signal?: AbortSignal,
	): Promise<void> {
		this.ensureDir();
		let lastSize = existsSync(this.logPath) ? statSync(this.logPath).size : 0;

		while (!signal?.aborted) {
			await new Promise((r) => setTimeout(r, 250));

			if (!existsSync(this.logPath)) continue;

			try {
				const currentSize = statSync(this.logPath).size;
				if (currentSize < lastSize) {
					// File dirotasi
					lastSize = 0;
				}

				if (currentSize > lastSize) {
					const bytesToRead = currentSize - lastSize;
					const fd = openSync(this.logPath, "r");
					const buffer = Buffer.alloc(bytesToRead);
					readSync(fd, buffer, 0, bytesToRead, lastSize);
					closeSync(fd);

					lastSize = currentSize;
					const chunk = buffer.toString("utf-8");
					const lines = chunk.split("\n").filter(Boolean);

					for (const line of lines) {
						try {
							const parsed = JSON.parse(line) as AccessLogEntry;
							if (this.matchesFilter(parsed, filter)) {
								onEntry(parsed);
							}
						} catch {
							// Skip
						}
					}
				}
			} catch {
				// Polling error resilience
			}
		}
	}

	private matchesFilter(
		entry: AccessLogEntry,
		filter: AccessLogFilter,
	): boolean {
		if (typeof filter.since === "number" && entry.ts < filter.since) {
			return false;
		}

		if (filter.errorsOnly && entry.status < 400 && !entry.error) {
			return false;
		}

		if (filter.model) {
			const q = filter.model.toLowerCase();
			const m1 = (entry.initialModel || "").toLowerCase();
			const m2 = (entry.servedModel || "").toLowerCase();
			if (!m1.includes(q) && !m2.includes(q)) {
				return false;
			}
		}

		return true;
	}
}

/**
 * Format rantai fallback secara visual dengan indikator status per-hop.
 * Contoh: ✖ kilo-auto (503) → ✓ minimax-m3
 */
export function formatModelChain(entry: AccessLogEntry): string {
	if (!entry.fallback || entry.fallback.chain.length <= 1) {
		return entry.servedModel || entry.initialModel || "-";
	}

	const chain = entry.fallback.chain;
	const parts = chain.map((hop) => {
		const shortName = shortenModel(hop.model);
		if (hop.ok) {
			return `${ANSI_GREEN}✓ ${shortName}${ANSI_RESET}`;
		}
		return `${ANSI_RED}✖ ${shortName}${ANSI_RESET} ${ANSI_GRAY}(${hop.status})${ANSI_RESET}`;
	});

	return parts.join(` ${ANSI_YELLOW}→${ANSI_RESET} `);
}

function shortenModel(name: string): string {
	if (!name) return "-";
	const slash = name.lastIndexOf("/");
	if (slash >= 0 && slash < name.length - 1) {
		return name.slice(slash + 1);
	}
	return name;
}

/**
 * Render tabel log visual yang rapi dan elegan.
 */
export function renderAccessLogsTable(entries: AccessLogEntry[]): string {
	if (entries.length === 0) {
		return `  ${ANSI_GRAY}󰋽 No request history recorded in access log yet.${ANSI_RESET}\n`;
	}

	const rows = entries.map((entry) => {
		// 1. Time (HH:MM:SS)
		const d = new Date(entry.ts);
		const timeStr = d.toTimeString().slice(0, 8);

		// 2. Method + Path
		const methodColor =
			entry.method === "POST"
				? ANSI_CYAN
				: entry.method === "GET"
					? ANSI_GREEN
					: ANSI_RESET;
		const methodPath = `${methodColor}${entry.method}${ANSI_RESET} ${entry.path.replace("/v1/", "")}`;

		// 3. Model / Fallback Chain
		const modelChain = formatModelChain(entry);

		// 4. Status Badge
		let statusBadge = `${ANSI_GREEN}${entry.status} OK${ANSI_RESET}`;
		if (entry.status >= 500 || entry.error) {
			statusBadge = `${ANSI_RED}✖ ${entry.status || "ERR"}${ANSI_RESET}`;
		} else if (entry.status >= 400) {
			statusBadge = `${ANSI_YELLOW}⚠ ${entry.status}${ANSI_RESET}`;
		} else if (entry.fallback && entry.fallback.hopCount > 1) {
			statusBadge = `${ANSI_YELLOW}⚠ FB×${entry.fallback.hopCount - 1}${ANSI_RESET}`;
		}

		// 5. Cache Badge
		let cacheBadge = `${ANSI_GRAY}MISS${ANSI_RESET}`;
		if (entry.cache === "HIT") {
			cacheBadge = `${ANSI_GREEN}${ANSI_BOLD}HIT${ANSI_RESET}`;
		} else if (entry.cache === "BYPASS") {
			cacheBadge = `${ANSI_YELLOW}BYPASS${ANSI_RESET}`;
		}

		// 6. Latency
		const latencyStr = `${entry.latencyMs}ms`;

		// 7. Tokens (In / Out)
		let tokensStr = `${ANSI_GRAY}-${ANSI_RESET}`;
		if (
			typeof entry.tokensInput === "number" ||
			typeof entry.tokensOutput === "number"
		) {
			const inStr =
				entry.tokensInput !== undefined
					? `${(entry.tokensInput / 1000).toFixed(1)}k`
					: "0";
			const outStr =
				entry.tokensOutput !== undefined
					? `${(entry.tokensOutput / 1000).toFixed(1)}k`
					: "0";
			tokensStr = `${ANSI_CYAN}${inStr}${ANSI_RESET}/${ANSI_GREEN}${outStr}${ANSI_RESET}`;
		}

		// 8. Shield Flag (Nerd Font icon, zero emoji)
		const shieldStr =
			entry.shieldRedacted > 0
				? `${ANSI_YELLOW}[S:${entry.shieldRedacted}]${ANSI_RESET}`
				: `${ANSI_GRAY}-${ANSI_RESET}`;

		return [
			timeStr,
			methodPath,
			modelChain,
			statusBadge,
			cacheBadge,
			latencyStr,
			tokensStr,
			shieldStr,
		];
	});

	const headers = [
		"Time",
		"Endpoint",
		"Model / Fallback Chain",
		"Status",
		"Cache",
		"Latency",
		"Tokens (In/Out)",
		"Shield",
	];

	const table = formatBoxTable(
		"GATEWAY TRAFFIC & FALLBACK LOGS",
		headers,
		rows,
	);

	// Ringkasan Agregasi Footer
	const total = entries.length;
	const hits = entries.filter((e) => e.cache === "HIT").length;
	const misses = entries.filter((e) => e.cache === "MISS").length;
	const fallbacks = entries.filter(
		(e) => e.fallback && e.fallback.hopCount > 1,
	).length;
	const errors = entries.filter((e) => e.status >= 400 || e.error).length;
	const hitRate = total > 0 ? Math.round((hits / total) * 100) : 0;

	const footer = [
		` ${ANSI_BOLD_WHITE}Traffic Summary:${ANSI_RESET}`,
		` Total: ${ANSI_CYAN}${total}${ANSI_RESET}`,
		` Hits: ${ANSI_GREEN}${hits}${ANSI_RESET}`,
		` Misses: ${ANSI_GRAY}${misses}${ANSI_RESET}`,
		` Hit Rate: ${hits > 0 ? ANSI_GREEN : ANSI_GRAY}${hitRate}%${ANSI_RESET}`,
		` Fallbacks: ${fallbacks > 0 ? ANSI_YELLOW : ANSI_GRAY}${fallbacks}${ANSI_RESET}`,
		` Errors: ${errors > 0 ? ANSI_RED : ANSI_GREEN}${errors}${ANSI_RESET}`,
	].join(" │ ");

	return `${table}\n${footer}\n`;
}

/**
 * Render satu baris format streaming untuk mode live tail (-s).
 */
export function formatLiveLogLine(entry: AccessLogEntry): string {
	const d = new Date(entry.ts);
	const timeStr = d.toTimeString().slice(0, 8);

	const methodColor =
		entry.method === "POST"
			? ANSI_CYAN
			: entry.method === "GET"
				? ANSI_GREEN
				: ANSI_RESET;
	const methodPath = `${methodColor}${entry.method}${ANSI_RESET} ${entry.path.replace("/v1/", "")}`;

	let statusBadge = `${ANSI_GREEN}${entry.status} OK${ANSI_RESET}`;
	if (entry.status >= 500 || entry.error) {
		statusBadge = `${ANSI_RED}✖ ${entry.status || "ERR"}${ANSI_RESET}`;
	} else if (entry.status >= 400) {
		statusBadge = `${ANSI_YELLOW}⚠ ${entry.status}${ANSI_RESET}`;
	} else if (entry.fallback && entry.fallback.hopCount > 1) {
		statusBadge = `${ANSI_YELLOW}⚠ FB×${entry.fallback.hopCount - 1}${ANSI_RESET}`;
	}

	let cacheBadge = `${ANSI_GRAY}MISS${ANSI_RESET}`;
	if (entry.cache === "HIT") {
		cacheBadge = `${ANSI_GREEN}${ANSI_BOLD}HIT${ANSI_RESET}`;
	}

	const modelChain = formatModelChain(entry);
	const shieldStr = entry.shieldRedacted > 0 ? ` 🛡️${entry.shieldRedacted}` : "";

	return `│ ${ANSI_GRAY}${timeStr}${ANSI_RESET} │ ${methodPath.padEnd(20)} │ ${modelChain} │ ${statusBadge} │ ${cacheBadge} │ ${entry.latencyMs}ms${shieldStr}`;
}
