import { defaultCommandCodeAdapter } from "../../adapters/commandcode";
import type {
	IQuotaProvider,
	ProviderQuotaResult,
	AccountQuota,
	QuotaGroup,
	QuotaBucket,
} from "../types";

export interface CommandCodeProviderOptions {
	cacheTtlMs?: number;
}

export class CommandCodeQuotaProvider implements IQuotaProvider {
	public readonly name = "commandcode";
	public readonly displayName = "Command Code";

	private cacheTtlMs: number;
	private cachedResult: ProviderQuotaResult | null = null;
	private lastFetchTime = 0;

	constructor(options: CommandCodeProviderOptions = {}) {
		this.cacheTtlMs = options.cacheTtlMs ?? 20_000;
	}

	isAvailable(): boolean {
		return defaultCommandCodeAdapter.isAvailable();
	}

	async fetchQuotas(): Promise<ProviderQuotaResult> {
		const now = Date.now();
		if (this.cachedResult && now - this.lastFetchTime < this.cacheTtlMs) {
			return this.cachedResult;
		}

		if (!this.isAvailable()) {
			return {
				provider: this.name,
				displayName: this.displayName,
				accounts: [],
				updatedAt: now,
			};
		}

		const apiKey = defaultCommandCodeAdapter.getApiKey();
		const headers = {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			"x-command-code-version": "0.25.7",
			"x-cli-environment": "cli",
		};

		try {
			const [whoamiRes, creditsRes, usageRes] = await Promise.allSettled([
				fetch("https://api.commandcode.ai/alpha/whoami", {
					headers,
					signal: AbortSignal.timeout(6000),
				}),
				fetch("https://api.commandcode.ai/alpha/billing/credits", {
					headers,
					signal: AbortSignal.timeout(6000),
				}),
				fetch("https://api.commandcode.ai/alpha/usage/summary", {
					headers,
					signal: AbortSignal.timeout(6000),
				}),
			]);

			let email = "Account (Active)";
			let userName = "";
			if (whoamiRes.status === "fulfilled" && whoamiRes.value.ok) {
				try {
					const whoamiData = (await whoamiRes.value.json()) as any;
					if (whoamiData?.user?.email) {
						email = whoamiData.user.email;
					} else if (whoamiData?.user?.name) {
						email = whoamiData.user.name;
					}
					userName = whoamiData?.user?.userName || "";
				} catch {
					// fallback default
				}
			}

			let creditsData: any = null;
			if (creditsRes.status === "fulfilled" && creditsRes.value.ok) {
				try {
					creditsData = (await creditsRes.value.json()) as any;
				} catch {
					// ignore
				}
			}

			let usageData: any = null;
			if (usageRes.status === "fulfilled" && usageRes.value.ok) {
				try {
					usageData = (await usageRes.value.json()) as any;
				} catch {
					// ignore
				}
			}

			const groups: QuotaGroup[] = [];
			let overallStatus: "ok" | "warning" | "critical" = "ok";

			// 1. Usage Window Limits (5h & Weekly)
			const windowLimits = creditsData?.windowLimits;
			if (windowLimits) {
				const windowBuckets: QuotaBucket[] = [];

				if (windowLimits.fiveHour && typeof windowLimits.fiveHour.cap === "number") {
					const fh = windowLimits.fiveHour;
					const cap = Math.max(0.01, fh.cap);
					const used = Math.max(0, fh.used || 0);
					const fraction = Math.max(0, Math.min(1, 1 - used / cap));
					if (fraction <= 0.2 || fh.exceeded) {
						overallStatus = "critical";
					} else if (fraction <= 0.5) {
						overallStatus = "warning";
					}

					windowBuckets.push({
						bucketId: "commandcode-5h",
						displayName: "5-Hour Window",
						window: "5 Hours",
						remainingFraction: fraction,
						resetTime: fh.resetAt ? new Date(fh.resetAt).toISOString() : undefined,
						description: `$${used.toFixed(2)} / $${cap.toFixed(2)}`,
					});
				}

				if (windowLimits.weekly && typeof windowLimits.weekly.cap === "number") {
					const wk = windowLimits.weekly;
					const cap = Math.max(0.01, wk.cap);
					const used = Math.max(0, wk.used || 0);
					const fraction = Math.max(0, Math.min(1, 1 - used / cap));
					if (fraction <= 0.2 || wk.exceeded) overallStatus = "critical";
					else if (fraction <= 0.5 && overallStatus !== "critical")
						overallStatus = "warning";

					windowBuckets.push({
						bucketId: "commandcode-weekly",
						displayName: "Weekly Window",
						window: "7 Days",
						remainingFraction: fraction,
						resetTime: wk.resetAt ? new Date(wk.resetAt).toISOString() : undefined,
						description: `$${used.toFixed(2)} / $${cap.toFixed(2)}`,
					});
				}

				if (windowBuckets.length > 0) {
					groups.push({
						groupName: "usage-windows",
						displayName: "Usage Windows",
						description: "Rolling rate limits per period",
						buckets: windowBuckets,
					});
				}
			}

			// 2. Credits & Monthly Spending
			const credits = creditsData?.credits;
			const totalSpend = typeof usageData?.totalCost === "number" ? usageData.totalCost : 0;
			if (credits && typeof credits.monthlyCredits === "number") {
				const monthly = Math.max(0, credits.monthlyCredits);
				const totalBase = monthly + totalSpend;
				const fraction = totalBase > 0 ? Math.max(0, Math.min(1, monthly / totalBase)) : 1.0;

				groups.push({
					groupName: "billing-credits",
					displayName: "Monthly Balance",
					description: "Available credits for current billing period",
					buckets: [
						{
							bucketId: "commandcode-balance",
							displayName: "Credit Balance",
							window: "Monthly",
							remainingFraction: fraction,
							description: `$${monthly.toFixed(2)} available ($${totalSpend.toFixed(2)} spent)`,
						},
					],
				});
			}

			const account: AccountQuota = {
				email,
				projectId: userName || "commandcode",
				provider: this.name,
				status: overallStatus,
				groups,
			};

			const result: ProviderQuotaResult = {
				provider: this.name,
				displayName: this.displayName,
				icon: "commandcode",
				accounts: [account],
				updatedAt: now,
			};

			this.cachedResult = result;
			this.lastFetchTime = now;
			return result;
		} catch (err: any) {
			const errorAccount: AccountQuota = {
				email: "CommandCode Account",
				provider: this.name,
				status: "error",
				error: err?.message || "Failed to query CommandCode Quota API",
				groups: [],
			};

			return {
				provider: this.name,
				displayName: this.displayName,
				accounts: [errorAccount],
				updatedAt: now,
			};
		}
	}
}
