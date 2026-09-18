import {
	ANSI_BOLD,
	ANSI_RESET,
	ANSI_GRAY,
	ANSI_CYAN,
	ANSI_YELLOW,
	ANSI_RED,
} from "./formatter";

/**
 * List subcommand aktif dan aliasnya untuk fuzzy matching.
 * Mencerminkan router datar NexusRoute (Milestone 2): aksi gateway
 * di-flatten ke top-level + alias namespaced yang tetap didukung.
 */
const ACTIVE_COMMANDS: Record<string, string> = {
	// Core gateway lifecycle (flattened)
	start: "start",
	stop: "stop",
	status: "status",
	stats: "stats",
	logs: "logs (alias: log)",
	log: "logs (alias: log)",
	cache: "cache",
	record: "record",
	mock: "mock",

	// Namespaced gateway aliases
	gateway: "gateway (alias: gw, g, shield)",
	gw: "gateway (alias: gw, g, shield)",
	g: "gateway (alias: gw, g, shield)",
	shield: "gateway (alias: gw, g, shield)",

	// Quota engine
	quota: "quota (alias: q, usage, u)",
	q: "quota (alias: q, usage, u)",
	usage: "quota (alias: q, usage, u)",
	u: "quota (alias: q, usage, u)",

	// Management
	doctor: "doctor (alias: doc)",
	doc: "doctor (alias: doc)",
	restart: "restart (alias: r)",
	r: "restart (alias: r)",

	// Meta
	help: "help (alias: h)",
	h: "help (alias: h)",
	version: "version (alias: v)",
	v: "version (alias: v)",
};

/**
 * Map of migrations for deprecated/merged commands.
 */
const DEPRECATED_MIGRATIONS: Record<string, string> = {
	ollama: `Command 'nexus ollama' has been merged into 'nexus quota'.\n  󰌵 Use: ${ANSI_CYAN}nexus quota${ANSI_RESET} (Live Quota Dashboard including Ollama Cloud).`,
	o: `Command 'nexus ollama' has been merged into 'nexus quota'.\n  󰌵 Use: ${ANSI_CYAN}nexus quota${ANSI_RESET} (Live Quota Dashboard including Ollama Cloud).`,
	ocm: `Tool 'ocm' has been merged into 'nexus config'.\n  󰌵 Use: ${ANSI_CYAN}nexus config get <target>${ANSI_RESET} or ${ANSI_CYAN}nexus config set <path> <val>${ANSI_RESET}.`,
	quarantine: `Command 'nexus quarantine' is deprecated.\n  󰌵 Run ${ANSI_CYAN}nexus help${ANSI_RESET} to view active subcommands.`,
	export: `Command 'nexus export' is deprecated.\n  󰌵 Run ${ANSI_CYAN}nexus help${ANSI_RESET} to view active subcommands.`,
};

/**
 * Hitung Levenshtein Distance antara 2 string.
 */
function levenshteinDistance(a: string, b: string): number {
	const matrix: number[][] = [];

	for (let i = 0; i <= b.length; i++) {
		matrix[i] = [i];
	}
	for (let j = 0; j <= a.length; j++) {
		matrix[0][j] = j;
	}

	for (let i = 1; i <= b.length; i++) {
		for (let j = 1; j <= a.length; j++) {
			if (b.charAt(i - 1) === a.charAt(j - 1)) {
				matrix[i][j] = matrix[i - 1][j - 1];
			} else {
				matrix[i][j] = Math.min(
					matrix[i - 1][j - 1] + 1, // substitution
					matrix[i][j - 1] + 1, // insertion
					matrix[i - 1][j] + 1, // deletion
				);
			}
		}
	}

	return matrix[b.length][a.length];
}

/**
 * Cari subcommand aktif terdekat dari string typo.
 */
function findClosestCommand(typo: string): string | null {
	const keys = Object.keys(ACTIVE_COMMANDS).filter((k) => k.length > 1);
	let minDistance = Infinity;
	let bestMatch: string | null = null;

	for (const key of keys) {
		const dist = levenshteinDistance(typo.toLowerCase(), key);
		if (dist < minDistance && dist <= 3) {
			minDistance = dist;
			bestMatch = ACTIVE_COMMANDS[key];
		}
	}

	return bestMatch;
}

/**
 * Handler utama untuk penanganan error subcommand typo / unknown / deprecated.
 */
export function handleUnknownCommand(cmd: string): void {
	const lowerCmd = cmd.toLowerCase();

	// 1. Check Migration Deprecation Map
	const migrationHint = DEPRECATED_MIGRATIONS[lowerCmd];
	if (migrationHint) {
		console.error("");
		console.error(`\x1b[1;33m󰀦 [Nexus Migration Hint]\x1b[0m ${migrationHint}`);
		console.error("");
		return;
	}

	// 2. Check Fuzzy Levenshtein Matcher
	const suggestion = findClosestCommand(lowerCmd);

	console.error("");
	console.error(
		`\x1b[1;31m󰅚 [Nexus Error]\x1b[0m Unknown subcommand: \x1b[1;37m"${cmd}"\x1b[0m`,
	);

	if (suggestion) {
		console.error(
			`\n  ${ANSI_YELLOW}󰋽 Did you mean: ${ANSI_BOLD}${ANSI_CYAN}${suggestion}${ANSI_RESET}${ANSI_YELLOW}?${ANSI_RESET}`,
		);
	}

	console.error(
		`  ${ANSI_GRAY}󰌵 Run ${ANSI_CYAN}nexus help${ANSI_GRAY} to view available subcommands.${ANSI_RESET}\n`,
	);
}
