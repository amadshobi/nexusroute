/**
 * ─────────────────────────────────────────────────────────────
 * Goblin Nexus — Gateway Circuit Breaker & Smart Fallback Router
 * ─────────────────────────────────────────────────────────────
 */

import { DEFAULT_FALLBACK } from "./rules";
import type { FallbackConfig } from "./types";

interface ModelState {
	consecutiveFailures: number;
	cooldownUntil: number;
}

const modelStates = new Map<string, ModelState>();
const MAX_FAILURES_BEFORE_COOLDOWN = 3;
const COOLDOWN_DURATION_MS = 60_000; // 60 seconds

/**
 * Check if status code triggers fallback mechanism.
 */
export function shouldTriggerFallback(
	status: number,
	cfg: FallbackConfig = DEFAULT_FALLBACK,
): boolean {
	if (!cfg.enabled) return false;
	if (cfg.trigger_statuses.includes(status)) return true;
	if (cfg.trigger_status_5xx && status >= 500 && status < 600) return true;
	return false;
}

/**
 * Check if a model is currently in cooldown due to circuit breaker trip.
 */
export function isModelHealthy(model: string): boolean {
	const state = modelStates.get(model);
	if (!state) return true;
	if (state.cooldownUntil > 0) {
		if (Date.now() < state.cooldownUntil) {
			return false;
		}
		// Cooldown expired: auto-prune state to prevent memory leak
		modelStates.delete(model);
		return true;
	}
	return true;
}

/**
 * Record a successful request for a model, resetting failure counters.
 */
export function recordModelSuccess(model: string): void {
	modelStates.delete(model);
}

/**
 * Record a failure for a model. If threshold exceeded, trip circuit breaker cooldown.
 */
export function recordModelFailure(model: string): void {
	const now = Date.now();
	const current = modelStates.get(model) || {
		consecutiveFailures: 0,
		cooldownUntil: 0,
	};
	const newFailures = current.consecutiveFailures + 1;
	const cooldownUntil =
		newFailures >= MAX_FAILURES_BEFORE_COOLDOWN
			? now + COOLDOWN_DURATION_MS
			: 0;

	modelStates.set(model, {
		consecutiveFailures: newFailures,
		cooldownUntil,
	});
}

/**
 * Resolve candidate fallback models for a primary model ID.
 * Filters out models currently in circuit breaker cooldown.
 */
export function resolveFallbackCandidates(
	primaryModel: string,
	cfg: FallbackConfig = DEFAULT_FALLBACK,
): string[] {
	let result: string[] = [];
	const mapped = cfg.fallback_models[primaryModel];

	if (Array.isArray(mapped)) {
		result = [...mapped];
	} else if (typeof mapped === "string" && !mapped.startsWith("//")) {
		result = [mapped];
	}

	if (result.length === 0) {
		if (Array.isArray(cfg.default_fallback)) {
			result = [...cfg.default_fallback];
		} else if (
			typeof cfg.default_fallback === "string" &&
			cfg.default_fallback
		) {
			result = [cfg.default_fallback];
		}
	}

	const validCandidates = result.filter(
		(m) =>
			m && typeof m === "string" && !m.startsWith("//") && m !== primaryModel,
	);

	// Filter with circuit breaker health check
	return validCandidates.filter((m) => isModelHealthy(m));
}

/**
 * Extract model and parsed JSON from request body.
 */
export function extractModelFromBody(
	bodyStr: string,
): { parsed: any; model: string | null } | null {
	if (!bodyStr) return null;
	try {
		const parsed = JSON.parse(bodyStr);
		const model = typeof parsed?.model === "string" ? parsed.model : null;
		return { parsed, model };
	} catch {
		return null;
	}
}

/**
 * Build a new body string with replaced model field (immutable).
 */
export function buildFallbackBody(
	originalParsed: any,
	newModel: string,
): string | null {
	if (!originalParsed || typeof originalParsed !== "object") return null;
	const next = { ...originalParsed, model: newModel };
	try {
		return JSON.stringify(next);
	} catch {
		return null;
	}
}
