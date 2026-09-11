import type { IQuotaProvider, ProviderQuotaResult } from "./types";
import { AntigravityQuotaProvider } from "./providers/antigravity";

export class QuotaRegistry {
	private providers: Map<string, IQuotaProvider> = new Map();

	register(provider: IQuotaProvider): void {
		this.providers.set(provider.name, provider);
	}

	get(name: string): IQuotaProvider | undefined {
		return this.providers.get(name);
	}

	list(): IQuotaProvider[] {
		return Array.from(this.providers.values());
	}

	async fetchAll(): Promise<ProviderQuotaResult[]> {
		const results: ProviderQuotaResult[] = [];
		const activeProviders = this.list();

		const settled = await Promise.allSettled(
			activeProviders.map(async (p) => {
				if (await Promise.resolve(p.isAvailable())) {
					return p.fetchQuotas();
				}
				return null;
			}),
		);

		for (const s of settled) {
			if (s.status === "fulfilled" && s.value) {
				results.push(s.value);
			}
		}

		return results;
	}
}

// Global registry instance
export const defaultQuotaRegistry = new QuotaRegistry();
defaultQuotaRegistry.register(new AntigravityQuotaProvider());
