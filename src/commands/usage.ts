#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// Goblin Nexus — Command: `gn usage` / `gn u`
//
// Plan 2 Layout:
// 1. Default (no flag): Quota Dashboard (3-tier layout + thin bars)
// 2. `gn u -t` / `gn u --tokens`: Daily Tokens & Subagent Tree Activity
// 3. `gn u -f` / `gn u --files`: File Modification Audit Mode
//    - `--mini` / `-m`: Compact Minimalist Table mode
//    - `-s <title_or_id>`: Filter specific session ID or title
//    - `--agent <name>`: Filter subagent by name
// ─────────────────────────────────────────────────────────────

import { stderr, exit } from "node:process";
import path from "node:path";
import type { QuotaEntry } from "../types";
import { OmpQuotaAdapter } from "../adapters/omp-quota";
import {
	formatProviderBadge,
	formatProgressBar,
	formatResetCountdown,
	ANSI_BOLD,
	ANSI_RESET,
	ANSI_GRAY,
	ANSI_CYAN,
	ANSI_YELLOW,
	ANSI_GREEN,
	ANSI_RED,
} from "../utils/formatter";
import {
	fetchAllSessionData,
	parseModelName,
	getStartOfTodayMs,
	type OpenCodeCliSessionRow,
	type OpenCodeCliToolUsageRow,
	type FileDiffStat,
} from "../utils/opencode-cli";

// ─── CLI Args ────────────────────────────────────────────────

interface UsageArgs {
	provider: string | null;
	json: boolean;
	help: boolean;
	tokens: boolean;
	filesOnly: boolean;
	sessions: boolean;
	days: number | null;
	all: boolean;
	mini: boolean;
	sessionFilter: string | null;
	agentFilter: string | null;
	passThroughArgs: string[];
}

function parseUsageArgs(argv: string[]): UsageArgs {
	const args: UsageArgs = {
		provider: null,
		json: false,
		help: false,
		tokens: false,
		filesOnly: false,
		sessions: false,
		days: null,
		all: false,
		mini: false,
		sessionFilter: null,
		agentFilter: null,
		passThroughArgs: [],
	};

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--json") {
			args.json = true;
		} else if (a === "-h" || a === "--help") {
			args.help = true;
		} else if (a === "-t" || a === "--tokens") {
			args.tokens = true;
		} else if (a === "-f" || a === "--files" || a === "--file") {
			args.filesOnly = true;
		} else if (a === "-m" || a === "--mini") {
			args.mini = true;
		} else if (a === "-a" || a === "--all" || a === "--all-time") {
			args.all = true;
		} else if (a.startsWith("--agent=")) {
			args.agentFilter = a.split("=")[1];
		} else if (a === "--agent" && argv[i + 1]) {
			args.agentFilter = argv[++i];
		} else if (
			a.startsWith("-s=") ||
			a.startsWith("--session=") ||
			a.startsWith("--sessions=")
		) {
			args.sessionFilter = a.split("=")[1];
		} else if (a === "-s" || a === "--session" || a === "--sessions") {
			if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
				args.sessionFilter = argv[++i];
			} else {
				args.sessions = true;
			}
		} else if (
			a.startsWith("-d=") ||
			a.startsWith("--day=") ||
			a.startsWith("--days=")
		) {
			const val = parseInt(a.split("=")[1], 10);
			if (!isNaN(val)) args.days = val;
		} else if ((a === "-d" || a === "--day" || a === "--days") && argv[i + 1]) {
			const val = parseInt(argv[++i], 10);
			if (!isNaN(val)) args.days = val;
		} else if (
			/^\d+$/.test(a) &&
			args.days === null &&
			(args.tokens || args.filesOnly)
		) {
			args.days = parseInt(a, 10);
		} else {
			args.passThroughArgs.push(a);
			if (!a.startsWith("-")) {
				args.provider = args.provider ?? a;
			}
		}
	}
	return args;
}

// ─── Number & Cost Formatters ────────────────────────────────

function formatTokenCount(num: number): string {
	if (num >= 1_000_000) {
		return `${(num / 1_000_000).toFixed(2)}M`;
	}
	if (num >= 1_000) {
		return `${(num / 1_000).toFixed(1)}k`;
	}
	return String(num);
}

