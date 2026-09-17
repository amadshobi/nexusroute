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
 * Forbidden OpenAPI keywords for Google Gemini / Antigravity tool calling backend.
 */
const CCA_STRIP_KEYWORDS = new Set([
	"$schema",
	"$id",
	"title",
	"const",
	"contentEncoding",
	"contentMediaType",
	"dependentRequired",
	"dependentSchemas",
	"maxContains",
	"maxProperties",
	"minContains",
	"minProperties",
	"patternProperties",
	"propertyNames",
	"additionalProperties",
	"unevaluatedItems",
	"unevaluatedProperties",
]);

/**
 * Recursively sanitizes JSON Schema parameters to protect against Google Antigravity
 * / Gemini MALFORMED_FUNCTION_CALL and backend argument schema rejections.
 */
export function sanitizeSchemaForGemini(schema: any): any {
	if (!schema || typeof schema !== "object") {
		return schema;
	}

	if (Array.isArray(schema)) {
		return schema.map(sanitizeSchemaForGemini);
	}

	const cleaned: Record<string, any> = {};

	for (const [key, value] of Object.entries(schema)) {
		if (CCA_STRIP_KEYWORDS.has(key)) {
			continue;
		}

		if (
			(key === "properties" || key === "$defs" || key === "definitions") &&
			value &&
			typeof value === "object"
		) {
			const cleanedDict: Record<string, any> = {};
			for (const [subKey, subVal] of Object.entries(value)) {
				cleanedDict[subKey] = sanitizeSchemaForGemini(subVal);
			}
			cleaned[key] = cleanedDict;
			continue;
		}

		if ((key === "items" || key === "additionalItems") && value) {
			cleaned[key] = sanitizeSchemaForGemini(value);
			continue;
		}

		if (key === "anyOf" || key === "oneOf" || key === "allOf") {
			if (Array.isArray(value)) {
				cleaned[key] = value.map(sanitizeSchemaForGemini);
			}
			continue;
		}

		if (
			(key === "if" || key === "then" || key === "else" || key === "not") &&
			value &&
			typeof value === "object"
		) {
			cleaned[key] = sanitizeSchemaForGemini(value);
			continue;
		}

		if (key === "type" && typeof value === "string") {
			cleaned[key] = value.toLowerCase();
			continue;
		}

		cleaned[key] = value;
	}

	// Ensure object types always have a properties map
	if (cleaned.type === "object" && (!cleaned.properties || typeof cleaned.properties !== "object")) {
		cleaned.properties = {};
	}

	// Filter required array to only reference existing properties
	if (Array.isArray(cleaned.required) && cleaned.properties) {
		const propKeys = new Set(Object.keys(cleaned.properties));
		cleaned.required = cleaned.required.filter((prop: any) =>
			typeof prop === "string" && propKeys.has(prop)
		);
		if (cleaned.required.length === 0) {
			delete cleaned.required;
		}
	}

	return cleaned;
}

/**
 * Normalizes tool definitions for upstream providers:
 * 1. CommandCode: Anthropic-format tools (`name` and `input_schema`).
 * 2. Gemini / Antigravity: Strips complex OpenAPI 3.1 keywords that cause MALFORMED_FUNCTION_CALL.
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

	const isGeminiOrAntigravity =
		modelName.toLowerCase().includes("gemini") ||
		modelName.toLowerCase().includes("antigravity") ||
		targetUrl.includes("antigravity");

	if (!isCommandCode && !isGeminiOrAntigravity) return bodyStr;

	try {
		const parsed = JSON.parse(bodyStr);
		if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
			let modified = false;

			if (isCommandCode) {
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
					parsed.tools = transformedTools;
				}
			} else if (isGeminiOrAntigravity) {
				const sanitizedTools = parsed.tools.map((t: any) => {
					if (t.type === "function" && t.function?.parameters) {
						modified = true;
						return {
							...t,
							function: {
								...t.function,
								parameters: sanitizeSchemaForGemini(t.function.parameters),
							},
						};
					}
					return t;
				});

				if (modified) {
					parsed.tools = sanitizedTools;
				}
			}

			if (modified) {
				return JSON.stringify(parsed);
			}
		}
	} catch {
		// return unparsed body if JSON parse fails
	}

	return bodyStr;
}

/**
 * Patterns identifying models that require or support thinking effort.
 */
