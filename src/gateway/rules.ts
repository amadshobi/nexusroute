/**
 * ─────────────────────────────────────────────────────────────
 * Goblin Nexus — Gateway Unified Configuration Loader
 * ─────────────────────────────────────────────────────────────
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
	FallbackConfig,
	GatewayHeadersConfig,
	GatewayRules,
	MaskRule,
	ModelFilterConfig,
} from "./types";

export const HARDCODED_PRIVACY_HEADERS: Readonly<Record<string, string>> =
	Object.freeze({
		"X-No-Log": "true",
		"X-Data-Protection": "opt-out",
		"X-Zero-Data-Retention": "1",
		"Cache-Control": "no-store, no-cache",
		Pragma: "no-cache",
	});

export const HARDCODED_MASK_PATTERNS: readonly MaskRule[] = Object.freeze([
	{
		name: "OpenAI / Generic API Keys",
		regex: "(sk-[a-zA-Z0-9T3BlbkFJ]{20,})",
	},
	{
		name: "GitHub Personal Access Tokens",
		regex: "(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59})",
	},
	{
		name: "Google / Antigravity API Keys",
		regex: "(AIzaSy[a-zA-Z0-9_-]{33})",
	},
	{
		name: "Anthropic API Keys",
		regex: "(sk-ant-api03-[a-zA-Z0-9_-]{80,})",
	},
	{ name: "AWS Access Key IDs", regex: "(AKIA[0-9A-Z]{16})" },
	{
		name: "Private Keys / RSA Keys",
		regex:
			"(-----BEGIN [A-Z]+ PRIVATE KEY-----([\\s\\S]*?)-----END [A-Z]+ PRIVATE KEY-----)",
	},
	{
		name: "Bearer Tokens",
		regex: "(Bearer\\s+[a-zA-Z0-9\\-\\._~\\+\\/]+=*)",
	},
	{
		name: "Internal / Local IP Addresses",
		regex:
			"\\b(?:10|172\\.(?:1[6-9]|2[0-9]|3[01])|192\\.168)\\.\\d{1,3}\\.\\d{1,3}\\b",
	},
]);

export const DEFAULT_FALLBACK: FallbackConfig = Object.freeze({
	enabled: true,
	trigger_statuses: Object.freeze([404, 410, 429]) as unknown as number[],
	trigger_status_5xx: true,
	fallback_models: Object.freeze({
		"google-antigravity/claude-sonnet-4-6": [
			"google-antigravity/gemini-3.1-pro",
		],
		"google-antigravity/claude-opus-4-6": ["google-antigravity/gemini-3.1-pro"],
		"google-antigravity/gemini-3.8-flash": [
			"google-antigravity/gemini-3.7-flash",
			"google-antigravity/gemini-3.1-pro",
		],
		"google-antigravity/gemini-3.7-flash": [
			"google-antigravity/gemini-3.8-flash",
			"google-antigravity/gemini-3.1-pro",
		],
		"google-antigravity/gemini-3.5-flash": [
			"opencode/deepseek-v4-flash-free",
			"ollama-cloud/minimax-m3",
		],
		"openai-codex/gpt-5.5": [
			"google-antigravity/gemini-3.7-flash",
			"google-antigravity/gemini-2.5-flash",
		],
		"ollama-cloud/minimax-m3": ["opencode/deepseek-v4-flash-free"],
	}) as unknown as Record<string, string[]>,
	default_fallback: Object.freeze([
		"opencode/deepseek-v4-flash-free",
		"google-antigravity/gemini-3.5-flash",
		"ollama-cloud/minimax-m3",
	]) as unknown as string[],
	endpoints: Object.freeze([
		"/v1/chat/completions",
		"/v1/messages",
	]) as unknown as string[],
});

export const DEFAULT_MODEL_FILTER: ModelFilterConfig = Object.freeze({
	whitelist: Object.freeze({}) as Record<string, string[]>,
	blacklist: Object.freeze([]) as unknown as string[],
});

export const DEFAULT_RULES: GatewayRules = Object.freeze({
	enabled: true,
	redact_replacement: "[REDACTED_BY_GOBLIN_SHIELD]",
	patterns: HARDCODED_MASK_PATTERNS as unknown as MaskRule[],
	fallback: DEFAULT_FALLBACK,
	modelFilter: DEFAULT_MODEL_FILTER,
});

export const DEFAULT_HEADERS: GatewayHeadersConfig = Object.freeze({
	description:
		"Goblin Privacy Shield - Forced Outbound Zero-Data Retention & Opt-Out Headers",
	headers: HARDCODED_PRIVACY_HEADERS as unknown as Record<string, string>,
});

/**
 * Resolve the writable user config path.
 *
 * Prioritas: `NEXUS_CONFIG_PATH` lalu `GN_CONFIG_PATH` (legacy) sebagai
 * override. Bila tak ada override, default kanonik baru adalah
 * `~/.config/nexus/config.json`. Resolution intentionally lazy (per call,
 * not a module-level const) so tests can sandbox persistence without
 * depending on import order or mutating the real user config.
 */
function getUserConfigPath(): string {
	const override = process.env.NEXUS_CONFIG_PATH ?? process.env.GN_CONFIG_PATH;
	if (override && override.trim()) return override;
	return join(homedir(), ".config", "nexus", "config.json");
}

/** Config kanonik baru NexusRoute. */
function getNewUserConfigPath(): string {
	return join(homedir(), ".config", "nexus", "config.json");
}

