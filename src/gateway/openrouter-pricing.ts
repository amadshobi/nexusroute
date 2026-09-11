/**
 * ─────────────────────────────────────────────────────────────
 * Goblin Nexus — Dynamic OpenRouter Pricing Engine
 * ─────────────────────────────────────────────────────────────
 *
 * Zero-hardcode pricing catalog resolver. Fetches the live OpenRouter
 * model catalog and caches it locally (TTL: 12h) to enrich /v1/models
 * and accurately calculate market-rate cloud cost.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface OpenRouterPricing {
	prompt?: string;
	completion?: string;
	input_cache_read?: string;
	input_cache_write?: string;
}

export interface OpenRouterModelItem {
	id: string;
	name?: string;
	created?: number;
	context_length?: number;
	pricing?: OpenRouterPricing;
}

export interface ModelPricingRates {
	inputUsdPer1M: number;
	outputUsdPer1M: number;
	cacheReadUsdPer1M: number;
	rawPricing?: OpenRouterPricing;
	matchedModelId?: string;
}

// Kanonik baru: ~/.cache/nexus/openrouter-pricing.json
const NEXUS_PRICING_CACHE_FILE = join(
	homedir(),
	".cache",
	"nexus",
	"openrouter-pricing.json",
);
// Legacy: ~/.cache/gn/openrouter-pricing.json (nama baru) dan nama lama
// ~/.cache/gn/openrouter-pricing-cache.json — dua-duanya tetap dibaca.
const LEGACY_PRICING_CACHE_FILE = join(
	homedir(),
	".cache",
	"gn",
	"openrouter-pricing.json",
);
const LEGACY_PRICING_CACHE_FILE_OLD = join(
	homedir(),
	".cache",
	"gn",
	"openrouter-pricing-cache.json",
);

/** File tulis kanonik (selalu di path NexusRoute baru). */
const PRICING_WRITE_FILE = NEXUS_PRICING_CACHE_FILE;
const CACHE_DIR = dirname(PRICING_WRITE_FILE);
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 jam

/**
 * Resolve file cache pricing sumber: pakai `~/.cache/nexus/openrouter-pricing.json`
 * bila ada, fallback ke legacy `~/.cache/gn/openrouter-pricing.json`, lalu ke
 * nama legacy lama `openrouter-pricing-cache.json`; default kanonik baru.
 */
function resolvePricingCacheFile(): string {
	if (existsSync(NEXUS_PRICING_CACHE_FILE)) return NEXUS_PRICING_CACHE_FILE;
	if (existsSync(LEGACY_PRICING_CACHE_FILE)) return LEGACY_PRICING_CACHE_FILE;
	if (existsSync(LEGACY_PRICING_CACHE_FILE_OLD))
		return LEGACY_PRICING_CACHE_FILE_OLD;
	return NEXUS_PRICING_CACHE_FILE;
}

export class OpenRouterPricingEngine {
	private cachedCatalog: Map<string, OpenRouterModelItem> = new Map();
	private lastFetchTs = 0;
	private fetchPromise: Promise<boolean> | null = null;

	constructor() {
		this.loadFromDisk();
		// Background auto-refresh if stale
		if (this.isStale()) {
			void this.refreshCatalog();
		}
	}

	private ensureDir(): void {
		if (!existsSync(CACHE_DIR)) {
			mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
		}
	}

	private isStale(): boolean {
		if (this.lastFetchTs === 0) return true;
		return Date.now() - this.lastFetchTs > CACHE_TTL_MS;
	}

	private loadFromDisk(): void {
		try {
			const sourceFile = resolvePricingCacheFile();
			if (!existsSync(sourceFile)) return;
			const stats = statSync(sourceFile);
			this.lastFetchTs = stats.mtimeMs;

			const raw = readFileSync(sourceFile, "utf-8");
			const items = JSON.parse(raw) as OpenRouterModelItem[];
			if (Array.isArray(items)) {
				this.cachedCatalog.clear();
				for (const it of items) {
					if (it?.id) {
						this.cachedCatalog.set(it.id.toLowerCase(), it);
					}
				}
			}
		} catch {
			// Best-effort resilience
		}
	}

