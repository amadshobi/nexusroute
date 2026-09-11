/**
 * ─────────────────────────────────────────────────────────────
 * Goblin Nexus — Master CLI Entry Point (gn v2)
 * ─────────────────────────────────────────────────────────────
 *
 * Router TypeScript untuk seluruh subcommand `gn`.
 * Shell launcher `gn.sh` meneruskan semua argv ke file ini;
 * kita dispatch ke handler sesuai subcommand pertama.
 *
 * Aturan desain:
 *   - Setiap handler menerima argv SETELAH subcommand (bukan termasuk).
 *     Mis. `gn usage --json` → handleUsageCommand(["--json"]).
 *   - Help level-1 (banner + daftar command) ada di sini.
 *   - Help level-2 (panduan mendalam) ada di masing-masing handler.
 *   - Exit code: 0 sukses, 1 kesalahan umum, 2 deprecation.
 */

import { printGnHeader } from "./utils/formatter";
import { handleUnknownCommand } from "./utils/error";
import { GN_VERSION } from "./version";
import { handleQuotaCommand } from "./commands/quota";
import { handleDoctorCommand, handleRestartCommand } from "./commands/doctor";
import { handleGatewayCommand } from "./commands/gateway";

/** Versi gn standalone (Control Plane & Telemetry Core). */
export { GN_VERSION };

/**
 * Peta subcommand → handler.
 */
const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
	// Gateway Interceptor Core
	gateway: handleGatewayCommand,
	gw: handleGatewayCommand,
	g: handleGatewayCommand,
	shield: handleGatewayCommand,

	// Quota & Multi-provider Engine (Single Source of Truth)
	quota: handleQuotaCommand,
	q: handleQuotaCommand,
	usage: handleQuotaCommand,
	u: handleQuotaCommand,

	// Service control
	doctor: handleDoctorCommand,
	doc: handleDoctorCommand,
	restart: handleRestartCommand,
	r: handleRestartCommand,
};

/**
 * Subcommand lama yang sudah didepresiasi.
 * Pesan akan ditampilkan + exit code 2 (conventional untuk deprecated command).
 * Logika ini ada di sini (bukan di gn.sh) supaya `bin/gn` (yang langsung
 * exec ke router ini) tetap bisa menampilkan deprecation warning yang benar.
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
		`\x1b[1;33m⚠️  Command \x1b[0m\x1b[1;37m${cmd}\x1b[0m\x1b[1;33m sudah deprecated.\x1b[0m`,
	);
	console.error(
		`\x1b[0m   Gunakan \x1b[1;36m${replacement}\x1b[0m\x1b[0m sebagai gantinya.\x1b[0m`,
	);
}

/** Cetak bantuan level-1 (banner + daftar command makro). */
function showHelp(): void {
	printBanner();
	console.log("USAGE");
	console.log("  $ gn <command> [flags]");
	console.log(
		"  $ gn <command> --help                  \x1b[1;33m󰋽 Panduan mendalam Level-2 per-command!\x1b[0m",
	);
	console.log("");
	console.log("COMMANDS");
	console.log(
		"  gateway, gw   \x1b[1;36m󰐌\x1b[0m Gateway Interceptor Core (prompt cache, replay, fallback, log)",
	);
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
	console.log("META");
	console.log("  help, h       \x1b[1;36m󰈙\x1b[0m Tampilkan panduan ini");
	console.log("  version, v    \x1b[1;36m󰓹\x1b[0m Tampilkan versi");
	console.log("");
	console.log("HINT");
	console.log(
		"  \x1b[0;90mCoba jalankan:\x1b[0m \x1b[1;36mgn gw -h\x1b[0m  \x1b[0;90matau\x1b[0m  \x1b[1;36mgn q -h\x1b[0m  \x1b[0;90muntuk panduan detail per-command!\x1b[0m",
	);
	console.log("");
}

/** Cetak versi singkat. */
function showVersion(): void {
	console.log(`gn v${GN_VERSION}`);
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
		console.error(`\x1b[1;31m🔥 [Goblin Roast Error] ${cmd} crash:\x1b[0m`);
		console.error(`\x1b[0m   ${msg}\x1b[0m`);
		console.error("");
		return 1;
	}
}

/**
 * Direct-invocation guard.
 *   $ bun src/index.ts usage --json
 * Dipasang di akhir file agar test/kode lain bisa import `main()` tanpa
 * langsung mengeksekusi side-effect.
 */
if (import.meta.main) {
	const exitCode = await main(process.argv.slice(2));
	process.exit(exitCode);
}
