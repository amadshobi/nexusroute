import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	IQuotaProvider,
	ProviderQuotaResult,
	AccountQuota,
	QuotaGroup,
	QuotaBucket,
} from "../types";

export interface AntigravityProviderOptions {
	dbPath?: string;
	cacheTtlMs?: number;
}

export class AntigravityQuotaProvider implements IQuotaProvider {
	public readonly name = "google-antigravity";
	public readonly displayName = "Antigravity";

	private dbPath: string;
	private cacheTtlMs: number;
	private cachedResult: ProviderQuotaResult | null = null;
	private lastFetchTime = 0;

	constructor(options: AntigravityProviderOptions = {}) {
		this.dbPath =
			options.dbPath || join(homedir(), ".omp", "agent", "agent.db");
		this.cacheTtlMs = options.cacheTtlMs ?? 20_000; // 20s cache to avoid Google 429
	}

	isAvailable(): boolean {
		return existsSync(this.dbPath);
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

		let rows: Array<{ data: string }> = [];
		try {
			const db = new Database(this.dbPath, { readonly: true });
			rows = db
				.query(
					"SELECT data FROM auth_credentials WHERE provider='google-antigravity'",
				)
				.all() as Array<{ data: string }>;
			db.close();
		} catch (err: any) {
			return {
				provider: this.name,
				displayName: this.displayName,
				accounts: [],
				updatedAt: now,
			};
		}

		const accounts: AccountQuota[] = [];

		for (const r of rows) {
			let cred: any;
			try {
				cred = JSON.parse(r.data);
			} catch {
				continue;
			}

			const email = cred.email || "Unknown Account";
			const projectId = cred.projectId || "aicode-consumers";
			const accessToken = cred.access;

			if (!accessToken) {
				accounts.push({
					email,
					projectId,
					provider: this.name,
					status: "error",
					error: "Missing access token",
					groups: [],
				});
				continue;
			}

			try {
				const res = await fetch(
					"https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${accessToken}`,
							"Content-Type": "application/json",
							"User-Agent":
								"antigravity/hub/1.0.0 (aidev_client; os_type=linux; arch=x86_64)",
						},
						body: JSON.stringify({ project: projectId }),
					},
				);

				if (!res.ok) {
					accounts.push({
						email,
						projectId,
						provider: this.name,
						status: "error",
						error: `API returned HTTP ${res.status}`,
						groups: [],
					});
					continue;
				}

				const data: any = await res.json();
				const groups: QuotaGroup[] = [];
				let minRemaining = 1.0;

				for (const g of data.groups || []) {
					const buckets: QuotaBucket[] = [];
					for (const b of g.buckets || []) {
						const remainingFraction =
							typeof b.remainingFraction === "number" ? b.remainingFraction : 0;
						if (remainingFraction < minRemaining) {
							minRemaining = remainingFraction;
						}
						buckets.push({
							bucketId: b.bucketId || b.displayName || "unknown",
							displayName: b.displayName || "Quota",
							window: b.window || "daily",
							remainingFraction,
							resetTime: b.resetTime,
							description: b.description,
						});
					}

					groups.push({
						groupName: (g.displayName || "").toLowerCase(),
						displayName: g.displayName || "Models",
						description: g.description,
						buckets,
					});
				}

				const status: "ok" | "warning" | "critical" =
					minRemaining <= 0.2
						? "critical"
						: minRemaining <= 0.5
							? "warning"
							: "ok";

				accounts.push({
					email,
					projectId,
					provider: this.name,
					status,
					groups,
				});
			} catch (err: any) {
				accounts.push({
					email,
					projectId,
					provider: this.name,
					status: "error",
					error: err.message || "Failed to fetch quota",
					groups: [],
				});
			}
		}

		const result: ProviderQuotaResult = {
			provider: this.name,
			displayName: this.displayName,
			icon: "antigravity",
			accounts,
			updatedAt: now,
		};

		this.cachedResult = result;
		this.lastFetchTime = now;
		return result;
	}
}
