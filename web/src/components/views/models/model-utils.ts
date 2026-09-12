/** Model ID helpers shared by the model governance views. */

/** Extract the provider prefix, e.g. `google-antigravity/gemini` -> `google-antigravity`. */
export function getProviderFromModel(modelId: string): string {
	if (modelId.includes("/")) return modelId.split("/")[0];
	if (modelId.startsWith("claude-")) return "anthropic";
	if (modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("o3-")) return "openai";
	if (modelId.startsWith("gemini-")) return "google";
	if (modelId.startsWith("deepseek-")) return "deepseek";
	if (modelId.startsWith("kimi-")) return "moonshotai";
	if (modelId.startsWith("glm-")) return "zai-org";
	if (modelId.startsWith("minimax-")) return "minimax";
	if (modelId.startsWith("qwen-")) return "qwen";
	return "commandcode";
}

/** Strip the provider prefix for display inside a provider group. */
export function shortModelName(modelId: string): string {
	if (modelId.includes("/")) return modelId.slice(modelId.indexOf("/") + 1);
	return modelId;
}

/** `google-antigravity` -> `Google Antigravity`. */
export function providerDisplayName(name: string): string {
	if (name === "other") return "Other";
	return name
		.split("-")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}
