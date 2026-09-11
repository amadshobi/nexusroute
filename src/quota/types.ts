/**
 * Pluggable Quota Provider Types
 */

export interface QuotaBucket {
	bucketId: string;
	displayName: string;
	window: string;
	remainingFraction: number; // 0..1 (e.g. 0.95 = 95% remaining)
	resetTime?: string; // ISO 8601 timestamp
	description?: string;
}

export interface QuotaGroup {
	groupName: string;
	displayName: string;
	description?: string;
	buckets: QuotaBucket[];
}

export interface AccountQuota {
	email: string;
	projectId?: string;
	provider: string;
	status: "ok" | "warning" | "critical" | "error";
	error?: string;
	groups: QuotaGroup[];
}

export interface ProviderQuotaResult {
	provider: string;
	displayName: string;
	icon?: string;
	accounts: AccountQuota[];
	updatedAt: number;
}

/**
 * Interface standard untuk plugin provider quota manapun
 */
export interface IQuotaProvider {
	readonly name: string;
	readonly displayName: string;
	isAvailable(): boolean | Promise<boolean>;
	fetchQuotas(): Promise<ProviderQuotaResult>;
}
