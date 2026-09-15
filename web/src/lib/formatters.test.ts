import { describe, expect, it } from "bun:test";
import {
	formatCompact,
	formatUptime,
	formatCost,
	formatCostDual,
	formatDateWIB,
	formatTimeHHmm,
	formatBucketTime,
	formatShortPath,
	formatIdr,
	formatModelDisplayName,
	extractModelId,
	computeTimeSeriesBuckets,
} from "./formatters";

describe("formatters", () => {
	describe("formatCompact", () => {
		it("handles zero and negative numbers", () => {
			expect(formatCompact(0)).toBe("0");
			expect(formatCompact(-15)).toBe("0");
		});

		it("formats sub-thousands verbatim", () => {
			expect(formatCompact(42)).toBe("42");
			expect(formatCompact(999)).toBe("999");
		});

		it("formats thousands with k suffix", () => {
			expect(formatCompact(1000)).toBe("1.0k");
			expect(formatCompact(1500)).toBe("1.5k");
			expect(formatCompact(999999)).toBe("1000.0k");
		});

		it("formats millions with M suffix", () => {
			expect(formatCompact(1_000_000)).toBe("1.00M");
			expect(formatCompact(2_550_000)).toBe("2.55M");
		});

		it("formats billions with B suffix", () => {
			expect(formatCompact(1_000_000_000)).toBe("1.00B");
			expect(formatCompact(4_200_000_000)).toBe("4.20B");
		});

		it("formats trillions with T suffix", () => {
			expect(formatCompact(2_000_000_000_000)).toBe("2.00T");
		});
	});

	describe("formatUptime", () => {
		it("handles zero or negative duration", () => {
			expect(formatUptime(0)).toBe("0h 0m");
			expect(formatUptime(-100)).toBe("0h 0m");
		});

		it("formats hours and minutes accurately", () => {
			expect(formatUptime(60)).toBe("0h 1m");
			expect(formatUptime(3600)).toBe("1h 0m");
			expect(formatUptime(3665)).toBe("1h 1m");
			expect(formatUptime(7320)).toBe("2h 2m");
		});
	});

	describe("formatCost", () => {
		it("handles zero and invalid costs", () => {
			expect(formatCost(0)).toBe("$0.00");
			expect(formatCost(-5)).toBe("$0.00");
			expect(formatCost(NaN)).toBe("$0.00");
		});

		it("formats sub-cent amounts with 4 decimals", () => {
			expect(formatCost(0.0045)).toBe("$0.0045");
			expect(formatCost(0.0001)).toBe("$0.0001");
		});

		it("formats standard amounts with 2 decimals", () => {
			expect(formatCost(1.5)).toBe("$1.50");
			expect(formatCost(12.899)).toBe("$12.90");
		});
	});

	describe("formatCostDual", () => {
		it("handles zero and invalid costs", () => {
			expect(formatCostDual(0)).toBe("$0.00 (Rp 0)");
			expect(formatCostDual(-1)).toBe("$0.00 (Rp 0)");
		});

		it("converts USD to IDR with given rate", () => {
			expect(formatCostDual(1.0, 16_000)).toBe("$1.00 (Rp 16.000)");
			expect(formatCostDual(2.5, 16_000)).toBe("$2.50 (Rp 40.000)");
		});
	});

	describe("formatDateWIB", () => {
		it("handles zero and negative timestamps", () => {
			expect(formatDateWIB(0)).toBe("-");
		});

		it("formats timestamp with WIB suffix", () => {
			const res = formatDateWIB(1788921802640);
			expect(res).toContain("WIB");
			expect(res).toContain("2026");
		});
	});

	describe("formatTimeHHmm", () => {
		it("handles zero and negative timestamps", () => {
			expect(formatTimeHHmm(0)).toBe("-");
			expect(formatTimeHHmm(-10)).toBe("-");
		});

		it("formats timestamp into HH:mm with colon", () => {
			const res = formatTimeHHmm(1788941511806);
			expect(res).toMatch(/^\d{2}:\d{2}$/);
			expect(res).not.toContain(".");
		});
	});

	describe("formatBucketTime", () => {
		// 2026-09-13T14:00:00+07:00 => 07:00 UTC
		const sundayAfternoonWib = Date.UTC(2026, 8, 13, 7, 0, 0);

		it("handles zero, negative and invalid timestamps", () => {
			expect(formatBucketTime(0)).toBe("-");
			expect(formatBucketTime(-10)).toBe("-");
			expect(formatBucketTime(NaN)).toBe("-");
		});

		it("formats as HH:mm when window span is omitted or <= 48 hours", () => {
			expect(formatBucketTime(sundayAfternoonWib)).toBe("14:00");
			expect(formatBucketTime(sundayAfternoonWib, 48 * 60 * 60 * 1000)).toBe(
				"14:00",
			);
			expect(formatBucketTime(sundayAfternoonWib, 60 * 60 * 1000)).toBe(
				"14:00",
			);
		});

		it("formats as ddd HH:mm when window span is <= 7 days", () => {
			expect(formatBucketTime(sundayAfternoonWib, 3 * 24 * 60 * 60 * 1000)).toBe(
				"Sun 14:00",
			);
			expect(formatBucketTime(sundayAfternoonWib, 7 * 24 * 60 * 60 * 1000)).toBe(
				"Sun 14:00",
			);
		});

		it("formats as dd/MM when window span exceeds 7 days", () => {
			expect(
				formatBucketTime(sundayAfternoonWib, 8 * 24 * 60 * 60 * 1000),
			).toBe("13/09");
			expect(
				formatBucketTime(sundayAfternoonWib, 30 * 24 * 60 * 60 * 1000),
			).toBe("13/09");
		});
	});

	describe("formatShortPath", () => {
		it("replaces home directory with tilde", () => {
			expect(formatShortPath("/home/shobixlinuxdev/civil/goblin-vault")).toBe(
				"~/civil/goblin-vault",
			);
			expect(formatShortPath("/")).toBe("~");
			expect(formatShortPath("")).toBe("~");
		});
	});

	describe("formatIdr", () => {
		it("formats sub-thousand rupiah without a suffix", () => {
			expect(formatIdr(0, 17000)).toBe("Rp0");
			expect(formatIdr(0.05, 17000)).toBe("Rp850");
		});

		it("formats thousands with K suffix", () => {
			expect(formatIdr(0.1, 17000)).toBe("Rp1.7K");
		});

		it("formats millions with jt suffix", () => {
			expect(formatIdr(100, 17000)).toBe("Rp1.70jt");
		});

		it("formats billions with M suffix", () => {
			expect(formatIdr(100_000, 17000)).toBe("Rp1.70M");
		});

		it("formats trillions with T suffix", () => {
			expect(formatIdr(100_000_000, 17000)).toBe("Rp1.70T");
		});

		it("uses the default rate when omitted", () => {
			expect(formatIdr(100)).toBe(formatIdr(100, 17000));
		});
	});

	describe("formatModelDisplayName", () => {
		it("formats provider-prefixed model IDs into clean human titles", () => {
			expect(formatModelDisplayName("google-antigravity/gemini-3.8-flash")).toBe(
				"Gemini 3.8 Flash",
			);
			expect(
				formatModelDisplayName("openrouter/anthropic/claude-3.7-sonnet-20250219"),
			).toBe("Claude 3.7 Sonnet");
			expect(formatModelDisplayName("deepseek/deepseek-v4-flash")).toBe(
				"DeepSeek V4 Flash",
			);
			expect(formatModelDisplayName("openai/gpt-4o-mini")).toBe("GPT 4o Mini");
			expect(formatModelDisplayName("meta-llama/llama-3.3-70b-instruct")).toBe(
				"Llama 3.3 70B Instruct",
			);
		});

		it("parses JSON-serialized model strings from opencode SQLite records", () => {
			const json = JSON.stringify({
				id: "google-antigravity/gemini-3.8-flash",
				providerID: "local-gateway",
			});
			expect(formatModelDisplayName(json)).toBe("Gemini 3.8 Flash");
			const claudeJson = JSON.stringify({
				id: "anthropic/claude-sonnet-4-6",
				providerID: "local-gateway",
			});
			expect(formatModelDisplayName(claudeJson)).toBe("Claude Sonnet 4 6");
		});

		it("handles fallback and edge cases gracefully", () => {
			expect(formatModelDisplayName("")).toBe("Unknown");
			expect(formatModelDisplayName(undefined)).toBe("Unknown");
			expect(formatModelDisplayName("custom-unknown-model")).toBe(
				"Custom Unknown Model",
			);
		});
	});

	describe("extractModelId", () => {
		it("extracts model ID from JSON string", () => {
			const json = JSON.stringify({
				id: "google-antigravity/gemini-3.8-flash",
				providerID: "local-gateway",
			});
			expect(extractModelId(json)).toBe("gemini-3.8-flash");
		});

		it("extracts model ID from plain string", () => {
			expect(extractModelId("deepseek-v4-flash")).toBe("deepseek-v4-flash");
			expect(extractModelId("cmc/deepseek/deepseek-v4-flash")).toBe(
				"deepseek-v4-flash",
			);
		});
	});

	describe("computeTimeSeriesBuckets", () => {
		it("returns array of zeros when items are empty", () => {
			const res = computeTimeSeriesBuckets(
				[],
				() => 0,
				() => 1,
				8,
			);
			expect(res).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
		});

		it("aggregates values across chronological buckets", () => {
			const items = [
				{ ts: 1000, val: 10 },
				{ ts: 2000, val: 20 },
				{ ts: 3000, val: 30 },
				{ ts: 4000, val: 40 },
			];
			const res = computeTimeSeriesBuckets(
				items,
				(i) => i.ts,
				(i) => i.val,
				4,
				1000,
				5000,
			);
			expect(res.length).toBe(4);
			expect(res[0]).toBe(10);
			expect(res[1]).toBe(20);
			expect(res[2]).toBe(30);
			expect(res[3]).toBe(40);
		});
	});
});