	private saveToDisk(items: OpenRouterModelItem[]): void {
		try {
			this.ensureDir();
			writeFileSync(
				PRICING_WRITE_FILE,
				JSON.stringify(items, null, 2),
				"utf-8",
			);
			this.lastFetchTs = Date.now();
		} catch {
			// Best effort
		}
	}

	/**
	 * Fetch latest model catalog directly from OpenRouter public API.
	 */
	public async refreshCatalog(): Promise<boolean> {
		if (this.fetchPromise) {
			return this.fetchPromise;
		}

		this.fetchPromise = (async () => {
			try {
				const res = await fetch("https://openrouter.ai/api/v1/models", {
					headers: {
						"User-Agent": "NexusRoute/1.0.0 (PricingEngine)",
						Accept: "application/json",
					},
					signal: AbortSignal.timeout(10000),
				});

				if (!res.ok) {
					return false;
				}

				const json = (await res.json()) as { data?: OpenRouterModelItem[] };
				const data = json?.data;
				if (Array.isArray(data) && data.length > 0) {
					this.cachedCatalog.clear();
					for (const item of data) {
						if (item?.id) {
							this.cachedCatalog.set(item.id.toLowerCase(), item);
						}
					}
					this.saveToDisk(data);
					return true;
				}
				return false;
			} catch {
				return false;
			} finally {
				this.fetchPromise = null;
			}
		})();

		return this.fetchPromise;
	}

	/**
	 * Resolve pricing for any arbitrary model ID using smart fuzzy matching.
	 * Zero hardcoded prices.
	 */
	public resolveModelPricing(rawModelId: string): ModelPricingRates | null {
		if (!rawModelId) return null;
		const target = rawModelId.toLowerCase().trim();

		// 1. Exact match (e.g. "anthropic/claude-3.5-sonnet")
		if (this.cachedCatalog.has(target)) {
			return this.formatRate(this.cachedCatalog.get(target)!);
		}

		// 2. Match without custom gateway prefixes (e.g. "google-antigravity/", "cmc/", "oc/")
		const stripped = target
			.replace(
				/^(google-antigravity|google|cmc|oc|bpm|local-gateway|vans-gateway)\//,
				"",
			)
			.replace(/:free$/, "")
			.replace(/:[a-z0-9-]+$/, "");

		if (this.cachedCatalog.has(stripped)) {
			return this.formatRate(this.cachedCatalog.get(stripped)!);
		}

		// 3. Match by suffix / family in OpenRouter catalog
		let bestMatch: OpenRouterModelItem | null = null;
		for (const [orId, item] of this.cachedCatalog.entries()) {
			const orBare = orId.includes("/") ? orId.split("/")[1] : orId;
			if (orBare === stripped || orId.endsWith(`/${stripped}`)) {
				bestMatch = item;
				break;
			}
		}

		// 4. Fuzzy family matching (e.g. claude-opus-4-6 -> claude-opus, deepseek-v4 -> deepseek)
		if (!bestMatch) {
			const parts = stripped.split("-");
			const family = parts.slice(0, 2).join("-"); // e.g. "claude-opus", "claude-sonnet", "gemini-3.8"
			for (const [orId, item] of this.cachedCatalog.entries()) {
				if (orId.includes(family)) {
					bestMatch = item;
					break;
				}
			}
		}

		if (bestMatch) {
			return this.formatRate(bestMatch);
		}

		return null;
	}

	private formatRate(item: OpenRouterModelItem): ModelPricingRates {
		const p = item.pricing || {};
		const inputRate = p.prompt ? parseFloat(p.prompt) * 1_000_000 : 0;
		const outputRate = p.completion ? parseFloat(p.completion) * 1_000_000 : 0;
		const cacheRate = p.input_cache_read
			? parseFloat(p.input_cache_read) * 1_000_000
			: 0;

		return {
			inputUsdPer1M: Number.isFinite(inputRate) ? inputRate : 0,
			outputUsdPer1M: Number.isFinite(outputRate) ? outputRate : 0,
			cacheReadUsdPer1M: Number.isFinite(cacheRate) ? cacheRate : 0,
			rawPricing: p,
			matchedModelId: item.id,
		};
	}

	public getCatalogSize(): number {
		return this.cachedCatalog.size;
	}
}

export const defaultPricingEngine = new OpenRouterPricingEngine();
