import type { PromptCacheManager } from "./cache";
import type { FixtureManager } from "./replay";
import type { AccessLogManager } from "./access-log";
import type {
	GatewayServerConfig,
	GatewayStats,
	GatewayRules,
	ModelFilterConfig,
	UpstreamTarget,
	ResolvedRoute,
} from "./types";

export interface GatewayContext {
	config: GatewayServerConfig;
	rules: GatewayRules;
	privacyHeaders: Record<string, string>;
	upstreams: UpstreamTarget[];
	defaultName: string;
	stats: GatewayStats;
	startTime: number;
	cacheManager: PromptCacheManager;
	accessLog: AccessLogManager;
	fixtureManager: FixtureManager;
	getAuthHeadersFor: (
		upstream: UpstreamTarget,
	) => Promise<Record<string, string>>;
	getCatalog: () => Promise<Map<string, Set<string>>>;
	updateCatalogCache?: (map: Map<string, Set<string>>) => void;
	resolveRouteForRequest: (
		reqPath: string,
		search: string,
		modelId: string | null,
	) => Promise<ResolvedRoute>;
	getRequestIP: (req: Request) => string | null;
	reloadRules: () => void;
	getStats: () => GatewayStats;
}

/**
 * Check if a model is allowed by the whitelist.
 * Empty whitelist for an upstream = all models pass.
 */
export function isModelWhitelisted(
	modelId: string,
	upstreamName: string,
	modelFilter: ModelFilterConfig | undefined,
): boolean {
	if (!modelFilter) return true;
	const whitelist = modelFilter.whitelist;
	if (!whitelist) return true;
	const allowed = whitelist[upstreamName];
	if (!allowed || allowed.length === 0) return true;
	if (allowed.includes(modelId)) return true;

	// Normalize prefix for tolerant matching (e.g. cmc/deepseek vs deepseek)
	const cleanModelId = modelId.replace(/^(commandcode|cmc)\//, "");
	return allowed.some((entry) => {
		const cleanEntry = entry.replace(/^(commandcode|cmc)\//, "");
		return cleanEntry === cleanModelId;
	});
}

/**
 * Check if a model is in the global blacklist.
 */
export function isModelBlacklisted(
	modelId: string,
	modelFilter: ModelFilterConfig | undefined,
): boolean {
	if (!modelFilter) return false;
	const blacklist = modelFilter.blacklist;
	if (!blacklist || blacklist.length === 0) return false;
	if (blacklist.includes(modelId)) return true;

	const cleanModelId = modelId.replace(/^(commandcode|cmc)\//, "");
	return blacklist.some((entry) => {
		const cleanEntry = entry.replace(/^(commandcode|cmc)\//, "");
		return cleanEntry === cleanModelId;
	});
}

/**
 * Hitung batas waktu milidetik sesuai zona WIB (UTC+7).
 */
export function parseTimeBounds(range: string | null): {
	startMs: number;
	endMs: number;
} {
	const now = Date.now();
	const msPerDay = 24 * 3600 * 1000;
	const wibOffsetMs = 7 * 3600 * 1000;
	const startOfTodayWib =
		Math.floor((now + wibOffsetMs) / msPerDay) * msPerDay - wibOffsetMs;
	const startOfYesterdayWib = startOfTodayWib - msPerDay;

	switch (range) {
		case "15m":
			return { startMs: now - 15 * 60 * 1000, endMs: now };
		case "today":
			return { startMs: startOfTodayWib, endMs: now };
		case "yesterday":
			return { startMs: startOfYesterdayWib, endMs: startOfTodayWib };
		case "24h":
			return { startMs: now - 24 * 3600000, endMs: now };
		case "7d":
			return { startMs: now - 7 * 24 * 3600000, endMs: now };
		case "30d":
			return { startMs: now - 30 * 24 * 3600000, endMs: now };
		case "all":
		default:
			return { startMs: 0, endMs: Infinity };
	}
}

/**
 * Cek apakah alamat IP merupakan loopback (localhost) atau LAN private.
 */
export function isLocalhostAddress(
	address: string | null | undefined,
): boolean {
	if (!address) return false;
	const normalized = address.startsWith("::ffff:")
		? address.slice("::ffff:".length)
		: address;
	// Loopback
	if (
		normalized === "127.0.0.1" ||
		normalized === "::1" ||
		normalized === "localhost"
	) {
		return true;
	}
	// Private LAN networks (RFC 1918)
	if (
		normalized.startsWith("192.168.") ||
		normalized.startsWith("10.") ||
		/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(normalized)
	) {
		return true;
	}
	return false;
}
