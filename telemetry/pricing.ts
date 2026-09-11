#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// Goblin Nexus — Custom Pricing Engine
// Loads/saves price config at ~/.config/goblin-nexus/prices.json
// Rates are USD per 1M tokens. NO FAKE MATH: cost is derived
// directly from prompt + completion + cache token counts.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ─── Paths ────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".config", "goblin-nexus");
export const PRICES_PATH = join(CONFIG_DIR, "prices.json");

// ─── Types ────────────────────────────────────────────────────

export interface ModelRate {
  /** USD per 1M input/prompt tokens */
  input: number;
  /** USD per 1M output/completion tokens */
  output: number;
  /** USD per 1M cache tokens (optional) */
  cache?: number;
}

export interface PricesConfig {
  /** Schema version for forward compat */
  version: number;
  /** Updated ISO date */
  updatedAt: string;
  /** Map of providerId -> modelId -> rate */
  rates: Record<string, Record<string, ModelRate>>;
}

// ─── Defaults ─────────────────────────────────────────────────
// USD per 1M tokens. Sources: publicly listed provider rates as of
// implementation date. These are baseline values; override via
// `gn price set <provider> <model> --input ... --output ...`.
// Values are intentionally conservative defaults — user can adjust.
const DEFAULT_RATES: Record<string, Record<string, ModelRate>> = {
  "google-antigravity": {
    "gemini-3.1-pro":     { input: 2.00,  output: 12.0,  cache: 0.625 },
    "gemini-3.5-flash":   { input: 1.50,  output: 9.0,  cache: 0.025 },
    "gemini-3.6-flash":   { input: 1.50,  output: 7.50,  cache: 0.025 },
    "claude-sonnet-4-6":   { input: 3.00, output: 15.0, cache: 0.30 },
    "claude-opus-4-6":     { input: 5.00, output: 25.0, cache: 0.30 },
  },
  "openai-codex": {
    "gpt-5.4":          { input: 2.50, output: 15.0,  cache: 0.125 },
    "gpt-5.5":          { input: 5.00, output: 30.0,  cache: 0.125 },
  },
  "ollama-cloud": {
    "minimax-m3": { input: 0.24, output: 0.96, cache: 0.0 },
  }
};

function defaultConfig(): PricesConfig {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    rates: structuredClone(DEFAULT_RATES),
  };
}

// ─── Load / Save ──────────────────────────────────────────────

/**
 * Load prices.json. If the file is missing or malformed, write the
 * default config and return the default. Never throws.
 */
export function loadPrices(): PricesConfig {
  try {
    if (!existsSync(PRICES_PATH)) {
      const def = defaultConfig();
      savePrices(def);
      return def;
    }
    const raw = readFileSync(PRICES_PATH, "utf8");
    const parsed = JSON.parse(raw) as PricesConfig;
    // Minimal shape validation — fall back to defaults if broken
    if (!parsed || typeof parsed !== "object" || !parsed.rates) {
      const def = defaultConfig();
      savePrices(def);
      return def;
    }
    return parsed;
  } catch (err) {
    process.stderr.write(`⚠️  prices.json load failed: ${(err as Error).message}. Using defaults.\n`);
    return defaultConfig();
  }
}

/** Persist prices.json. Creates parent dir if missing. */
export function savePrices(prices: PricesConfig): void {
  try {
    const parent = dirname(PRICES_PATH);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    const payload: PricesConfig = {
      version: prices.version ?? 1,
      updatedAt: new Date().toISOString(),
      rates: prices.rates ?? {},
    };
    writeFileSync(PRICES_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  } catch (err) {
    process.stderr.write(`⚠️  prices.json save failed: ${(err as Error).message}\n`);
  }
}

// ─── Rate Lookup ──────────────────────────────────────────────

/**
 * Resolve the rate for a (provider, model) pair. Falls back to
 * the provider's "default" entry, then to zero-rate. Never throws.
 */
export function getRate(prices: PricesConfig, provider: string, model: string): ModelRate {
  const providerRates = prices.rates?.[provider] ?? {};
  const direct = providerRates[model];
  if (direct) return direct;
  const fallback = providerRates["default"];
  if (fallback) return fallback;
  return { input: 0, output: 0, cache: 0 };
}

// ─── Cost Calculation ─────────────────────────────────────────

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheCost: number;
  total: number;
  /** Echo of inputs for transparency */
  promptTokens: number;
  completionTokens: number;
  cacheTokens: number;
  /** Source of the rate (model name, "default", or "zero") */
  rateSource: string;
  /** Resolved rate values */
  rate: ModelRate;
}

/**
 * Calculate cost in USD using transparent per-1M-token math:
 *
 *   inputCost  = (promptTokens     / 1_000_000) * inputRate
 *   outputCost = (completionTokens / 1_000_000) * outputRate
 *   cacheCost  = (cacheTokens      / 1_000_000) * cacheRate
 *   total      = inputCost + outputCost + cacheCost
 *
 * Negative or non-finite inputs are clamped to 0. NO FAKE MATH.
 */
export function calculateCost(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  cacheTokens: number = 0,
  prices?: PricesConfig,
): CostBreakdown {
  const config = prices ?? loadPrices();
  const rate = getRate(config, provider, model);
  const safePrompt = Math.max(0, Number(promptTokens) || 0);
  const safeComp = Math.max(0, Number(completionTokens) || 0);
  const safeCache = Math.max(0, Number(cacheTokens) || 0);

  const inputCost = (safePrompt / 1_000_000) * rate.input;
  const outputCost = (safeComp / 1_000_000) * rate.output;
  const cacheCost = (safeCache / 1_000_000) * (rate.cache ?? 0);
  const total = inputCost + outputCost + cacheCost;

  // Source attribution for transparency
  let rateSource: string;
  if (config.rates?.[provider]?.[model]) {
    rateSource = model;
  } else if (config.rates?.[provider]?.["default"]) {
    rateSource = `${provider}/default`;
  } else {
    rateSource = "zero";
  }

  return {
    inputCost,
    outputCost,
    cacheCost,
    total,
    promptTokens: safePrompt,
    completionTokens: safeComp,
    cacheTokens: safeCache,
    rateSource,
    rate,
  };
}

// ─── Mutation Helpers ─────────────────────────────────────────

/**
 * Set or update a rate. Returns a NEW PricesConfig (immutability).
 * Caller can pass the result to savePrices().
 */
export function setPrice(
  prices: PricesConfig,
  provider: string,
  model: string,
  rates: ModelRate,
): PricesConfig {
  const nextProvider: Record<string, ModelRate> = {
    ...(prices.rates?.[provider] ?? {}),
    [model]: { ...rates },
  };
  const nextRates: Record<string, Record<string, ModelRate>> = {
    ...(prices.rates ?? {}),
    [provider]: nextProvider,
  };
  return {
    version: prices.version ?? 1,
    updatedAt: new Date().toISOString(),
    rates: nextRates,
  };
}
