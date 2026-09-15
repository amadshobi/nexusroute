export function formatCompact(num: number): string {
	if (!num || num <= 0) return "0";
	if (num < 1_000) return num.toString();
	if (num < 1_000_000) return `${(num / 1_000).toFixed(1)}k`;
	if (num < 1_000_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
	if (num < 1_000_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
	return `${(num / 1_000_000_000_000).toFixed(2)}T`;
}

export function formatUptime(seconds: number): string {
	if (!seconds || seconds <= 0) return "0h 0m";
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	return `${h}h ${m}m`;
}

export function formatCost(amount: number): string {
	if (typeof amount !== "number" || isNaN(amount) || amount <= 0)
		return "$0.00";
	if (amount < 0.01) return `$${amount.toFixed(4)}`;
	return `$${amount.toFixed(2)}`;
}

export function formatCostDual(usdAmount: number, rate = 16_000): string {
	if (typeof usdAmount !== "number" || isNaN(usdAmount) || usdAmount <= 0) {
		return "$0.00 (Rp 0)";
	}
	const usdStr =
		usdAmount < 0.01 ? `$${usdAmount.toFixed(4)}` : `$${usdAmount.toFixed(2)}`;
	const idrVal = Math.round(usdAmount * rate);
	const idrStr = `Rp ${idrVal.toLocaleString("id-ID")}`;
	return `${usdStr} (${idrStr})`;
}

export function formatDateWIB(timestamp: number): string {
	if (!timestamp || timestamp <= 0) return "-";
	const date = new Date(timestamp);
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Jakarta",
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).formatToParts(date);
	const find = (type: string) =>
		parts.find((p) => p.type === type)?.value || "";
	const d = `${find("day")}-${find("month")}-${find("year")}`;
	const time = `${find("hour")}.${find("minute")}`;
	return `${d} - ${time} WIB`;
}

export function formatTimeHHmm(timestamp: number): string {
	if (!timestamp || timestamp <= 0) return "-";
	const date = new Date(timestamp);
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Jakarta",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		hour12: false,
	}).formatToParts(date);
	const h =
		parts.find((p) => p.type === "hour")?.value.padStart(2, "0") || "00";
	const m =
		parts.find((p) => p.type === "minute")?.value.padStart(2, "0") || "00";
	return `${h}:${m}`;
}

/**
 * Format a bucket timestamp into a compact axis label in WIB (UTC+7).
 *
 * The granularity adapts to the total window span:
 * - `<= 48 hours` (or omitted): `HH:mm`, e.g. `14:00`.
 * - `<= 7 days`: `ddd HH:mm`, e.g. `Mon 14:00`.
 * - `> 7 days`: `dd/MM`, e.g. `13/09`.
 *
 * Returns `-` for non-positive or invalid timestamps.
 */
export function formatBucketTime(
	timestamp: number,
	windowSpanMs?: number,
): string {
	if (!timestamp || timestamp <= 0 || isNaN(timestamp)) return "-";
	const date = new Date(timestamp);

	const timeParts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Jakarta",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		hour12: false,
	}).formatToParts(date);
	const hour =
		timeParts.find((p) => p.type === "hour")?.value.padStart(2, "0") || "00";
	const minute =
		timeParts.find((p) => p.type === "minute")?.value.padStart(2, "0") || "00";
	const hhmm = `${hour}:${minute}`;

	const span = windowSpanMs ?? 48 * 60 * 60 * 1000;
	if (span <= 48 * 60 * 60 * 1000) return hhmm;

	if (span <= 7 * 24 * 60 * 60 * 1000) {
		const weekday =
			new Intl.DateTimeFormat("en-US", {
				timeZone: "Asia/Jakarta",
				weekday: "short",
			})
				.formatToParts(date)
				.find((p) => p.type === "weekday")?.value || "";
		return `${weekday} ${hhmm}`;
	}

	const dateParts = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Asia/Jakarta",
		day: "2-digit",
		month: "2-digit",
	}).formatToParts(date);
	const day =
		dateParts.find((p) => p.type === "day")?.value.padStart(2, "0") || "00";
	const month =
		dateParts.find((p) => p.type === "month")?.value.padStart(2, "0") || "00";
	return `${day}/${month}`;
}

export function formatShortPath(fullPath?: string): string {
	if (!fullPath || fullPath === "/") return "~";
	return fullPath.replace(/^\/home\/[^/]+/, "~");
}

/**
 * Format a USD amount into a compact IDR string using the given exchange rate.
 * Uses Indonesian financial abbreviations:
 * - >= 1 Triliun: T
 * - >= 1 Miliar: M
 * - >= 1 Juta: jt
 * - >= 1 Ribu: K
 */
export function formatIdr(usd: number, rate: number = 17000): string {
	const idr = usd * rate;
	if (idr >= 1_000_000_000_000) {
		return `Rp${(idr / 1_000_000_000_000).toFixed(2)}T`;
	}
	if (idr >= 1_000_000_000) {
		return `Rp${(idr / 1_000_000_000).toFixed(2)}M`;
	}
	if (idr >= 1_000_000) {
		return `Rp${(idr / 1_000_000).toFixed(2)}jt`;
	}
	if (idr >= 1_000) {
		return `Rp${(idr / 1_000).toFixed(1)}K`;
	}
	return `Rp${Math.round(idr).toLocaleString("en-US")}`;
}

