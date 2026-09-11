/**
 * ─────────────────────────────────────────────────────────────
 * Goblin Nexus — Gateway Privacy & Sanitizer Engine
 * ─────────────────────────────────────────────────────────────
 */

import type { GatewayRules } from "./types";

export interface SanitizeResult {
	sanitized: string;
	maskedCount: number;
}

/**
 * Redact sensitive tokens in text based on GatewayRules patterns.
 * Never mutates original text. Returns new string and masked count.
 */
export function sanitizeText(
	text: string,
	rules: GatewayRules,
): SanitizeResult {
	if (
		!rules.enabled ||
		!rules.patterns ||
		rules.patterns.length === 0 ||
		!text
	) {
		return { sanitized: text, maskedCount: 0 };
	}

	let maskedCount = 0;
	let result = text;
	const replacement = rules.redact_replacement || "[REDACTED]";

	for (const rule of rules.patterns) {
		// Instantiate fresh RegExp per invocation to prevent shared state race condition with /g flag
		let reg: RegExp | undefined;
		try {
			reg = rule.regex ? new RegExp(rule.regex, "g") : undefined;
		} catch {
			// Skip malformed user-supplied regex instead of crashing the request pipeline
			continue;
		}
		if (!reg) continue;
		const matches = result.match(reg);
		if (matches && matches.length > 0) {
			maskedCount += matches.length;
			result = result.replace(reg, replacement);
		}
	}

	return { sanitized: result, maskedCount };
}

/**
 * Normalizes tool definitions for upstream providers (such as CommandCode)
 * that expect Anthropic-format tools (`name` and `input_schema`) instead of
 * OpenAI-format tools (`function: { name, parameters }`).
 */
export function normalizeUpstreamTools(
	bodyStr: string,
	targetUrl: string,
	modelName: string,
): string {
	if (!bodyStr) return bodyStr;

	const isCommandCode =
		targetUrl.includes("commandcode.ai") ||
		targetUrl.includes("commandcode") ||
		modelName.toLowerCase().startsWith("commandcode/") ||
		modelName.toLowerCase().includes("commandcode");

	if (!isCommandCode) return bodyStr;

	try {
		const parsed = JSON.parse(bodyStr);
		if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
			let modified = false;
			const transformedTools = parsed.tools.map((t: any) => {
				if (t.type === "function" && t.function) {
					modified = true;
					return {
						name: t.function.name,
						description: t.function.description || "",
						input_schema: t.function.parameters || {
							type: "object",
							properties: {},
						},
					};
				}
				return t;
			});

			if (modified) {
				return JSON.stringify({
					...parsed,
					tools: transformedTools,
				});
			}
		}
	} catch {
		// return unparsed body if JSON parse fails
	}

	return bodyStr;
}
