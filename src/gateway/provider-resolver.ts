/**
 * ─────────────────────────────────────────────────────────────
 * NexusRoute — Client App & Real Provider Resolver Helper
 * ─────────────────────────────────────────────────────────────
 *
 * Mendeteksi caller application (OpenCode, Hermes, Claude Code, curl)
 * dari HTTP headers (x-client-app, user-agent) dan mengekstrak
 * Real Provider engine dari model ID (Antigravity, DeepSeek, Ollama, CommandCode).
 */

/**
 * Deteksi caller client application dari HTTP Request.
 * Prioritas:
 * 1. x-client-app / x-app-name (custom explicit header)
 * 2. User-Agent heuristic (opencode, hermes, claude, aider, curl)
 * 3. Fallback "unknown"
 */
export function detectClientApp(req: Request): string {
	const custom =
		req.headers.get("x-client-app") ||
		req.headers.get("X-Client-App") ||
		req.headers.get("x-app-name") ||
		req.headers.get("X-App-Name");

	if (custom && custom.trim()) {
		return custom.trim().toLowerCase();
	}

	const ua = req.headers.get("user-agent") || req.headers.get("User-Agent") || "";
	if (!ua) return "unknown";

	const uaLower = ua.toLowerCase();
	if (uaLower.includes("opencode")) return "opencode";
	if (uaLower.includes("hermes")) return "hermes";
	if (uaLower.includes("claude-code") || uaLower.includes("claudecode")) return "claude-code";
	if (uaLower.includes("aider")) return "aider";
	if (uaLower.includes("cursor")) return "cursor";
	if (uaLower.includes("cline") || uaLower.includes("roo-cline")) return "cline";
	if (uaLower.includes("curl/")) return "curl";
	if (uaLower.includes("python-requests") || uaLower.includes("httpx")) return "python";
	if (uaLower.includes("node-fetch") || uaLower.includes("undici") || uaLower.includes("bun/")) return "node/bun";

	return "generic";
}

/**
 * Ekstrak Real Provider dari model ID dan target upstream.
 * Contoh:
 * - google-antigravity/gemini-3.8-flash -> antigravity
 * - openrouter/anthropic/claude-3.5-sonnet -> openrouter
 * - ollama/qwen2.5-coder -> ollama
 * - cmc/claude-3-7-sonnet -> commandcode
 * - deepseek-chat -> deepseek
 */
export function resolveRealProvider(modelId: string, upstreamName?: string): string {
	const m = (modelId || "").toLowerCase().trim();

	// Explicit prefixes
	if (m.startsWith("google-antigravity/") || m.startsWith("antigravity/")) {
		return "antigravity";
	}
	if (m.startsWith("cmc/") || m.startsWith("commandcode/") || upstreamName === "commandcode" || upstreamName === "cmc") {
		return "commandcode";
	}
	if (m.startsWith("openrouter/")) {
		return "openrouter";
	}
	if (m.startsWith("ollama/")) {
		return "ollama";
	}
	if (m.startsWith("deepseek/") || m.startsWith("deepseek-")) {
		return "deepseek";
	}
	if (m.startsWith("claude-")) {
		return "anthropic";
	}
	if (m.startsWith("gpt-") || m.startsWith("o1-") || m.startsWith("o3-")) {
		return "openai";
	}
	if (m.startsWith("gemini-")) {
		return "google";
	}
	if (m.startsWith("qwen/") || m.startsWith("qwen-")) {
		return "qwen";
	}
	if (m.startsWith("minimax/") || m.startsWith("minimax-")) {
		return "minimax";
	}
	if (m.startsWith("kimi/") || m.startsWith("moonshot/")) {
		return "moonshotai";
	}
	if (m.startsWith("glm/") || m.startsWith("zai/")) {
		return "zai-org";
	}

	// Slashed format: `vendor/model`
	if (m.includes("/")) {
		const vendor = m.split("/")[0];
		if (vendor === "google-antigravity") return "antigravity";
		return vendor;
	}

	// Fallback ke upstream jika upstream bukan omp/vansrouter (misal commandcode)
	if (upstreamName && upstreamName !== "omp" && upstreamName !== "vansrouter") {
		return upstreamName;
	}

	return "other";
}