/**
 * Dynamically converts raw model IDs (e.g. "google-antigravity/gemini-3.8-flash",
 * "openrouter/anthropic/claude-3.7-sonnet", "deepseek-v4-flash") into human-readable
 * display names ("Gemini 3.8 Flash", "Claude 3.7 Sonnet", "DeepSeek V4 Flash")
 * using pattern heuristics without requiring hardcoded model registries.
 */
export function formatModelDisplayName(modelId?: string): string {
	if (!modelId) return "Unknown";

	let clean = modelId.trim();

	// 0. Extract clean ID if stored as serialized JSON, e.g. {"id":"...","providerID":"..."}
	if (clean.startsWith("{")) {
		try {
			const parsed = JSON.parse(clean);
			if (parsed.id) clean = String(parsed.id);
			else if (parsed.model) clean = String(parsed.model);
		} catch {
			const match = clean.match(/"id"\s*:\s*"([^"]+)"/);
			if (match && match[1]) clean = match[1];
		}
	}

	// 1. Take the last meaningful path segment if provider prefixes are present
	if (clean.includes("/")) {
		const segments = clean.split("/").filter(Boolean);
		clean = segments[segments.length - 1];
	}

	// 2. Strip deployment/date tags, e.g. -20250219, :free, :exact, @...
	clean = clean
		.replace(/:\w+$/i, "")
		.replace(/-\d{8}$/, "")
		.replace(/@.*$/, "");

	// 3. Tokenize by hyphen, underscore, or space
	const tokens = clean.split(/[-_\s]+/).filter(Boolean);

	// 4. Transform tokens using industry-standard acronym & title-case heuristics
	const formatted = tokens.map((token) => {
		const lower = token.toLowerCase();

		// Well-known uppercase acronyms
		if (lower === "gpt") return "GPT";
		if (lower === "glm") return "GLM";
		if (lower === "dbrx") return "DBRX";
		if (lower === "deepseek") return "DeepSeek";
		if (lower === "minimax") return "MiniMax";
		if (lower === "moonshot") return "Moonshot";
		if (lower === "phi") return "Phi";

		// Version tokens: v3, v4, v3.5 -> V3, V4, V3.5
		if (/^v\d+(\.\d+)?$/i.test(token)) {
			return token.toUpperCase();
		}

		// Size tokens: 70b, 8b, 32b, 1.5b -> 70B, 8B, 32B, 1.5B
		if (/^\d+(\.\d+)?b$/i.test(token)) {
			return token.toUpperCase();
		}

		// Model reasoning / numeric identifiers: 3.8, 4o, o1, o3
		if (/^\d+(\.\d+)?$/i.test(token)) {
			return token;
		}
		if (/^o[1-9]$/i.test(token)) {
			return token.toLowerCase();
		}
		if (/^\d+o(-mini)?$/i.test(token)) {
			return token;
		}

		// Standard title capitalization: gemini -> Gemini, flash -> Flash, sonnet -> Sonnet
		return token.charAt(0).toUpperCase() + token.slice(1);
	});

	return formatted.join(" ") || modelId;
}

export function extractModelId(rawModel?: string): string {
	if (!rawModel) return "unknown";
	try {
		if (rawModel.startsWith("{")) {
			const parsed = JSON.parse(rawModel);
			if (parsed.id) {
				const id = String(parsed.id);
				const parts = id.split("/");
				return parts[parts.length - 1];
			}
		}
	} catch {
		// Fallback
	}
	const parts = rawModel.split("/");
	return parts[parts.length - 1];
}

/**
 * Mengelompokkan item ke bucket waktu dinamis untuk sparkline tanpa data palsu.
 * Jika item kosong, menghasilkan array 0 sesuai jumlah bucket.
 */
export function computeTimeSeriesBuckets<T>(
	items: T[],
	getTimestamp: (item: T) => number,
	getValue: (item: T) => number,
	bucketCount = 8,
	windowStartTime?: number,
	windowEndTime?: number,
): number[] {
	if (!items || items.length === 0) {
		return new Array(bucketCount).fill(0);
	}

	const validItems = items.filter((it) => {
		const ts = getTimestamp(it);
		return typeof ts === "number" && !isNaN(ts) && ts > 0;
	});

	if (validItems.length === 0) {
		return new Array(bucketCount).fill(0);
	}

	const itemTimestamps = validItems.map(getTimestamp);
	const start =
		typeof windowStartTime === "number" && windowStartTime > 0
			? windowStartTime
			: Math.min(...itemTimestamps);
	const end =
		typeof windowEndTime === "number" && windowEndTime > start
			? windowEndTime
			: Math.max(...itemTimestamps);

	const span = end - start;
	if (span <= 0) {
		const totalVal = validItems.reduce((acc, it) => acc + getValue(it), 0);
		const res = new Array(bucketCount).fill(0);
		res[bucketCount - 1] = totalVal;
		return res;
	}

	const step = span / bucketCount;
	const buckets = new Array(bucketCount).fill(0);

	for (const item of validItems) {
		const ts = getTimestamp(item);
		if (ts < start || ts > end) continue;
		const idx = Math.min(
			bucketCount - 1,
			Math.max(0, Math.floor((ts - start) / step)),
		);
		buckets[idx] += getValue(item);
	}

	return buckets;
}
