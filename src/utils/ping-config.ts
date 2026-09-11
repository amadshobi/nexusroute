import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface GnConfigFile {
	providerAlias?: Record<string, string>;
	aliases?: Record<string, string>; // backward-compatibility
	gateway?: Record<string, any>;
	[key: string]: any;
}

// ─────────────────────────────────────────────────────────────
// SECTION 1: GN CLI Provider Aliases & Config Json Reader
// ─────────────────────────────────────────────────────────────

/**
 * Path to ~/.config/gn/config.json
 */
export function getGnConfigJsonPath(): string {
	return path.join(os.homedir(), ".config", "gn", "config.json");
}

/**
 * Reads GN config strictly from ~/.config/gn/config.json.
 * Returns empty aliases {} if file does not exist.
 */
export function loadGnConfig(): GnConfigFile {
	const configPath = getGnConfigJsonPath();
	if (!fs.existsSync(configPath)) {
		return { aliases: {} };
	}

	try {
		const raw = fs.readFileSync(configPath, "utf8");
		return JSON.parse(raw) as GnConfigFile;
	} catch {
		return { aliases: {} };
	}
}

/**
 * Resolves provider alias dynamically from ~/.config/gn/config.json.
 * Alias is used ONLY for CLI input command convenience.
 * If alias is not configured in config.json, defaults strictly to input string verbatim.
 */
export function resolveProviderAlias(input: string): {
	provider: string;
	alias: string;
} {
	const cleanInput = input.trim().toLowerCase();
	const config = loadGnConfig();
	const aliases = config.providerAlias || config.aliases || {};

	// 1. Match alias key in ~/.config/gn/config.json (e.g. "agy" -> "google-antigravity")
	if (aliases[cleanInput]) {
		return { provider: aliases[cleanInput], alias: cleanInput };
	}

	// 2. Reverse match: input is full provider name registered in config.json
	for (const [key, target] of Object.entries(aliases)) {
		if (target.toLowerCase() === cleanInput) {
			return { provider: target, alias: key };
		}
	}

	// 3. Fallback: use clean input verbatim
	return { provider: cleanInput, alias: cleanInput };
}

/**
 * Format model ID for display.
 * Guarantees provider prefix format (e.g. "openai/gpt-5.4" or "google-antigravity/gemini-3.6-flash").
 */
export function formatModelDisplayId(
	modelId: string,
	provider: string,
): string {
	let clean = modelId
		.trim()
		.replace(/^\s*(?:[^\s]+\s+)?\[[^\]]+\]\s*/, "")
		.trim();

	if (clean.toLowerCase().startsWith(provider.toLowerCase() + "/")) {
		return clean;
	}

	return `${provider}/${clean}`;
}

// ─────────────────────────────────────────────────────────────
// SECTION 2: Custom OMP Models Parser (from models.yml)
// ─────────────────────────────────────────────────────────────

export interface CustomModel {
	id: string;
	owned_by: string;
	localId: string;
	baseUrl: string;
	apiKey: string;
	api: string;
}

/**
 * Parses custom models from ~/.omp/agent/models.yml
 */
export function parseModelsYml(): CustomModel[] {
	const modelsYmlPath = path.join(os.homedir(), ".omp", "agent", "models.yml");
	if (!fs.existsSync(modelsYmlPath)) return [];

	try {
		const content = fs.readFileSync(modelsYmlPath, "utf8");
		const lines = content.split("\n");
		const customModels: CustomModel[] = [];

		let currentProvider = "";
		let currentBaseUrl = "";
		let currentApiKey = "";
		let currentApi = "";
		let insideProviders = false;
		let inModelsList = false;

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;

			const spaces = line.match(/^ */)?.[0].length || 0;

			if (spaces === 0) {
				if (trimmed.startsWith("providers:")) {
					insideProviders = true;
				} else {
					insideProviders = false;
				}
				continue;
			}

			if (!insideProviders) continue;

			if (spaces === 2) {
				if (trimmed.endsWith(":")) {
					currentProvider = trimmed.slice(0, -1).trim();
					currentBaseUrl = "";
					currentApiKey = "";
					currentApi = "";
					inModelsList = false;
				}
				continue;
			}

			if (spaces === 4) {
				if (trimmed.startsWith("models:")) {
					inModelsList = true;
				} else {
					inModelsList = false;
					const match = trimmed.match(/^([^:]+):\s*["']?([^"']+)["']?/);
					if (match && match[1] && match[2]) {
						const key = match[1].trim();
						const val = match[2].trim();
						if (key === "baseUrl") currentBaseUrl = val;
						if (key === "apiKey") currentApiKey = val;
						if (key === "api") currentApi = val;
					}
				}
				continue;
			}

			if (inModelsList && spaces >= 6) {
				if (trimmed.startsWith("- id:")) {
					const idMatch = trimmed.match(/- id:\s*["']?([^"']+)["']?/);
					if (idMatch && idMatch[1] && currentProvider) {
						const rawId = idMatch[1];
						const modelId = rawId.startsWith(currentProvider + "/")
							? rawId
							: `${currentProvider}/${rawId}`;
						let resolvedKey = currentApiKey;
						if (currentApiKey && process.env[currentApiKey]) {
							resolvedKey = process.env[currentApiKey]!;
						}

						customModels.push({
							id: modelId,
							owned_by: currentProvider,
							localId: rawId,
							baseUrl: currentBaseUrl,
							apiKey: resolvedKey,
							api: currentApi,
						});
					}
				}
			}
		}

		return customModels;
	} catch {
		return [];
	}
}
