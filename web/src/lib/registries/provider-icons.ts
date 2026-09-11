/**
 * Dynamic Provider & Model Family SVG Auto-Discovery.
 * Zero-hardcoded: reads from `web/src/assets/providers/*.svg` dynamically.
 */

// Eager load all SVGs in assets/providers
const providerIcons = import.meta.glob<{ default: string }>(
	"@/assets/providers/*.svg",
	{ eager: true },
);

// Pre-index by filename slug for O(1) matching
const iconSlugMap = new Map<string, string>();
for (const [path, mod] of Object.entries(providerIcons)) {
	const filename = path.split("/").pop()?.replace(".svg", "").toLowerCase();
	if (filename && mod.default) {
		iconSlugMap.set(filename, mod.default);
	}
}

/**
 * Normalizes any model ID or provider string to find the matching provider SVG.
 * Examples:
 * - "google-antigravity/gemini-3.8-flash" -> matches "google" or "antigravity"
 * - "cmc/deepseek/deepseek-v4-flash" -> matches "deepseek"
 * - "openrouter/anthropic/claude-3-5-sonnet" -> matches "anthropic"
 * - "ollama-cloud/minimax-m3" -> matches "minimax"
 */
export function resolveProviderIcon(modelOrProvider?: string): string | null {
	if (!modelOrProvider) return null;

	const raw = modelOrProvider.toLowerCase();
	const segments = raw.split(/[/:]/).map((s) => s.trim()).filter(Boolean);

	// 1. Direct segment matching (from left to right and right to left)
	for (const seg of segments) {
		if (iconSlugMap.has(seg)) {
			return iconSlugMap.get(seg)!;
		}
	}

	// 2. Keyword heuristic mapping for common families
	const keywords: [RegExp, string][] = [
		[/gemini|google/, "google"],
		[/deepseek/, "deepseek"],
		[/claude|anthropic|sonnet|opus|haiku/, "anthropic"],
		[/openai|gpt|o1|o3/, "openai"],
		[/minimax/, "minimax"],
		[/kimi|moonshot/, "kimi-for-coding"],
		[/qwen|alibaba/, "alibaba"],
		[/glm|zhipu|zai/, "zai"],
		[/mistral|codestral/, "codestral"],
		[/ollama/, "ollama-cloud"],
		[/nvidia|nemotron/, "nvidia"],
		[/openrouter/, "openrouter"],
		[/github|copilot/, "github-copilot"],
	];

	for (const [pattern, targetSlug] of keywords) {
		if (pattern.test(raw) && iconSlugMap.has(targetSlug)) {
			return iconSlugMap.get(targetSlug)!;
		}
	}

	return null;
}

/**
 * Returns formatted family display name
 */
export function resolveModelFamilyName(modelId?: string): string {
	if (!modelId) return "Unknown";
	const lower = modelId.toLowerCase();

	if (lower.includes("gemini")) return "Gemini";
	if (lower.includes("deepseek")) return "DeepSeek";
	if (lower.includes("claude") || lower.includes("sonnet") || lower.includes("opus")) return "Claude";
	if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3")) return "OpenAI";
	if (lower.includes("minimax")) return "MiniMax";
	if (lower.includes("kimi") || lower.includes("moonshot")) return "Kimi";
	if (lower.includes("qwen")) return "Qwen";
	if (lower.includes("glm")) return "GLM";

	// Fallback to first segment or short model name
	const parts = modelId.split("/");
	return parts[parts.length - 1] || modelId;
}
