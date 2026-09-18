/**
 * ─────────────────────────────────────────────────────────────
 * NexusRoute — Master CLI Entry Point (nexus v2)
 * ─────────────────────────────────────────────────────────────
 *
 * Router TypeScript untuk seluruh subcommand `nexus`.
 * Shell launcher `nexus.sh` / `bin/nexus` meneruskan semua argv
 * ke file ini; kita dispatch ke handler sesuai subcommand pertama.
 *
 * Aturan desain:
 *   - Setiap handler menerima argv SETELAH subcommand (bukan termasuk).
 *     Mis. `nexus quota --json` → handleQuotaCommand(["--json"]).
 *   - Aksi gateway (start/stop/status/stats/logs/cache/record/mock)
 *     di-flatten ke top-level, namun alias namespaced lama
 *     (`gateway`, `gw`, `g`, `shield`) tetap didukung.
 *   - Help level-1 (banner + daftar command) ada di sini.
 *   - Help level-2 (panduan mendalam) ada di masing-masing handler.
 *   - Exit code: 0 sukses, 1 kesalahan umum, 2 deprecation.
 */

import { printGnHeader } from "./utils/formatter";
import { handleUnknownCommand } from "./utils/error";
import { GN_VERSION, NEXUS_VERSION } from "./version";
import { handleQuotaCommand } from "./commands/quota";
import { handleDoctorCommand, handleRestartCommand } from "./commands/doctor";
import { handleGatewayCommand } from "./commands/gateway";

/** Versi kanonik NexusRoute CLI. */
export { NEXUS_VERSION };
/** Alias versi lama untuk backward compatibility. */
export { GN_VERSION };

/**
 * Peta subcommand → handler.
 *
 * Aksi gateway di-flatten ke top-level agar `nexus start` setara
 * dengan `nexus gateway start`. Alias namespaced tetap dipertahankan.
 */
const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
	// ── Core gateway lifecycle (flattened) ────────────────────
	start: (argv) => handleGatewayCommand(["start", ...argv]),
	stop: (argv) => handleGatewayCommand(["stop", ...argv]),
	status: (argv) => handleGatewayCommand(["status", ...argv]),
	stats: (argv) => handleGatewayCommand(["stats", ...argv]),
	logs: (argv) => handleGatewayCommand(["logs", ...argv]),
	log: (argv) => handleGatewayCommand(["logs", ...argv]),
	cache: (argv) => handleGatewayCommand(["cache", ...argv]),
	record: (argv) => handleGatewayCommand(["record", ...argv]),
	mock: (argv) => handleGatewayCommand(["mock", ...argv]),

	// ── Backward-compatible namespaced aliases ────────────────
	gateway: handleGatewayCommand,
	gw: handleGatewayCommand,
	g: handleGatewayCommand,
	shield: handleGatewayCommand,

	// ── Quota & Multi-provider Engine (Single Source of Truth) ─
	quota: handleQuotaCommand,
	q: handleQuotaCommand,
	usage: handleQuotaCommand,
	u: handleQuotaCommand,

	// ── Service control ───────────────────────────────────────
	doctor: handleDoctorCommand,
	doc: handleDoctorCommand,
	restart: handleRestartCommand,
	r: handleRestartCommand,
};

/**
 * Subcommand lama yang sudah didepresiasi.
 * Pesan akan ditampilkan + exit code 2 (conventional untuk deprecated command).
 * Logika ini ada di sini (bukan di nexus.sh) supaya `bin/nexus` (yang
 * langsung exec ke router ini) tetap bisa menampilkan warning yang benar.
 */
const DEPRECATED_COMMANDS: Record<string, string> = {
	sessions: "OpenCode CLI langsung (`oc session`)",
	s: "OpenCode CLI langsung (`oc session`)",
	ses: "OpenCode CLI langsung (`oc session`)",
	config: "Edit opencode.jsonc langsung via OpenCode config",
	c: "Edit opencode.jsonc langsung via OpenCode config",
	ping: "Web Console (http://localhost:4010/dashboard#ping) atau REST API probe",
	p: "Web Console (http://localhost:4010/dashboard#ping) atau REST API probe",
	bench: "Web Console probe latency / benchmark REST API",
	b: "Web Console probe latency / benchmark REST API",
};

/** Cetak banner ringkas untuk header bantuan/error. */
function printBanner(): void {
	printGnHeader("Powered by OMP Engine");
}

/**
 * Cetak pesan deprecation + sarankan penggantinya.
 * Dipisah sebagai fungsi murni agar mudah di-test tanpa side-effect exit.
 */
