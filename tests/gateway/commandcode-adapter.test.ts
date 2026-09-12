/**
 * ─────────────────────────────────────────────────────────────
 * NexusRoute — CommandCode Adapter & Gateway Integration Tests
 * ─────────────────────────────────────────────────────────────
 */

import { describe, expect, test } from "bun:test";
import { defaultCommandCodeAdapter } from "../../src/adapters/commandcode";
import { translateOpenAIToCommandCode } from "../../src/adapters/commandcode/request-translator";
import {
	createTranslatorState,
	parseCommandCodeEvent,
} from "../../src/adapters/commandcode/response-translator";
import {
	buildUpstreamUrl,
	collectCatalogs,
	resolveUpstreamForModel,
} from "../../src/gateway/upstream-router";
import type { UpstreamTarget } from "../../src/gateway/types";

describe("commandcode adapter: core methods", () => {
	test("adapter identifies correctly", () => {
		expect(defaultCommandCodeAdapter.id).toBe("commandcode");
		expect(defaultCommandCodeAdapter.baseUrl).toBe(
			"https://api.commandcode.ai/alpha/generate",
		);
	});

	test("returns models list", () => {
		const models = defaultCommandCodeAdapter.getModels();
		expect(Array.isArray(models)).toBe(true);
		expect(models.length).toBeGreaterThan(0);
		expect(models.some((m) => m.id.includes("deepseek"))).toBe(true);
	});

	test("isCommandCodeModel detects bare and prefixed models", () => {
		const firstModel = defaultCommandCodeAdapter.getModels()[0].id;
		expect(defaultCommandCodeAdapter.isCommandCodeModel(firstModel)).toBe(true);
		expect(
			defaultCommandCodeAdapter.isCommandCodeModel(`cmc/${firstModel}`),
		).toBe(true);
		expect(
			defaultCommandCodeAdapter.isCommandCodeModel(`commandcode/${firstModel}`),
		).toBe(true);
		expect(
			defaultCommandCodeAdapter.isCommandCodeModel("completely-non-existent-model"),
		).toBe(false);
	});
});

describe("commandcode: request translation", () => {
	test("translates standard OpenAI chat payload to CommandCode envelope", () => {
		const openAiReq = {
			model: "commandcode/deepseek/deepseek-v4-flash",
			messages: [
				{ role: "system", content: "You are an assistant" },
				{ role: "user", content: "Hello world" },
			],
			temperature: 0.7,
			max_tokens: 4096,
		};

		const translated = translateOpenAIToCommandCode(openAiReq);
		expect(translated.params.model).toBe("deepseek/deepseek-v4-flash");
		expect(translated.params.system).toBe("You are an assistant");
		expect(translated.params.stream).toBe(true);
		expect(translated.params.temperature).toBe(0.7);
		expect(translated.params.max_tokens).toBe(4096);
		expect(translated.params.messages.length).toBe(1);
		expect(translated.params.messages[0].role).toBe("user");
		expect(translated.params.messages[0].content[0].text).toBe("Hello world");
	});

	test("translates tool definitions into Anthropic schema", () => {
		const openAiReq = {
			model: "deepseek/deepseek-v4-flash",
			messages: [{ role: "user", content: "read file" }],
			tools: [
				{
					type: "function",
					function: {
						name: "read_file",
						description: "Read contents of a file",
						parameters: {
							type: "object",
							properties: {
								filePath: { type: "string" },
							},
							required: ["filePath"],
						},
					},
				},
			],
		};

		const translated = translateOpenAIToCommandCode(openAiReq);
		expect(translated.params.tools).toBeDefined();
		expect(translated.params.tools.length).toBe(1);
		expect(translated.params.tools[0].name).toBe("read_file");
		expect(translated.params.tools[0].description).toBe(
			"Read contents of a file",
		);
		expect(translated.params.tools[0].input_schema.properties.filePath).toBeDefined();
	});
});

describe("commandcode: response translation", () => {
	test("translates NDJSON text delta events to OpenAI SSE chunks", () => {
		const state = createTranslatorState("deepseek/deepseek-v4-flash");
		const eventLine = JSON.stringify({
			type: "text-delta",
			text: "Hello from CommandCode",
		});

		const chunks = parseCommandCodeEvent(eventLine, state);
		// Initial chunk includes assistant role + content chunk
		expect(chunks.length).toBe(2);
		expect(chunks[0].choices[0].delta.role).toBe("assistant");
		expect(chunks[1].choices[0].delta.content).toBe("Hello from CommandCode");
		expect(chunks[1].model).toBe("deepseek/deepseek-v4-flash");
	});

	test("translates finish event to stop finish_reason chunk", () => {
		const state = createTranslatorState("deepseek/deepseek-v4-flash");
		state.chunkIndex = 1; // already emitted role
		const finishLine = JSON.stringify({
			type: "finish",
			finishReason: "stop",
		});

		const chunks = parseCommandCodeEvent(finishLine, state);
		expect(chunks.length).toBe(1);
		expect(chunks[0].choices[0].finish_reason).toBe("stop");
	});
});

describe("commandcode: gateway upstream router integration", () => {
	const cmcUpstream: UpstreamTarget = {
		name: "commandcode",
		host: "api.commandcode.ai",
		port: 443,
		basePath: "/alpha",
	};

	test("buildUpstreamUrl correctly maps port 443 to https without explicit port", () => {
		const url = buildUpstreamUrl(cmcUpstream, "/v1/generate");
		expect(url).toBe("https://api.commandcode.ai/alpha/generate");
	});

	test("resolveUpstreamForModel routes cmc/ and commandcode/ prefixed models to commandcode", () => {
		const upstreams: UpstreamTarget[] = [
			{ name: "omp", host: "127.0.0.1", port: 4000, basePath: "/v1" },
			cmcUpstream,
		];
		const catalogMap = new Map<string, Set<string>>([
			["omp", new Set(["google-antigravity/gemini-3.8-flash"])],
			["commandcode", new Set(["deepseek/deepseek-v4-flash"])],
		]);

		const target1 = resolveUpstreamForModel(
			upstreams,
			catalogMap,
			"cmc/deepseek/deepseek-v4-flash",
			"omp",
		);
		expect(target1.name).toBe("commandcode");

		const target2 = resolveUpstreamForModel(
			upstreams,
			catalogMap,
			"commandcode/deepseek/deepseek-v4-flash",
			"omp",
		);
		expect(target2.name).toBe("commandcode");

		const target3 = resolveUpstreamForModel(
			upstreams,
			catalogMap,
			"deepseek/deepseek-v4-flash",
			"omp",
		);
		expect(target3.name).toBe("commandcode");
	});

	test("collectCatalogs gathers commandcode models without HTTP fetch", async () => {
		const upstreams: UpstreamTarget[] = [cmcUpstream];
		const catalogs = await collectCatalogs(upstreams);
		expect(catalogs.has("commandcode")).toBe(true);
		const modelSet = catalogs.get("commandcode")!;
		expect(modelSet.size).toBeGreaterThan(0);
		expect(
			modelSet.has("deepseek/deepseek-v4-pro") ||
				modelSet.has("deepseek/deepseek-v4-flash") ||
				modelSet.has("claude-opus-5"),
		).toBe(true);
	});
});
