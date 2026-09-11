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

export function formatShortPath(fullPath?: string): string {
	if (!fullPath || fullPath === "/") return "~";
	return fullPath.replace(/^\/home\/[^/]+/, "~");
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
