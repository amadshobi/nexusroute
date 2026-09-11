#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// Goblin Nexus — Command: `gn doctor` & `gn restart`
//
// Tree-Structured Diagnostic for local AI infrastructure.
// Full-chain check: Runtimes, Systemd Daemons, Network Ports,
// SQLite Databases, Zero-Secret Auth Matrix, & Cache Storage.
// ─────────────────────────────────────────────────────────────

import { stderr } from "node:process";
import {
	existsSync,
	statSync,
	readdirSync,
	accessSync,
	constants,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as net from "node:net";
import { Database } from "bun:sqlite";

import type { DoctorCheckResult } from "../types";
import {
	printGnHeader,
	visibleWidth,
	ANSI_BOLD,
	ANSI_RESET,
	ANSI_GRAY,
	ANSI_CYAN,
	ANSI_RED,
	ANSI_GREEN,
	ANSI_YELLOW,
} from "../utils/formatter";

// ─── Paths (single source of truth) ──────────────────────────

const PATHS = {
	brokerToken: join(homedir(), ".omp", "auth-broker.token"),
	agentDb: join(homedir(), ".omp", "agent", "agent.db"),
	opencodeDb: join(homedir(), ".local", "share", "opencode", "opencode.db"),
	statsDb: join(homedir(), ".omp", "stats.db"),
	cacheDir: join(homedir(), ".config", "gn", "cache"),
	opencodeConfig: join(homedir(), ".config", "opencode", "opencode.jsonc"),
	brokerService: "omp-broker.service",
	gatewayService: "omp-gateway.service",
};

// ─── CLI Args ────────────────────────────────────────────────

interface DoctorArgs {
	short: boolean;
	json: boolean;
	help: boolean;
}

function parseDoctorArgs(argv: string[]): DoctorArgs {
	const args: DoctorArgs = {
		short: false,
		json: false,
		help: false,
	};
	for (const a of argv) {
		if (a === "--short") args.short = true;
		else if (a === "--json") args.json = true;
		else if (a === "-h" || a === "--help") args.help = true;
	}
	return args;
}

// ─── Help (Level 2) ──────────────────────────────────────────

function printDoctorHelp(): void {
	const lines = [
		"",
		"GN DOCTOR — System & Service Health Diagnostic (Tree)",
		"════════════════════════════════════════════════════════════",
		"",
		"DESKRIPSI:",
		"  Diagnostic menyeluruh untuk seluruh infrastruktur Goblin Nexus & OpenCode:",
		"  1. Daemons & Runtimes (omp, bun, systemd services, gateway & broker ports)",
		"  2. Databases & Telemetry (agent.db, opencode.db, stats.db, auth token)",
		"  3. Auth & Provider Matrix (Zero-Secret live reachability & account check)",
		"  4. Storage & Configuration (cache permissions & opencode.jsonc)",
		"",
		"PENGGUNAAN:",
		"  gn doctor [flags]",
		"  gn doc    [flags]",
		"",
		"FLAGS:",
		"      --short   Hanya tampilkan kategori/check yang warn/error",
		"      --json    Output JSON mentah (untuk script monitoring/CI)",
		"  -h, --help    Tampilkan panduan ini",
		"",
		"CONTOH:",
		"  gn doctor                # Full diagnostic tree",
		"  gn doc --short           # Hanya issue bermasalah",
		"  gn doctor --json         # JSON payload",
		"",
		"RELATED:",
		"  gn restart               # Restart omp-broker & omp-gateway",
		"",
	];
	console.log(lines.join("\n"));
}

// ─── Helper Types ────────────────────────────────────────────

interface DiagnosticCategory {
	title: string;
	icon: string;
	checks: DoctorCheckResult[];
}

// ─── Individual Checks ───────────────────────────────────────

function checkOmpBinary(): DoctorCheckResult {
	const ompPath = Bun.which("omp");
	if (ompPath) {
		const rel = ompPath.replace(homedir(), "~");
		return {
			name: "omp binary",
			status: "ok",
			detail: rel,
		};
	}
	return {
		name: "omp binary",
		status: "warn",
		detail: "NOT FOUND in $PATH",
		hint: "Install OMP CLI binary ke ~/.local/bin/omp atau tambahkan ke PATH.",
	};
}

function checkBunRuntime(): DoctorCheckResult {
	const bunPath = Bun.which("bun");
	if (bunPath) {
		return {
			name: "bun runtime",
			status: "ok",
			detail: `v${Bun.version} (${process.platform} ${process.arch})`,
		};
	}
	return {
		name: "bun runtime",
		status: "error",
		detail: "NOT FOUND",
		hint: "Bun runtime diperlukan untuk menjalankan tools Goblin Nexus.",
	};
}

function checkBrokerService(): DoctorCheckResult {
	return runSystemctlCheck(PATHS.brokerService, "omp-broker.service");
}

function checkGatewayService(): DoctorCheckResult {
	return runSystemctlCheck(PATHS.gatewayService, "omp-gateway.service");
}

async function checkGatewayPort(): Promise<DoctorCheckResult> {
	const start = performance.now();
	try {
		const res = await fetch("http://127.0.0.1:4000/v1/models", {
			signal: AbortSignal.timeout(2000),
		});
		const lat = Math.round(performance.now() - start);
		if (res.ok) {
			const data = (await res.json()) as { data?: unknown[] };
			const count = data.data?.length ?? 0;
			return {
				name: "Port 4000 (Gateway)",
				status: "ok",
				detail: `127.0.0.1:4000 (${lat} ms · ${count} models ready)`,
			};
		}
		return {
			name: "Port 4000 (Gateway)",
			status: "warn",
			detail: `HTTP ${res.status} (${lat} ms)`,
			hint: "Gateway merespons tapi status bukan 200. Cek log: journalctl --user -u omp-gateway.service",
		};
	} catch (err) {
		return {
			name: "Port 4000 (Gateway)",
			status: "error",
			detail: "Unreachable (Connection refused/timeout)",
			hint: "Service gateway mati atau tidak listening di port 4000. Jalankan 'gn restart'.",
		};
	}
}

function checkBrokerPort(): Promise<DoctorCheckResult> {
	return new Promise((resolve) => {
		const start = performance.now();
		const socket = new net.Socket();
		socket.setTimeout(1000);

		socket.on("connect", () => {
			const lat = Math.round(performance.now() - start);
			socket.destroy();
			resolve({
				name: "Port 4001 (Broker)",
				status: "ok",
				detail: `127.0.0.1:4001 (${lat} ms · socket ready)`,
			});
		});

		socket.on("timeout", () => {
			socket.destroy();
			resolve({
				name: "Port 4001 (Broker)",
				status: "warn",
				detail: "Timeout (1000 ms)",
				hint: "Broker port lambat merespons. Cek omp-broker.service.",
			});
		});

		socket.on("error", () => {
			socket.destroy();
			resolve({
				name: "Port 4001 (Broker)",
				status: "error",
				detail: "Connection Refused",
				hint: "Broker tidak aktif di port 4001. Jalankan 'gn restart'.",
			});
		});

		socket.connect(4001, "127.0.0.1");
	});
}

function checkAgentDb(): DoctorCheckResult {
	if (!existsSync(PATHS.agentDb)) {
		return {
			name: "agent.db",
			status: "error",
			detail: `NOT FOUND at ${PATHS.agentDb}`,
			hint: "Jalankan omp-broker sekali untuk generate DB otomatis.",
		};
	}
	try {
		const size = statSync(PATHS.agentDb).size;
		const sizeMb = (size / (1024 * 1024)).toFixed(1);
		return {
			name: "agent.db",
			status: "ok",
			detail: `Found (${sizeMb} MB · quota & state DB)`,
		};
	} catch (err) {
		return {
			name: "agent.db",
			status: "error",
			detail: `Unreadable: ${(err as Error).message}`,
			hint: "Cek permission file: chmod 600 ~/.omp/agent/agent.db",
		};
	}
}

function checkOpenCodeDb(): DoctorCheckResult {
	if (!existsSync(PATHS.opencodeDb)) {
		return {
			name: "opencode.db",
			status: "warn",
			detail: `NOT FOUND at ${PATHS.opencodeDb}`,
			hint: "Belum ada riwayat sesi OpenCode. Jalankan opencode untuk inisialisasi.",
		};
	}
	try {
		const size = statSync(PATHS.opencodeDb).size;
		const sizeMb = (size / (1024 * 1024)).toFixed(1);
		let sessionCount = 0;
		try {
			const db = new Database(PATHS.opencodeDb, { readonly: true });
			const row = db
				.query<{ c: number }, []>("SELECT count(*) as c FROM session")
				.get();
			sessionCount = row?.c ?? 0;
			db.close();
		} catch {}

		return {
			name: "opencode.db",
			status: "ok",
			detail: `Found (${sizeMb} MB · ${sessionCount} Sessions)`,
		};
	} catch (err) {
		return {
			name: "opencode.db",
			status: "warn",
			detail: `Unreadable: ${(err as Error).message}`,
		};
	}
}

function checkStatsDb(): DoctorCheckResult {
	if (!existsSync(PATHS.statsDb)) {
		return {
			name: "stats.db",
			status: "ok",
			detail: "Optional (Lazy initialized on first request)",
		};
	}
	try {
		const size = statSync(PATHS.statsDb).size;
		const sizeMb = (size / (1024 * 1024)).toFixed(1);
		return {
			name: "stats.db",
			status: "ok",
			detail: `Found (${sizeMb} MB · telemetry metrics)`,
		};
	} catch {
		return {
			name: "stats.db",
			status: "warn",
			detail: "Exists tapi tidak readable",
		};
	}
}

function checkBrokerToken(): DoctorCheckResult {
	if (process.env.OMP_AUTH_BROKER_TOKEN) {
		return {
			name: "auth-broker.token",
			status: "ok",
			detail: "OMP_AUTH_BROKER_TOKEN set via env",
		};
	}
	if (!existsSync(PATHS.brokerToken)) {
		return {
			name: "auth-broker.token",
			status: "warn",
			detail: `NOT FOUND at ${PATHS.brokerToken}`,
			hint: "Set env OMP_AUTH_BROKER_TOKEN atau restart omp-broker service.",
		};
	}
	try {
		const size = statSync(PATHS.brokerToken).size;
		if (size === 0) {
			return {
				name: "auth-broker.token",
				status: "warn",
				detail: "File exists tapi kosong",
				hint: "Re-generate token: omp-cli token regenerate",
			};
		}
		return {
			name: "auth-broker.token",
			status: "ok",
			detail: `Found (${size} bytes · local IPC token)`,
		};
	} catch {
		return {
			name: "auth-broker.token",
			status: "warn",
			detail: "Exists tapi tidak readable",
		};
	}
}

function checkAuthMatrix(): DoctorCheckResult[] {
	if (!existsSync(PATHS.agentDb)) {
		return [
			{
				name: "Auth Accounts",
				status: "warn",
				detail: "agent.db tidak ditemukan",
				hint: "Jalankan omp auth login untuk menghubungkan provider.",
			},
		];
	}

	try {
		const db = new Database(PATHS.agentDb, { readonly: true });
		interface ActiveCredRow {
			provider: string;
			credential_type: string;
			count: number;
		}

		const rows = db
			.query<ActiveCredRow, []>(
				`SELECT provider, credential_type, count(*) as count 
				 FROM auth_credentials 
				 WHERE disabled_cause IS NULL 
				 GROUP BY provider, credential_type
				 ORDER BY provider ASC`,
			)
			.all();
		db.close();

		if (rows.length === 0) {
			return [
				{
					name: "Auth Accounts",
					status: "warn",
					detail: "Tidak ada kredensial aktif yang terdaftar",
					hint: "Hubungkan akun AI via: omp auth login",
				},
			];
		}

		return rows.map((r) => {
			const typeLabel = r.credential_type === "oauth" ? "OAuth" : "API Key";
			const countLabel = r.count === 1 ? "1 Account" : `${r.count} Accounts`;
			return {
				name: r.provider,
				status: "ok",
				detail: `${typeLabel} (${countLabel} Ready)`,
			};
		});
	} catch (err) {
		return [
			{
				name: "Auth Matrix",
				status: "warn",
				detail: `Gagal membaca auth_credentials: ${(err as Error).message}`,
			},
		];
	}
}

function checkCacheStorage(): DoctorCheckResult {
	if (!existsSync(PATHS.cacheDir)) {
		return {
			name: "Cache Storage",
			status: "warn",
			detail: `NOT FOUND at ${PATHS.cacheDir}`,
			hint: "Direktori cache akan otomatis dibuat saat menjalankan gn ping/bench.",
		};
	}
	try {
		accessSync(PATHS.cacheDir, constants.W_OK);
		let count = 0;
		const stack = [PATHS.cacheDir];
		while (stack.length > 0) {
			const dir = stack.pop()!;
			try {
				const entries = readdirSync(dir, { withFileTypes: true });
				for (const e of entries) {
					const full = join(dir, e.name);
					if (e.isDirectory()) stack.push(full);
					else if (e.isFile() && e.name.endsWith(".json")) count++;
				}
			} catch {}
		}
		return {
			name: "Cache Storage",
			status: "ok",
			detail: `~/.config/gn/cache (${count} files)`,
		};
	} catch {
		return {
			name: "Cache Storage",
			status: "warn",
			detail: "Directory exists tapi tidak writable",
			hint: `Perbaiki permission: chmod 700 ${PATHS.cacheDir}`,
		};
	}
}

function checkOpenCodeConfig(): DoctorCheckResult {
	if (!existsSync(PATHS.opencodeConfig)) {
		return {
			name: "OpenCode Config",
			status: "warn",
			detail: `NOT FOUND at ${PATHS.opencodeConfig}`,
			hint: "Buat konfigurasi opencode di ~/.config/opencode/opencode.jsonc",
		};
	}
	try {
		const size = statSync(PATHS.opencodeConfig).size;
		return {
			name: "OpenCode Config",
			status: "ok",
			detail: `~/.config/opencode/opencode.jsonc (${size} B)`,
		};
	} catch {
		return {
			name: "OpenCode Config",
			status: "warn",
			detail: "File exists tapi tidak readable",
		};
	}
}

function runSystemctlCheck(service: string, label: string): DoctorCheckResult {
	try {
		const proc = Bun.spawnSync(["systemctl", "--user", "is-active", service]);
		const out = proc.stdout.toString().trim();

		if (out === "active") {
			return {
				name: label,
				status: "ok",
				detail: "active (running)",
			};
		}
		if (out === "inactive" || out === "failed") {
			return {
				name: label,
				status: "error",
				detail: `${out} (service down)`,
				hint: `Restart service dengan: systemctl --user restart ${service} atau 'gn restart'`,
			};
		}
		return {
			name: label,
			status: "warn",
			detail: `${out || "unknown status"}`,
			hint: `Cek status service: systemctl --user status ${service}`,
		};
	} catch (err) {
		return {
			name: label,
			status: "warn",
			detail: "systemctl call failed",
			hint: "Pastikan systemd user session aktif.",
		};
	}
}

// ─── Tree-Structured Renderer ────────────────────────────────

function renderDiagnosticTree(categories: DiagnosticCategory[]): void {
	for (const cat of categories) {
		console.log(
			`  ${ANSI_CYAN}${ANSI_BOLD}${cat.icon} ${cat.title}${ANSI_RESET}`,
		);

		for (let i = 0; i < cat.checks.length; i++) {
			const check = cat.checks[i];
			const isLast = i === cat.checks.length - 1;
			const branch = isLast ? "└──" : "├──";
			const subBranch = isLast ? "   " : "│  ";

			const dotColor =
				check.status === "ok"
					? ANSI_GREEN
					: check.status === "warn"
						? ANSI_YELLOW
						: ANSI_RED;

			const badgeText =
				check.status === "ok"
					? `${ANSI_GREEN}󰄬 OK${ANSI_RESET}`
					: check.status === "warn"
						? `${ANSI_YELLOW}󰀦 WARN${ANSI_RESET}`
						: `${ANSI_RED}󰅚 ERROR${ANSI_RESET}`;

			const nameColWidth = 22;
			const nameVisLen = visibleWidth(check.name);
			const nameSpace = " ".repeat(Math.max(0, nameColWidth - nameVisLen));

			console.log(
				`  ${ANSI_GRAY}${branch}${ANSI_RESET} ${dotColor}●${ANSI_RESET} ${ANSI_BOLD}${check.name}${ANSI_RESET}${nameSpace} ${ANSI_GRAY}${check.detail}${ANSI_RESET}  ${badgeText}`,
			);

			if (check.hint && check.status !== "ok") {
				console.log(
					`  ${ANSI_GRAY}${subBranch}${ANSI_RESET}    ${ANSI_YELLOW}↳ Hint: ${check.hint}${ANSI_RESET}`,
				);
			}
		}

		console.log();
	}
}

// ─── Handler: Doctor ─────────────────────────────────────────

export async function handleDoctorCommand(argv: string[]): Promise<number> {
	const args = parseDoctorArgs(argv);

	if (args.help) {
		printDoctorHelp();
		return 0;
	}

	// 1. Gather all categories
	const categories: DiagnosticCategory[] = [
		{
			title: "DAEMONS & RUNTIMES",
			icon: "󰘚",
			checks: [
				checkOmpBinary(),
				checkBunRuntime(),
				checkBrokerService(),
				checkGatewayService(),
				await checkGatewayPort(),
				await checkBrokerPort(),
			],
		},
		{
			title: "DATABASES & TELEMETRY",
			icon: "󰆼",
			checks: [
				checkAgentDb(),
				checkOpenCodeDb(),
				checkStatsDb(),
				checkBrokerToken(),
			],
		},
		{
			title: "AUTH & PROVIDER MATRIX",
			icon: "󰌆",
			checks: checkAuthMatrix(),
		},
		{
			title: "STORAGE & CONFIGURATION",
			icon: "󰉋",
			checks: [checkCacheStorage(), checkOpenCodeConfig()],
		},
	];

	const allChecks = categories.flatMap((c) => c.checks);

	// JSON mode
	if (args.json) {
		const totalOk = allChecks.filter((c) => c.status === "ok").length;
		const totalWarn = allChecks.filter((c) => c.status === "warn").length;
		const totalError = allChecks.filter((c) => c.status === "error").length;
		console.log(
			JSON.stringify(
				{
					summary: {
						ok: totalOk,
						warn: totalWarn,
						error: totalError,
						total: allChecks.length,
					},
					categories,
				},
				null,
				2,
			),
		);
		return totalError > 0 ? 1 : 0;
	}

	// Render Tree mode
	printGnHeader("SYSTEM DOCTOR — HEALTH DIAGNOSTIC (TREE)");
	console.log();

	const displayCategories = args.short
		? categories
				.map((cat) => ({
					...cat,
					checks: cat.checks.filter((c) => c.status !== "ok"),
				}))
				.filter((cat) => cat.checks.length > 0)
		: categories;

	if (displayCategories.length === 0 && args.short) {
		console.log(
			`${ANSI_GREEN}  🎉 Semua check OK — tidak ada warning atau error!${ANSI_RESET}\n`,
		);
	} else {
		renderDiagnosticTree(displayCategories);
	}

	const totalOk = allChecks.filter((c) => c.status === "ok").length;
	const totalWarn = allChecks.filter((c) => c.status === "warn").length;
	const totalError = allChecks.filter((c) => c.status === "error").length;

	console.log(
		`${ANSI_GRAY}  ───────────────────────────────────────────────────────────────────${ANSI_RESET}`,
	);
	if (totalError === 0 && totalWarn === 0) {
		console.log(
			`  ${ANSI_GREEN}🎉 SYSTEM 100% OPERATIONAL${ANSI_RESET} · ${ANSI_BOLD}${totalOk}/${allChecks.length} Checks Passed${ANSI_RESET} (No Blockers)\n`,
		);
	} else {
		const statusParts = [];
		if (totalOk > 0)
			statusParts.push(`${ANSI_GREEN}${totalOk} OK${ANSI_RESET}`);
		if (totalWarn > 0)
			statusParts.push(`${ANSI_YELLOW}${totalWarn} WARN${ANSI_RESET}`);
		if (totalError > 0)
			statusParts.push(`${ANSI_RED}${totalError} ERROR${ANSI_RESET}`);
		console.log(
			`  ${ANSI_BOLD}Summary Status:${ANSI_RESET} ${statusParts.join(" · ")} (Total: ${allChecks.length} Checks)\n`,
		);
	}

	return totalError > 0 ? 1 : 0;
}

// ─── Handler: Restart ────────────────────────────────────────

export async function handleRestartCommand(argv: string[]): Promise<number> {
	if (argv.includes("-h") || argv.includes("--help")) {
		console.log(
			[
				"",
				"GN RESTART — Restart OMP Proxy Services",
				"════════════════════════════════════════════════════════════",
				"",
				"DESKRIPSI:",
				"  Restart systemd user services: omp-broker.service dan",
				"  omp-gateway.service. Aman dipanggil kapan saja.",
				"",
				"PENGGUNAAN:",
				"  gn restart",
				"  gn r",
				"",
			].join("\n"),
		);
		return 0;
	}

	console.log(`\n${ANSI_CYAN}󰑐 Restarting OMP Proxy services...${ANSI_RESET}`);
	console.log(`${ANSI_GRAY}   ${PATHS.brokerService}${ANSI_RESET}`);
	console.log(`${ANSI_GRAY}   ${PATHS.gatewayService}${ANSI_RESET}\n`);

	try {
		const proc = Bun.spawn(
			[
				"systemctl",
				"--user",
				"restart",
				PATHS.brokerService,
				PATHS.gatewayService,
			],
			{ stdout: "pipe", stderr: "pipe" },
		);

		const exitCode = await proc.exited;
		const stderrOut = await new Response(proc.stderr).text();

		if (exitCode !== 0) {
			stderr.write(`❌ systemctl restart gagal (exit ${exitCode})\n`);
			if (stderrOut) stderr.write(`${stderrOut}\n`);
			return 1;
		}

		console.log(
			`${ANSI_GREEN}✅ Services restarted successfully!${ANSI_RESET}\n`,
		);
		return 0;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		stderr.write(`󰅚 gn restart crash: ${msg}\n`);
		return 1;
	}
}
