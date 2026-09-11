/**
 * ─────────────────────────────────────────────────────────────
 * NexusRoute — Command: `gn quota` / `gn usage`
 *
 * Real-time Multi-Account & Multi-Provider Quota Monitor.
 * Single Source of Truth powered by `src/quota/registry.ts`.
 * ─────────────────────────────────────────────────────────────
 */

import { defaultQuotaRegistry } from "../quota";
import type {
	ProviderQuotaResult,
	AccountQuota,
	QuotaGroup,
	QuotaBucket,
} from "../quota/types";
import {
	ANSI_BOLD,
	ANSI_RESET,
	ANSI_GRAY,
	ANSI_CYAN,
	ANSI_GREEN,
	ANSI_YELLOW,
	ANSI_RED,
	formatProgressBar,
	printGnHeader,
} from "../utils/formatter";

function formatRelativeTime(isoString?: string): string {
	if (!isoString) return "-";
	const target = new Date(isoString).getTime();
	const diffMs = target - Date.now();
	if (diffMs <= 0) return "ready";

	const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
	const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

	if (diffHours >= 24) {
		const days = Math.floor(diffHours / 24);
		const remHours = diffHours % 24;
		return `${days}d ${remHours}h`;
	}
	return `${diffHours}h ${diffMins}m`;
}

function showQuotaHelp(): void {
	printGnHeader("QUOTA ENGINE MANUAL");
	console.log("USAGE");
	console.log("  $ gn quota [flags]");
	console.log("  $ gn q [flags]");
	console.log("  $ gn usage [flags]");
	console.log("");
	console.log("FLAGS");
	console.log("  --json       Keluarkan snapshot data mentah format JSON");
	console.log("  -h, --help   Tampilkan panduan ini");
	console.log("");
	console.log("EXAMPLES");
	console.log("  $ gn quota         # Tampilkan kuota live seluruh provider");
	console.log(
		"  $ gn q --json      # Export JSON snapshot untuk tooling eksternal",
	);
	console.log("");
}

export async function handleQuotaCommand(argv: string[]): Promise<number> {
	if (argv.includes("-h") || argv.includes("--help") || argv.includes("help")) {
		showQuotaHelp();
		return 0;
	}

	const isJson = argv.includes("--json");
	const providers = await defaultQuotaRegistry.fetchAll();

	if (isJson) {
		console.log(
			JSON.stringify(
				{
					timestamp: Date.now(),
					providers,
				},
				null,
				2,
			),
		);
		return 0;
	}

	printGnHeader("MULTI-PROVIDER LIVE QUOTA");

	const hasAccounts = providers.some((p) => p.accounts.length > 0);
	if (providers.length === 0 || !hasAccounts) {
		console.log(
			`  ${ANSI_GRAY}Tidak ada data kuota provider yang aktif.${ANSI_RESET}\n`,
		);
		return 0;
	}

	for (const provider of providers) {
		console.log(
			`\n  ${ANSI_BOLD}${ANSI_CYAN}󰐌 ${provider.displayName.toUpperCase()}${ANSI_RESET} ${ANSI_GRAY}(${provider.provider})${ANSI_RESET}`,
		);

		if (provider.accounts.length === 0) {
			console.log(`    ${ANSI_GRAY}No accounts configured.${ANSI_RESET}`);
			continue;
		}

		for (const account of provider.accounts) {
			const statusColor =
				account.status === "ok"
					? ANSI_GREEN
					: account.status === "warning"
						? ANSI_YELLOW
						: ANSI_RED;

			console.log(
				`    ${ANSI_BOLD} ${account.email}${ANSI_RESET}  ${statusColor}[${account.status.toUpperCase()}]${ANSI_RESET}`,
			);

			if (account.error) {
				console.log(`      ${ANSI_RED}󰅚 Error: ${account.error}${ANSI_RESET}`);
				continue;
			}

			if (account.groups.length === 0) {
				console.log(
					`      ${ANSI_GRAY}No quota buckets returned.${ANSI_RESET}`,
				);
				continue;
			}

			for (const group of account.groups) {
				for (const bucket of group.buckets) {
					const remPct = Math.round(bucket.remainingFraction * 100);
					const usedFraction = Math.max(
						0,
						Math.min(1, 1 - bucket.remainingFraction),
					);
					const bar = formatProgressBar(usedFraction, 14);

					let pctColor = ANSI_GREEN;
					if (bucket.remainingFraction <= 0.2) pctColor = ANSI_RED;
					else if (bucket.remainingFraction <= 0.5) pctColor = ANSI_YELLOW;

					const label = `${group.displayName} (${bucket.displayName})`.padEnd(
						36,
					);
					const remStr = `${pctColor}${String(remPct).padStart(3)}% sisa${ANSI_RESET}`;
					const resetStr = `${ANSI_GRAY}reset in ${formatRelativeTime(bucket.resetTime)}${ANSI_RESET}`;

					console.log(
						`      ${ANSI_GRAY}󰄬${ANSI_RESET} ${label} ${bar} ${remStr}  ${resetStr}`,
					);
				}
			}
		}
	}

	console.log(
		`\n  ${ANSI_GRAY}Catatan: Kuota diperbarui secara real-time via Provider Adapter.${ANSI_RESET}\n`,
	);

	return 0;
}