function formatCostUsd(cost: number): string {
	return `$ ${cost.toFixed(2)}`;
}

function formatRelativePath(filePath: string, cwd: string): string {
	if (filePath.startsWith(cwd)) {
		const rel = path.relative(cwd, filePath);
		return rel.startsWith("./") ? rel : `./${rel}`;
	}
	return filePath;
}

// ─── Help (Level 2) ──────────────────────────────────────────

function printUsageHelp(): void {
	const lines = [
		"",
		"GN USAGE — Quota & Tokens Activity Engine",
		"════════════════════════════════════════════════════════════",
		"",
		"PENGGUNAAN:",
		"  gn usage [flags]",
		"  gn u     [flags]",
		"",
		"MODE 1: QUOTA DASHBOARD (Default)",
		"  gn usage [provider]",
		"",
		"MODE 2: DAILY TOKENS & SUBAGENT TREE (--tokens / -t)",
		"  gn usage --tokens [flags]",
		"  Flags:",
		"    -t, --tokens          Tampilkan pohon sesi & subagent activity",
		"    -f, --files           Audit khusus file yang di-edit/ditulis (File Audit Mode)",
		"    -m, --mini            Mode Tabel Ringkas (Compact Table)",
		"    -s, --session <id/kw> Filter berdasarkan Session ID atau Judul",
		"    --agent <name>        Filter berdasarkan nama subagent",
		"    -d, --days N          Window hari (default: hari ini)",
		"    -a, --all             Tampilkan seluruh riwayat historis",
		"    --json                Output JSON mentah",
		"",
		"CONTOH:",
		"  gn usage                       # Live quota status",
		"  gn u -t                        # Activity & Subagent tree hari ini",
		"  gn u -f                        # Audit khusus file yang di-edit hari ini",
		"  gn u -t -m                     # Mode tabel ringkas (compact table)",
		"  gn u -t -s ses_01be1381        # Filter spesifik ID sesi",
		'  gn u -f -s "OCM"               # Filter file modified khusus sesi "OCM"',
		"",
	];
	console.log(lines.join("\n"));
}

// ─── Handler ─────────────────────────────────────────────────

