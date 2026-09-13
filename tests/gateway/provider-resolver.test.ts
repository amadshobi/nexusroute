import { describe, expect, test } from "bun:test";
import { detectClientApp, resolveRealProvider } from "../../src/gateway/provider-resolver";

describe("provider-resolver", () => {
	describe("detectClientApp", () => {
		test("detects explicit x-client-app header with top priority", () => {
			const req = new Request("http://localhost:4010/v1/chat/completions", {
				headers: {
					"x-client-app": "opencode-custom",
					"user-agent": "curl/7.88.1",
				},
			});
			expect(detectClientApp(req)).toBe("opencode-custom");
		});

		test("detects OpenCode from user-agent", () => {
			const req = new Request("http://localhost:4010/v1/chat/completions", {
				headers: {
					"user-agent": "opencode/1.0.12 darwin-arm64",
				},
			});
			expect(detectClientApp(req)).toBe("opencode");
		});

		test("detects Hermes from user-agent", () => {
			const req = new Request("http://localhost:4010/v1/chat/completions", {
				headers: {
					"user-agent": "hermes-agent/0.4.0",
				},
			});
			expect(detectClientApp(req)).toBe("hermes");
		});

		test("detects curl from user-agent", () => {
			const req = new Request("http://localhost:4010/v1/chat/completions", {
				headers: {
					"user-agent": "curl/8.4.0",
				},
			});
			expect(detectClientApp(req)).toBe("curl");
		});

		test("returns unknown when no headers provided", () => {
			const req = new Request("http://localhost:4010/v1/chat/completions");
			expect(detectClientApp(req)).toBe("unknown");
		});
	});

	describe("resolveRealProvider", () => {
		test("resolves antigravity models", () => {
			expect(resolveRealProvider("google-antigravity/gemini-3.8-flash")).toBe("antigravity");
			expect(resolveRealProvider("antigravity/claude-3-5-sonnet")).toBe("antigravity");
		});

		test("resolves commandcode models", () => {
			expect(resolveRealProvider("cmc/claude-3-7-sonnet")).toBe("commandcode");
			expect(resolveRealProvider("commandcode/gpt-4o")).toBe("commandcode");
			expect(resolveRealProvider("claude-3-7-sonnet", "commandcode")).toBe("commandcode");
		});

		test("resolves openrouter models", () => {
			expect(resolveRealProvider("openrouter/anthropic/claude-3.5-sonnet")).toBe("openrouter");
		});

		test("resolves ollama models", () => {
			expect(resolveRealProvider("ollama/qwen2.5-coder")).toBe("ollama");
		});

		test("resolves deepseek models", () => {
			expect(resolveRealProvider("deepseek/deepseek-chat")).toBe("deepseek");
			expect(resolveRealProvider("deepseek-reasoner")).toBe("deepseek");
		});

		test("resolves vendor slash prefixes", () => {
			expect(resolveRealProvider("meta-llama/llama-3-70b")).toBe("meta-llama");
		});
	});
});