const REASONING_MODEL_PATTERNS = [
	/gemini-3/i,
	/claude-.*-thinking/i,
	/claude-opus-4/i,
	/claude-sonnet-4/i,
	/\br1\b/i,
	/\bo1\b/i,
	/\bo3\b/i,
	/\bo4\b/i,
	/qwq/i,
	/reasoning/i,
	/thinking/i,
	/gpt-oss/i,
];

export function isReasoningModel(modelName: string): boolean {
	if (!modelName) return false;
	const lower = modelName.toLowerCase();
	return REASONING_MODEL_PATTERNS.some((p) => p.test(lower));
}

/**
 * Ensures a fallback reasoning_effort (default "high") is injected for reasoning models
 * that would otherwise fail upstream (e.g. Gemini 3.1 Pro on Google Antigravity
 * rejecting budget 0 when reasoning effort is omitted by client).
 */
export function normalizeUpstreamReasoning(
	bodyStr: string,
	modelName: string,
	defaultEffort = "high",
): string {
	if (!bodyStr || !modelName) return bodyStr;
	if (!isReasoningModel(modelName)) return bodyStr;

	try {
		const parsed = JSON.parse(bodyStr);
		if (!parsed.reasoning_effort) {
			parsed.reasoning_effort = defaultEffort;
			return JSON.stringify(parsed);
		}
	} catch {
		// return unparsed body if JSON parse fails
	}

	return bodyStr;
}

export type SalvagedType = "thought-only" | "malformed-call" | "upstream-error";

/**
 * Checks an SSE chunk or text stream line for recoverable mid-stream fatal errors.
 */
export function detectSalvagableError(chunkText: string): SalvagedType | null {
	if (!chunkText) return null;
	if (
		chunkText.includes("thought-only response without final output") ||
		/thought-only response/i.test(chunkText)
	) {
		return "thought-only";
	}
	if (
		chunkText.includes("MALFORMED_FUNCTION_CALL") ||
		/MALFORMED_FUNCTION_CALL/i.test(chunkText)
	) {
		return "malformed-call";
	}
	if (
		chunkText.includes('"type":"upstream_error"') ||
		chunkText.includes('"type": "upstream_error"') ||
		(chunkText.includes('"error":') && chunkText.includes("upstream_error"))
	) {
		return "upstream-error";
	}
	return null;
}

/**
 * Synthesizes valid SSE completion chunks to cleanly conclude an interrupted turn,
 * preventing OpenCode or other downstream clients from throwing fatal session crashes.
 */
export function buildSalvagedChunks(
	salvaged: SalvagedType,
	modelId = "unknown",
	isMessagesReq = false,
): string[] {
	const explanation =
		salvaged === "thought-only"
			? "\n\n[Note: Reasoning concluded without generating final response content. You may re-prompt or continue.]"
			: salvaged === "malformed-call"
				? "\n\n[Note: The model generated a malformed tool call syntax. Please retry or rephrase your request.]"
				: "\n\n[Note: Upstream model encountered an interrupted streaming response. Please continue.]";

	if (isMessagesReq) {
		return [
			`data: ${JSON.stringify({
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: explanation },
			})}\n\n`,
			`data: ${JSON.stringify({
				type: "message_delta",
				delta: { stop_reason: "end_turn", stop_sequence: null },
			})}\n\n`,
			`data: ${JSON.stringify({
				type: "message_stop",
			})}\n\n`,
		];
	}

	const timestamp = Math.floor(Date.now() / 1000);
	return [
		`data: ${JSON.stringify({
			id: "chatcmpl-gn-salvaged",
			object: "chat.completion.chunk",
			created: timestamp,
			model: modelId,
			choices: [
				{
					index: 0,
					delta: { content: explanation },
					finish_reason: null,
				},
			],
		})}\n\n`,
		`data: ${JSON.stringify({
			id: "chatcmpl-gn-salvaged",
			object: "chat.completion.chunk",
			created: timestamp,
			model: modelId,
			choices: [
				{
					index: 0,
					delta: {},
					finish_reason: "stop",
				},
			],
		})}\n\n`,
		"data: [DONE]\n\n",
	];
}

