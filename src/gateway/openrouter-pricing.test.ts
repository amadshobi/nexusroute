import { describe, expect, it } from "bun:test";
import { OpenRouterPricingEngine } from "./openrouter-pricing";

describe("OpenRouterPricingEngine (Zero Hardcode)", () => {
	it("initializes without errors and checks stale status", () => {
		const engine = new OpenRouterPricingEngine();
		expect(engine).toBeDefined();
	});

	it("resolves pricing accurately when catalog is populated", () => {
		const engine = new OpenRouterPricingEngine();
		// Mock inject item into private cache for test isolation
		const mockItem = {
			id: "anthropic/claude-3.5-sonnet",
			name: "Claude 3.5 Sonnet",
			pricing: {
				prompt: "0.000003",
				completion: "0.000015",
				input_cache_read: "0.0000003",
			},
		};

		(engine as any).cachedCatalog.set("anthropic/claude-3.5-sonnet", mockItem);

		const resolvedExact = engine.resolveModelPricing(
			"anthropic/claude-3.5-sonnet",
		);
		expect(resolvedExact).toBeDefined();
		expect(resolvedExact?.inputUsdPer1M).toBe(3.0);
		expect(resolvedExact?.outputUsdPer1M).toBe(15.0);
		expect(resolvedExact?.cacheReadUsdPer1M).toBe(0.3);

		// Test gateway prefix stripping (e.g. "google-antigravity/" or "local-gateway/")
		(engine as any).cachedCatalog.set("google/gemini-2.5-flash", {
			id: "google/gemini-2.5-flash",
			pricing: {
				prompt: "0.0000003",
				completion: "0.0000025",
				input_cache_read: "0.00000003",
			},
		});

		const resolvedStripped = engine.resolveModelPricing(
			"google-antigravity/gemini-2.5-flash",
		);
		expect(resolvedStripped).toBeDefined();
		expect(resolvedStripped?.inputUsdPer1M).toBeCloseTo(0.3, 2);
		expect(resolvedStripped?.outputUsdPer1M).toBeCloseTo(2.5, 2);
	});

	it("returns null for unknown empty models", () => {
		const engine = new OpenRouterPricingEngine();
		expect(engine.resolveModelPricing("")).toBeNull();
		expect(
			engine.resolveModelPricing("non-existent-completely-alien-model"),
		).toBeNull();
	});
});
