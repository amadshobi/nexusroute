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

const CACHE_DIR = join(homedir(), ".cache", "gn");
const PRICING_CACHE_FILE = join(CACHE_DIR, "openrouter-pricing-cache.json");
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 jam

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
			if (!existsSync(PRICING_CACHE_FILE)) return;
			const stats = statSync(PRICING_CACHE_FILE);
			this.lastFetchTs = stats.mtimeMs;

			const raw = readFileSync(PRICING_CACHE_FILE, "utf-8");
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
				PRICING_CACHE_FILE,
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
						"User-Agent": "GoblinNexus/2.2.0 (PricingEngine)",
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