function reportDeprecated(cmd: string, replacement: string): void {
	printBanner();
	console.error(
		`\x1b[1;33m[warn] Command \x1b[0m\x1b[1;37m${cmd}\x1b[0m\x1b[1;33m is deprecated.\x1b[0m`,
	);
	console.error(
		`\x1b[0m   Use \x1b[1;36m${replacement}\x1b[0m\x1b[0m instead.\x1b[0m`,
	);
}

/** Print Level-1 help (banner + command overview). */
function showHelp(): void {
	printBanner();
	console.log("USAGE");
	console.log("  $ nexus <command> [flags]");
	console.log(
		"  $ nexus <command> --help               \x1b[1;33m󰋽 Comprehensive Level-2 help per command!\x1b[0m",
	);
	console.log("");
	console.log("CORE COMMANDS");
	console.log(
		"  start         \x1b[1;36m󰐌\x1b[0m Start hybrid gateway interceptor (4010 -> OMP + VansRouter)",
	);
	console.log(
		"  stop          \x1b[1;31m󰓛\x1b[0m Stop active gateway (systemd service / PID kill)",
	);
	console.log(
		"  status        \x1b[1;36m󰋼\x1b[0m Check active gateway instance status & latency",
	);
	console.log(
		"  stats         \x1b[1;36m󰓅\x1b[0m Performance metrics, cache hit rate, and error counters",
	);
	console.log(
		"  logs, log     \x1b[1;36m󰌱\x1b[0m Real-time traffic audit, cache status, & fallback history",
	);
	console.log(
		"  cache <action>\x1b[1;36m󰃨\x1b[0m Cache management (prune: remove expired, clear: empty all)",
	);
	console.log("");
	console.log("MANAGEMENT & TOOLS");
	console.log(
		"  quota, q      \x1b[1;36m󰓅\x1b[0m Real-time Multi-Provider Quota Engine (alias: usage, u)",
	);
	console.log(
		"  doctor, doc   \x1b[1;36m󰋼\x1b[0m Full health diagnostic & config syntax check (--check)",
	);
	console.log(
		"  restart, r    \x1b[1;36m󰑐\x1b[0m Restart systemd user services",
	);
	console.log("");
	console.log("REPLAY & TESTING");
	console.log(
		"  record <name> \x1b[1;36m󰑈\x1b[0m Run gateway in record mode to capture JSONL fixtures",
	);
	console.log(
		"  mock <name>   \x1b[1;36m󰘦\x1b[0m Run gateway in mock replay mode without live upstreams",
	);
	console.log("");
	console.log("META");
	console.log("  help, h       \x1b[1;36m󰈙\x1b[0m Display this help guide");
	console.log("  version, v    \x1b[1;36m󰓹\x1b[0m Show version");
	console.log("");
	console.log("HINT");
	console.log(
		"  \x1b[0;90mTry running:\x1b[0m \x1b[1;36mnexus start -h\x1b[0m  \x1b[0;90mor\x1b[0m  \x1b[1;36mnexus quota -h\x1b[0m  \x1b[0;90mfor detailed command options!\x1b[0m",
	);
	console.log("");
}

/** Cetak versi singkat. */
function showVersion(): void {
	console.log(`nexus v${NEXUS_VERSION}`);
}

/**
 * Entry point utama. Dipanggil oleh `bun src/index.ts ...`
 * atau dari pengujian.
 */
export async function main(argv: string[]): Promise<number> {
	const cmd = argv[0];

	// Fallback help & version (Level 1)
	if (
		!cmd ||
		cmd === "help" ||
		cmd === "h" ||
		cmd === "--help" ||
		cmd === "-h"
	) {
		showHelp();
		return 0;
	}
	if (cmd === "version" || cmd === "v" || cmd === "--version" || cmd === "-V") {
		showVersion();
		return 0;
	}

	// Deprecation warnings — exit code 2 (konvensi untuk deprecated command).
	const deprecationMsg = DEPRECATED_COMMANDS[cmd];
	if (deprecationMsg) {
		reportDeprecated(cmd, deprecationMsg);
		return 2;
	}

	const handler = COMMANDS[cmd];
	if (!handler) {
		handleUnknownCommand(cmd);
		return 1;
	}

	try {
		return await handler(argv.slice(1));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error("");
		console.error(`\x1b[1;31m[error] [Nexus Error] ${cmd} crash:\x1b[0m`);
		console.error(`\x1b[0m   ${msg}\x1b[0m`);
		console.error("");
		return 1;
	}
}

/**
 * Direct-invocation guard.
 *   $ bun src/index.ts quota --json
 * Dipasang di akhir file agar test/kode lain bisa import `main()` tanpa
 * langsung mengeksekusi side-effect.
 */
if (import.meta.main) {
	const exitCode = await main(process.argv.slice(2));
	process.exit(exitCode);
}