/** Config legacy Goblin Nexus. */
function getLegacyUserConfigPath(): string {
	return join(homedir(), ".config", "gn", "config.json");
}

/**
 * Resolve path to unified config.json across standard locations.
 *
 * Urutan: override env → `~/.config/nexus/config.json` (kanonik) →
 * `~/.config/gn/config.json` (legacy) → template vault.
 */
export function getUnifiedConfigPath(): string | null {
	const override = process.env.NEXUS_CONFIG_PATH ?? process.env.GN_CONFIG_PATH;
	if (override && override.trim()) {
		if (existsSync(override)) return override;
	} else {
		// 1. Canonical new user config
		const newConfig = getNewUserConfigPath();
		if (existsSync(newConfig)) return newConfig;

		// 2. Legacy gn user config
		const legacyConfig = getLegacyUserConfigPath();
		if (existsSync(legacyConfig)) return legacyConfig;
	}

	// 3. Vault master config template
	const vaultRoot =
		process.env.GOBLIN_VAULT_ROOT || join(homedir(), "civil", "goblin-vault");
	const vaultConfig = join(vaultRoot, "configs", "gn", "config.json");
	if (existsSync(vaultConfig)) return vaultConfig;

	return null;
}

/**
 * Load Gateway Rules safely from unified config.json.
 */
export function loadGatewayRules(): GatewayRules {
	const path = getUnifiedConfigPath();
	if (!path) {
		return DEFAULT_RULES;
	}

	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw);

		// Extract gateway scope if wrapped in unified config.json
		const gw = parsed.gateway || parsed;
		const privacy = gw.privacy || parsed.privacy || {};
		const fallbackRaw = gw.fallback || parsed.fallback;

		const merged: GatewayRules = {
			enabled: gw.enabled ?? privacy.enabled ?? DEFAULT_RULES.enabled,
			redact_replacement:
				privacy.redact_replacement ??
				gw.redact_replacement ??
				DEFAULT_RULES.redact_replacement,
			patterns:
				privacy.patterns ??
				gw.patterns ??
				(HARDCODED_MASK_PATTERNS as MaskRule[]),
			fallback: fallbackRaw
				? {
						enabled: fallbackRaw.enabled ?? DEFAULT_FALLBACK.enabled,
						trigger_statuses:
							fallbackRaw.trigger_statuses ?? DEFAULT_FALLBACK.trigger_statuses,
						trigger_status_5xx:
							fallbackRaw.trigger_status_5xx ??
							DEFAULT_FALLBACK.trigger_status_5xx,
						fallback_models: {
							...DEFAULT_FALLBACK.fallback_models,
							...(fallbackRaw.fallback_models || {}),
						},
						default_fallback:
							fallbackRaw.default_fallback ?? DEFAULT_FALLBACK.default_fallback,
						endpoints: fallbackRaw.endpoints ?? DEFAULT_FALLBACK.endpoints,
					}
				: DEFAULT_FALLBACK,
			modelFilter: gw.modelFilter
				? {
						whitelist: {
							...DEFAULT_MODEL_FILTER.whitelist,
							...(gw.modelFilter.whitelist || {}),
						},
						blacklist:
							gw.modelFilter.blacklist ?? DEFAULT_MODEL_FILTER.blacklist,
					}
				: DEFAULT_MODEL_FILTER,
		};

		return merged;
	} catch (err) {
		process.stderr.write(
			`[WARN] [GN Gateway] Failed to parse config from ${path}: ${(err as Error).message}. Using defaults.\n`,
		);
		return DEFAULT_RULES;
	}
}

/**
 * Load Privacy Headers (hardcoded zero-retention headers).
 */
export function loadPrivacyHeaders(): Record<string, string> {
	return { ...HARDCODED_PRIVACY_HEADERS };
}

/**
 * Persist gateway rules into the unified user config (~/.config/nexus/config.json).
 * Preserves non-gateway fields and writes atomically via temp file + rename.
 *
 * Saat target kanonik belum ada (migrasi awal dari legacy `~/.config/gn/config.json`),
 * isi awal dibaca dari `getUnifiedConfigPath()` agar field non-gateway pada config
 * lama tidak hilang (mencegah config split-brain).
 */
export function saveGatewayConfig(rules: GatewayRules): void {
	const userConfigPath = getUserConfigPath();
	const userConfigDir = dirname(userConfigPath);
	if (!existsSync(userConfigDir)) {
		mkdirSync(userConfigDir, { recursive: true });
	}

	// Baca dari target kanonik jika ada; jika belum ada, seed dari config
	// terunifikasi (legacy gn / vault) supaya field non-gateway ikut tersalin.
	const readSource = existsSync(userConfigPath)
		? userConfigPath
		: getUnifiedConfigPath();

	let existing: Record<string, unknown> = {};
	if (readSource) {
		try {
			existing = JSON.parse(readFileSync(readSource, "utf-8"));
		} catch {
			// Corrupted config, start fresh
		}
	}

	const updated = {
		...existing,
		gateway: {
			...(existing as any).gateway,
			enabled: rules.enabled,
			redact_replacement: rules.redact_replacement,
			fallback: rules.fallback,
			modelFilter: rules.modelFilter,
		},
	};

	const tmpPath = `${userConfigPath}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(updated, null, 2), "utf-8");
	renameSync(tmpPath, userConfigPath);
}
