/**
 * ─────────────────────────────────────────────────────────────
 * NexusRoute — CommandCode Quota Provider Unit Tests
 * ─────────────────────────────────────────────────────────────
 */

import { describe, expect, test } from "bun:test";
import { CommandCodeQuotaProvider } from "../../src/quota/providers/commandcode";
import { defaultQuotaRegistry } from "../../src/quota/registry";

describe("commandcode quota provider: core attributes", () => {
	const provider = new CommandCodeQuotaProvider();

	test("identifies with canonical name and display label", () => {
		expect(provider.name).toBe("commandcode");
		expect(provider.displayName).toBe("Command Code");
	});

	test("is registered in global QuotaRegistry", () => {
		const registered = defaultQuotaRegistry.get("commandcode");
		expect(registered).toBeDefined();
		expect(registered?.displayName).toBe("Command Code");
	});
});

describe("commandcode quota provider: fetch live quotas", () => {
	const provider = new CommandCodeQuotaProvider();

	test("returns structured ProviderQuotaResult", async () => {
		if (!provider.isAvailable()) {
			// Skip live fetch if running in keyless CI environment
			expect(true).toBe(true);
			return;
		}

		const result = await provider.fetchQuotas();
		expect(result.provider).toBe("commandcode");
		expect(result.displayName).toBe("Command Code");
		expect(result.accounts).toBeDefined();
		expect(result.accounts.length).toBeGreaterThan(0);

		const account = result.accounts[0];
		expect(account.email).toBeDefined();
		expect(["ok", "warning", "critical", "error"]).toContain(account.status);

		if (account.status !== "error") {
			expect(account.groups.length).toBeGreaterThan(0);

			const usageGroup = account.groups.find(
				(g) => g.groupName === "usage-windows",
			);
			expect(usageGroup).toBeDefined();

			const fiveHourBucket = usageGroup?.buckets.find(
				(b) => b.bucketId === "commandcode-5h",
			);
			expect(fiveHourBucket).toBeDefined();
			expect(fiveHourBucket?.remainingFraction).toBeGreaterThanOrEqual(0);
			expect(fiveHourBucket?.remainingFraction).toBeLessThanOrEqual(1);

			const weeklyBucket = usageGroup?.buckets.find(
				(b) => b.bucketId === "commandcode-weekly",
			);
			expect(weeklyBucket).toBeDefined();
			expect(weeklyBucket?.remainingFraction).toBeGreaterThanOrEqual(0);
			expect(weeklyBucket?.remainingFraction).toBeLessThanOrEqual(1);

			const balanceGroup = account.groups.find(
				(g) => g.groupName === "billing-credits",
			);
			expect(balanceGroup).toBeDefined();
		}
	});

	test("caches result within TTL window", async () => {
		if (!provider.isAvailable()) return;

		const first = await provider.fetchQuotas();
		const second = await provider.fetchQuotas();
		expect(first.updatedAt).toBe(second.updatedAt);
	});
});
