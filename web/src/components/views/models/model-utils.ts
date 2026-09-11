/** Model ID helpers shared by the model governance views. */

/** Extract the provider prefix, e.g. `google-antigravity/gemini` -> `google-antigravity`. */
export function getProviderFromModel(modelId: string): string {
	if (modelId.includes("/")) return modelId.split("/")[0];
	return "other";
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