export async function handleUsageCommand(argv: string[]): Promise<number> {
	const args = parseUsageArgs(argv);

	if (args.help) {
		printUsageHelp();
		return 0;
	}

	if (args.sessions && !args.tokens && !args.filesOnly && !args.sessionFilter) {
		console.log(
			`\n${ANSI_YELLOW}💡 Hint: 'gn usage --sessions' telah disederhanakan.${ANSI_RESET}`,
		);
		console.log(
			`   Gunakan ${ANSI_CYAN}gn u -t${ANSI_RESET} untuk melihat Daily Subagent Tree & Activity.`,
		);
		console.log(
			`   Gunakan ${ANSI_CYAN}gn u -f${ANSI_RESET} untuk audit khusus File Modified.`,
		);
		console.log(
			`   Gunakan ${ANSI_CYAN}gn sessions list${ANSI_RESET} untuk mencari riwayat sesi.\n`,
		);
		return 0;
	}

	// Mode 3: File Modification Audit Mode (-f / --files)
	if (args.filesOnly) {
		return renderFilesAuditDashboard(args);
	}

	// Mode 2: Daily Tokens & Subagent Tree Activity (-t / --tokens)
	if (args.tokens || args.sessionFilter || args.mini) {
		return renderTokensDashboard(args);
	}

	// ── Mode 1: Quota Dashboard — Wrap official `omp usage` if available ──
	const ompPath = Bun.which("omp");
	if (ompPath) {
		const ompArgs = [
			"usage",
			...argv.filter((a) => a !== "u" && a !== "usage"),
		];
		const proc = Bun.spawnSync([ompPath, ...ompArgs], {
			stdio: ["inherit", "inherit", "inherit"],
		});
		return proc.exitCode;
	}

	// ── Fallback: Internal SQLite Adapter ────────────────────
	const adapter = new OmpQuotaAdapter();

	if (args.json) {
		try {
			const entries = await adapter.fetchData(
				args.provider ? { provider: args.provider } : undefined,
			);
			console.log(JSON.stringify(entries, null, 2));
			return 0;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			stderr.write(`❌ gn usage --json gagal: ${msg}\n`);
			return 1;
		}
	}

	// ── Default Quota Dashboard ──────────────────────────────
	const now = new Date();
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	const ss = String(now.getSeconds()).padStart(2, "0");

	console.log(
		`\n  ${ANSI_BOLD}󰓅 QUOTA DASHBOARD${ANSI_RESET} ${ANSI_GRAY}(Updated ${hh}:${mm}:${ss})${ANSI_RESET}\n`,
	);

	if (!adapter.isAvailable()) {
		console.log(`\n${ANSI_GRAY}󰀦 agent.db tidak ditemukan.${ANSI_RESET}`);
		return 1;
	}

	let entries: QuotaEntry[];
	try {
		entries = await adapter.fetchData(
			args.provider ? { provider: args.provider } : undefined,
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		stderr.write(`󰅚 Gagal fetch quota: ${msg}\n`);
		return 1;
	}

	if (entries.length === 0) {
		console.log(
			`\n${ANSI_GRAY}󰋽 Tidak ada data quota ditemukan.${ANSI_RESET}\n`,
		);
		return 0;
	}

	const grouped = groupByProvider(entries);
	const providerKeys = Object.keys(grouped).sort();

	console.log(
		`${ANSI_BOLD}  LIMIT                         USAGE    BAR           RESET${ANSI_RESET}`,
	);
	console.log(`${ANSI_GRAY}  ${"─".repeat(60)}${ANSI_RESET}`);

	for (const provider of providerKeys) {
		renderProviderGroup(provider, grouped[provider]);
	}
	console.log();

	return 0;
}

// ─── Mode 3: File Modification Audit Mode (`gn u -f`) ───────────

function renderFilesAuditDashboard(args: UsageArgs): number {
	const cwd = process.cwd();
	let cutoffTs = getStartOfTodayMs();
	let timeframeLabel = "HARI INI";

	if (args.all) {
		cutoffTs = 0;
		timeframeLabel = "SEMUA RIWAYAT";
	} else if (args.days && args.days > 0) {
		cutoffTs = Date.now() - args.days * 24 * 60 * 60 * 1000;
		timeframeLabel = `${args.days} HARI TERAKHIR`;
	}

	if (args.sessionFilter) {
		timeframeLabel = `FILTER: "${args.sessionFilter}" (${timeframeLabel})`;
	}

	const { rootSessions, subagentsByParent, diffsBySession } =
		fetchAllSessionData(cutoffTs, args.sessionFilter);

	// Filter hanya root session yang punya diffs ATAU child-nya punya diffs!
	const activeRoots = rootSessions.filter((root) => {
		const rootDiffs = diffsBySession.get(root.id) ?? [];
		if (rootDiffs.length > 0) return true;
		const subs = subagentsByParent.get(root.id) ?? [];
		return subs.some((sub) => (diffsBySession.get(sub.id) ?? []).length > 0);
	});

	if (activeRoots.length === 0) {
		console.log(
			`\n  ${ANSI_BOLD}󰓅 FILE MODIFICATION AUDIT${ANSI_RESET} ${ANSI_GRAY}(${timeframeLabel})${ANSI_RESET}`,
		);
		console.log(
			`\n  ${ANSI_GRAY}󰋽 Tidak ada rekaman file modified ditemukan untuk ${timeframeLabel.toLowerCase()}.${ANSI_RESET}\n`,
		);
		return 0;
	}

	console.log(
		`\n  ${ANSI_BOLD}󰓅 FILE MODIFICATION AUDIT${ANSI_RESET} ${ANSI_GRAY}(${timeframeLabel})${ANSI_RESET}\n`,
	);

	let totalModifiedFiles = 0;
	let totalSessionsWithFiles = 0;

	for (const root of activeRoots) {
		const rootModel = parseModelName(root.model);
		const rootDiffs = diffsBySession.get(root.id) ?? [];
		const rootSubagents = (subagentsByParent.get(root.id) ?? []).filter(
			(sub) => {
				if (
					args.agentFilter &&
					!sub.agent?.toLowerCase().includes(args.agentFilter.toLowerCase())
				) {
					return false;
				}
				return (diffsBySession.get(sub.id) ?? []).length > 0;
			},
		);

		if (rootDiffs.length === 0 && rootSubagents.length === 0) continue;
		totalSessionsWithFiles++;

		console.log(
			`  󰘚 ${ANSI_BOLD}${root.title}${ANSI_RESET} ${ANSI_CYAN}[${rootModel}]${ANSI_RESET}`,
		);

		if (rootDiffs.length > 0) {
			totalModifiedFiles += rootDiffs.length;
			for (const stat of rootDiffs) {
				const relPath = formatRelativePath(stat.filePath, cwd);
				const addStr =
					stat.additions > 0
						? `${ANSI_GREEN}+${stat.additions}${ANSI_RESET}`
						: "";
				const delStr =
					stat.deletions > 0
						? `${ANSI_RED}-${stat.deletions}${ANSI_RESET}`
						: "";
				const diffStr = [addStr, delStr].filter(Boolean).join(" ");
				const formattedDiff = diffStr ? ` (${diffStr})` : "";
				console.log(
					`     - ${ANSI_GRAY}${relPath}${ANSI_RESET}${formattedDiff}`,
				);
			}
		}

		for (let i = 0; i < rootSubagents.length; i++) {
			const sub = rootSubagents[i];
			const subAgentName = sub.agent || "subagent";
			const subModel = parseModelName(sub.model);
			const subDiffs = diffsBySession.get(sub.id) ?? [];
			if (subDiffs.length === 0) continue;

			totalModifiedFiles += subDiffs.length;

			console.log(
				`     └── 󰘚 ${ANSI_BOLD}${subAgentName}${ANSI_RESET} (${sub.title}) ${ANSI_CYAN}[${subModel}]${ANSI_RESET}`,
			);
			for (const stat of subDiffs) {
				const relPath = formatRelativePath(stat.filePath, cwd);
				const addStr =
					stat.additions > 0
						? `${ANSI_GREEN}+${stat.additions}${ANSI_RESET}`
						: "";
				const delStr =
					stat.deletions > 0
						? `${ANSI_RED}-${stat.deletions}${ANSI_RESET}`
						: "";
				const diffStr = [addStr, delStr].filter(Boolean).join(" ");
				const formattedDiff = diffStr ? ` (${diffStr})` : "";
				console.log(
					`           - ${ANSI_GRAY}${relPath}${ANSI_RESET}${formattedDiff}`,
				);
			}
		}
		console.log();
	}

	console.log(`${ANSI_GRAY}  ${"─".repeat(70)}${ANSI_RESET}`);
	console.log(
		`  ${ANSI_BOLD}󰓅 TOTAL:${ANSI_RESET} ${ANSI_GREEN}${totalSessionsWithFiles} Sesi${ANSI_RESET} · ${ANSI_YELLOW}${totalModifiedFiles} File(s) Modified${ANSI_RESET}\n`,
	);

	return 0;
}

// ─── Plan 2 Renderer: Tokens & Subagent Tree Activity ─────────

function renderTokensDashboard(args: UsageArgs): number {
	const cwd = process.cwd();
	let cutoffTs = getStartOfTodayMs();
	let timeframeLabel = "HARI INI";

	if (args.all) {
		cutoffTs = 0;
		timeframeLabel = "SEMUA RIWAYAT";
	} else if (args.days && args.days > 0) {
		cutoffTs = Date.now() - args.days * 24 * 60 * 60 * 1000;
		timeframeLabel = `${args.days} HARI TERAKHIR`;
	}

	if (args.sessionFilter) {
		timeframeLabel = `FILTER: "${args.sessionFilter}" (${timeframeLabel})`;
	}

	// Super fast batch query via bun:sqlite!
	const { rootSessions, subagentsByParent, toolsBySession, diffsBySession } =
		fetchAllSessionData(cutoffTs, args.sessionFilter);

	if (rootSessions.length === 0) {
		console.log(
			`\n  ${ANSI_BOLD}󰓅 TOKENS & SUBAGENT TREE ACTIVITY${ANSI_RESET} ${ANSI_GRAY}(${timeframeLabel})${ANSI_RESET}`,
		);
		console.log(
			`\n  ${ANSI_GRAY}󰋽 Tidak ada aktivitas sesi ditemukan untuk ${timeframeLabel.toLowerCase()}.${ANSI_RESET}\n`,
		);
		return 0;
	}

	if (args.json) {
		const payload = rootSessions.map((root) => ({
			...root,
			modelName: parseModelName(root.model),
			tools: toolsBySession.get(root.id) ?? [],
			fileDiffStats: diffsBySession.get(root.id) ?? [],
			subagents: (subagentsByParent.get(root.id) ?? []).map((sub) => ({
				...sub,
				modelName: parseModelName(sub.model),
				tools: toolsBySession.get(sub.id) ?? [],
				fileDiffStats: diffsBySession.get(sub.id) ?? [],
			})),
		}));
		console.log(JSON.stringify(payload, null, 2));
		return 0;
	}

	// Render Mode 2: Compact Minimalist Table (`--mini` / `-m`)
	if (args.mini) {
		return renderCompactTable(
			rootSessions,
			subagentsByParent,
			toolsBySession,
			diffsBySession,
			timeframeLabel,
		);
	}

	// Render Mode 1: Tree Detail (Default)
	console.log(
		`\n  ${ANSI_BOLD}󰓅 TOKENS & SUBAGENT TREE ACTIVITY${ANSI_RESET} ${ANSI_GRAY}(${timeframeLabel})${ANSI_RESET}\n`,
	);

	let grandTotalTokens = 0;
	let grandTotalCost = 0;

	for (const root of rootSessions) {
		const rootModel = parseModelName(root.model);
		const rootTools = toolsBySession.get(root.id) ?? [];
		const rootSubagents = subagentsByParent.get(root.id) ?? [];

		const rootTotalTokens = root.tokens_input + root.tokens_output;
		grandTotalTokens += rootTotalTokens;
		grandTotalCost += root.cost;

		console.log(
			`  󰘚 ${ANSI_BOLD}${root.title}${ANSI_RESET} ${ANSI_CYAN}[${rootModel}]${ANSI_RESET}`,
		);

		const toolSummaryStr =
			rootTools.length > 0
				? rootTools.map((t) => `${t.tool}: ${t.count}`).join(", ")
				: "none";

		const hasChildren = rootSubagents.length > 0;
		const branchPrefix = hasChildren ? "│" : " ";

		console.log(`     ├── ${ANSI_BOLD}Tokens Metrics:${ANSI_RESET}`);
		console.log(
			`     │     Input       : ${formatTokenCount(root.tokens_input)}`,
		);
		console.log(
			`     │     Output      : ${formatTokenCount(root.tokens_output)}`,
		);
		if (root.tokens_cache_read > 0) {
			console.log(
				`     │     Cache Read  : ${formatTokenCount(root.tokens_cache_read)}`,
			);
		}
		if (root.tokens_cache_write > 0) {
			console.log(
				`     │     Cache Write : ${formatTokenCount(root.tokens_cache_write)}`,
			);
		}
		if (root.tokens_reasoning > 0) {
			console.log(
				`     │     Reasoning   : ${formatTokenCount(root.tokens_reasoning)}`,
			);
		}
		console.log(`     │     Cost        : ${formatCostUsd(root.cost)}`);
		console.log(
			`     │     Tool Calls  : ${rootTools.reduce((acc, t) => acc + t.count, 0)}x (${toolSummaryStr})`,
		);

		const rootFileStats = diffsBySession.get(root.id) ?? [];
		if (rootFileStats.length > 0) {
			const diffTreePrefix = hasChildren ? "│  " : "   ";
			console.log(
				`     ${hasChildren ? "├──" : "└──"} Files Modified (Relatif):`,
			);
			for (const stat of rootFileStats) {
				const relPath = formatRelativePath(stat.filePath, cwd);
				const addStr =
					stat.additions > 0
						? `${ANSI_GREEN}+${stat.additions}${ANSI_RESET}`
						: "";
				const delStr =
					stat.deletions > 0
						? `${ANSI_RED}-${stat.deletions}${ANSI_RESET}`
						: "";
				const diffStr = [addStr, delStr].filter(Boolean).join(" ");
				const formattedDiff = diffStr ? ` (${diffStr})` : "";
				console.log(
					`     ${diffTreePrefix}   - ${ANSI_GRAY}${relPath}${ANSI_RESET}${formattedDiff}`,
				);
			}
		}

		console.log(`     ${branchPrefix}`);

		for (let i = 0; i < rootSubagents.length; i++) {
			const sub = rootSubagents[i];
			const isLastSub = i === rootSubagents.length - 1;
			const subPrefix = isLastSub ? "└──" : "├──";
			const subChildPrefix = isLastSub ? "   " : "│  ";

			const subAgentName = sub.agent || "subagent";
			const subModel = parseModelName(sub.model);
			const subTools = toolsBySession.get(sub.id) ?? [];
			const subFileStats = diffsBySession.get(sub.id) ?? [];

			grandTotalTokens += sub.tokens_input + sub.tokens_output;
			grandTotalCost += sub.cost;

			const subToolSummaryStr =
				subTools.length > 0
					? subTools.map((t) => `${t.tool}: ${t.count}`).join(", ")
					: "none";

			console.log(
				`     ${subPrefix} 󰘚 ${ANSI_BOLD}${subAgentName}${ANSI_RESET} (${sub.title}) ${ANSI_CYAN}[${subModel}]${ANSI_RESET}`,
			);
			console.log(`     ${subChildPrefix}   ├── Tokens Metrics:`);
			console.log(
				`     ${subChildPrefix}   │     Input       : ${formatTokenCount(sub.tokens_input)}`,
			);
			console.log(
				`     ${subChildPrefix}   │     Output      : ${formatTokenCount(sub.tokens_output)}`,
			);
			if (sub.tokens_cache_read > 0) {
				console.log(
					`     ${subChildPrefix}   │     Cache Read  : ${formatTokenCount(sub.tokens_cache_read)}`,
				);
			}
			if (sub.tokens_reasoning > 0) {
				console.log(
					`     ${subChildPrefix}   │     Reasoning   : ${formatTokenCount(sub.tokens_reasoning)}`,
				);
			}
			console.log(
				`     ${subChildPrefix}   │     Cost        : ${formatCostUsd(sub.cost)}`,
			);
			console.log(
				`     ${subChildPrefix}   │     Tool Calls  : ${subTools.reduce((acc, t) => acc + t.count, 0)}x (${subToolSummaryStr})`,
			);

			if (subFileStats.length > 0) {
				console.log(`     ${subChildPrefix}   └── Files Modified (Relatif):`);
				for (const stat of subFileStats) {
					const relPath = formatRelativePath(stat.filePath, cwd);
					const addStr =
						stat.additions > 0
							? `${ANSI_GREEN}+${stat.additions}${ANSI_RESET}`
							: "";
					const delStr =
						stat.deletions > 0
							? `${ANSI_RED}-${stat.deletions}${ANSI_RESET}`
							: "";
					const diffStr = [addStr, delStr].filter(Boolean).join(" ");
					const formattedDiff = diffStr ? ` (${diffStr})` : "";
					console.log(
						`     ${subChildPrefix}         - ${ANSI_GRAY}${relPath}${ANSI_RESET}${formattedDiff}`,
					);
				}
			}
			console.log(`     ${subChildPrefix}`);
		}
		console.log();
	}

	console.log(`${ANSI_GRAY}  ${"─".repeat(70)}${ANSI_RESET}`);
	console.log(
		`  ${ANSI_BOLD}󰓅 TOTAL SUMMARY:${ANSI_RESET} ${ANSI_GREEN}${formatTokenCount(grandTotalTokens)} Tokens${ANSI_RESET} · ${ANSI_YELLOW}${formatCostUsd(grandTotalCost)}${ANSI_RESET}\n`,
	);

	return 0;
}

// ─── Compact Table Renderer (`--mini` / `-m`) ────────────────

function renderCompactTable(
	rootSessions: OpenCodeCliSessionRow[],
	subagentsByParent: Map<string, OpenCodeCliSessionRow[]>,
	toolsBySession: Map<string, OpenCodeCliToolUsageRow[]>,
	diffsBySession: Map<string, FileDiffStat[]>,
	timeframeLabel: string,
): number {
	console.log(
		`\n  ${ANSI_BOLD}󰓅 DAILY TOKENS ACTIVITY (COMPACT TABLE)${ANSI_RESET} ${ANSI_GRAY}(${timeframeLabel})${ANSI_RESET}\n`,
	);

	console.log(
		`  ${ANSI_BOLD}${"SESSION / SUBAGENT".padEnd(30)}  ${"MODEL".padEnd(18)}  ${"TOKENS (IN/OUT/CACHE)".padEnd(24)}  ${"TOOLS".padEnd(7)}  ${"FILES".padEnd(6)}  ${"COST".padEnd(8)}${ANSI_RESET}`,
	);
	console.log(`  ${ANSI_GRAY}${"─".repeat(98)}${ANSI_RESET}`);

	let grandTotalTokens = 0;
	let grandTotalCost = 0;

	for (const root of rootSessions) {
		const rootModel = parseModelName(root.model);
		const rootTools = toolsBySession.get(root.id) ?? [];
		const rootSubagents = subagentsByParent.get(root.id) ?? [];

		const rootTokens = root.tokens_input + root.tokens_output;
		grandTotalTokens += rootTokens;
		grandTotalCost += root.cost;

		const rootTitle =
			root.title.length > 28
				? root.title.slice(0, 25) + "..."
				: root.title.padEnd(28);
		const modelStr =
			rootModel.length > 16
				? rootModel.slice(0, 13) + "..."
				: rootModel.padEnd(16);
		const tokenStr = `${formatTokenCount(root.tokens_input)} / ${formatTokenCount(root.tokens_output)} / ${formatTokenCount(root.tokens_cache_read)}`;
		const toolCount = rootTools.reduce((acc, t) => acc + t.count, 0);

		const rootFileStats = diffsBySession.get(root.id) ?? [];
		const rootFileStr =
			rootFileStats.length > 0 ? `${rootFileStats.length} files` : "-";

		console.log(
			`  󰘚 ${ANSI_BOLD}${rootTitle}${ANSI_RESET}  ${ANSI_CYAN}${modelStr}${ANSI_RESET}  ${tokenStr.padEnd(24)}  ${(toolCount + "x").padEnd(7)}  ${rootFileStr.padEnd(6)}  ${ANSI_GRAY}${formatCostUsd(root.cost)}${ANSI_RESET}`,
		);

		for (let i = 0; i < rootSubagents.length; i++) {
			const sub = rootSubagents[i];
			const isLast = i === rootSubagents.length - 1;
			const prefix = isLast ? "└── " : "├── ";

			const subAgentName = sub.agent || "subagent";
			const subModel = parseModelName(sub.model);
			const subTools = toolsBySession.get(sub.id) ?? [];
			const subFileStats = diffsBySession.get(sub.id) ?? [];

			grandTotalTokens += sub.tokens_input + sub.tokens_output;
			grandTotalCost += sub.cost;

			const subLabel = `${prefix}󰘚 ${subAgentName}`;
			const subLabelPadded =
				subLabel.length > 28
					? subLabel.slice(0, 25) + "..."
					: subLabel.padEnd(28);
			const subModelStr =
				subModel.length > 16
					? subModel.slice(0, 13) + "..."
					: subModel.padEnd(16);
			const subTokenStr = `${formatTokenCount(sub.tokens_input)} / ${formatTokenCount(sub.tokens_output)} / ${formatTokenCount(sub.tokens_cache_read)}`;
			const subToolCount = subTools.reduce((acc, t) => acc + t.count, 0);

			console.log(
				`  ${ANSI_GRAY}${subLabelPadded}${ANSI_RESET}  ${ANSI_CYAN}${subModelStr}${ANSI_RESET}  ${subTokenStr.padEnd(24)}  ${(subToolCount + "x").padEnd(7)}  ${(subFileStats.length > 0 ? subFileStats.length + " files" : "-").padEnd(6)}  ${ANSI_GRAY}${formatCostUsd(sub.cost)}${ANSI_RESET}`,
			);
		}
	}

	console.log(`  ${ANSI_GRAY}${"─".repeat(98)}${ANSI_RESET}`);
	console.log(
		`  ${ANSI_BOLD}󰓅 TOTAL SUMMARY:${ANSI_RESET} ${ANSI_GREEN}${formatTokenCount(grandTotalTokens)} Tokens${ANSI_RESET} · ${ANSI_YELLOW}${formatCostUsd(grandTotalCost)}${ANSI_RESET}\n`,
	);

	return 0;
}

// ─── Render Quota helpers ────────────────────────────────────

function groupByProvider(entries: QuotaEntry[]): Record<string, QuotaEntry[]> {
	const out: Record<string, QuotaEntry[]> = {};
	for (const e of entries) {
		const key = e.provider || "unknown";
		if (!out[key]) out[key] = [];
		out[key].push(e);
	}
	return out;
}

function groupByEmail(entries: QuotaEntry[]): Record<string, QuotaEntry[]> {
	const out: Record<string, QuotaEntry[]> = {};
	for (const e of entries) {
		const key = e.email || "unknown";
		if (!out[key]) out[key] = [];
		out[key].push(e);
	}
	return out;
}

function renderProviderGroup(provider: string, entries: QuotaEntry[]): void {
	const badge = formatProviderBadge(provider);
	console.log(`\n  ${badge} ${ANSI_BOLD}${provider}${ANSI_RESET}`);

	const byEmail = groupByEmail(entries);
	const emails = Object.keys(byEmail).sort();

	for (const email of emails) {
		console.log(`    ${ANSI_CYAN}${email}${ANSI_RESET}`);
		const emailEntries = byEmail[email].sort(
			(a, b) => b.usedFraction - a.usedFraction,
		);
		for (const e of emailEntries) {
			renderQuotaRow(e);
		}
	}
}

function renderQuotaRow(e: QuotaEntry): void {
	const bar = formatProgressBar(e.usedFraction, 12);
	const pctNum = Math.round(e.usedFraction * 100);
	const pctStr = `${pctNum}%`;

	let pctColor = ANSI_GREEN;
	if (pctNum >= 100) pctColor = ANSI_RED;
	else if (pctNum >= 70) pctColor = ANSI_YELLOW;

	const formattedPct = `${pctColor}${pctStr.padStart(4)}${ANSI_RESET}`;
	const reset = e.resetsAt
		? formatResetCountdown(e.resetsAt)
		: `${ANSI_GRAY}-${ANSI_RESET}`;

	let labelRaw = e.label || e.windowLabel || "";
	if (labelRaw.includes("Google")) labelRaw = "Google";
	else if (labelRaw.includes("Anthropic")) labelRaw = "Anthropic";
	else if (labelRaw.includes("OpenAI")) labelRaw = "OpenAI";
	const label =
		labelRaw.length > 24 ? labelRaw.slice(0, 21) + "..." : labelRaw.padEnd(24);
	console.log(
		`      ${ANSI_GRAY}${label}${ANSI_RESET}  ${formattedPct}  ${bar}  ${reset}`,
	);
}

const isMainModule = (() => {
	const arg1 = process.argv[1];
	if (!arg1) return false;
	try {
		const selfPath = new URL(import.meta.url).pathname;
		return selfPath === arg1 || arg1.endsWith("usage.ts");
	} catch {
		return arg1.endsWith("usage.ts");
	}
})();
if (isMainModule) {
	handleUsageCommand(process.argv.slice(2))
		.then((code) => exit(code))
		.catch((err) => {
			const msg = err instanceof Error ? err.message : String(err);
			stderr.write(`󰅚 gn usage crash: ${msg}\n`);
			exit(1);
		});
}
