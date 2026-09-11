import * as fs from "fs";
import * as path from "path";
import { stderr } from "node:process";
import { CompactionConfig } from "../types";
import {
	findOpenCodeConfigPath,
	readOpenCodeConfig,
	writeOpenCodeConfig,
	updateConfigField,
} from "../utils/config";
import {
	printGnHeader,
	formatTable,
	ANSI_BOLD,
	ANSI_RESET,
	ANSI_GRAY,
	ANSI_CYAN,
	ANSI_GREEN,
	ANSI_YELLOW,
} from "../utils/formatter";

// Helper untuk menyembunyikan API key (masking)
function maskApiKey(key?: string): string {
	if (!key) return "-";
	if (key.length <= 8) return "*".repeat(key.length);
	return `${key.slice(0, 5)}...${key.slice(-4)}`;
}

// Helper formatting boolean status
function formatBoolStatus(val?: boolean): string {
	return val ? "󰄬 ENABLED" : "󰅚 DISABLED";
}

export async function handleConfigCommand(argv: string[]): Promise<number> {
	const action = argv[0]; // get | set
	const subArgs = argv.slice(1);

	const hasJsonFlag = argv.includes("--json");
	const cleanSubArgs = subArgs.filter((a) => a !== "--json");

	// Load Config
	const configPath = findOpenCodeConfigPath();
	if (!configPath) {
		stderr.write(`❌ Gagal menemukan file konfigurasi opencode.jsonc\n`);
		return 1;
	}

	const config = readOpenCodeConfig(configPath);
	if (!config) {
		stderr.write(
			`❌ Gagal membaca atau mem-parsing file konfigurasi di: ${configPath}\n`,
		);
		return 1;
	}

	if (action === "get") {
		const target = cleanSubArgs[0]; // agent | mcp | settings | providers | models

		if (hasJsonFlag) {
			// JSON mode
			if (target === "agent") {
				console.log(JSON.stringify(config.agents || [], null, 2));
			} else if (target === "mcp") {
				console.log(JSON.stringify(config.mcp_servers || {}, null, 2));
			} else if (target === "settings") {
				console.log(
					JSON.stringify(
						{
							compaction: config.compaction || {},
							features: config.features || {},
						},
						null,
						2,
					),
				);
			} else if (target === "providers") {
				// Mask API keys dalam output JSON untuk keamanan
				const providers = {
					...(config.providers || config.features?.providers || {}),
				};
				const maskedProviders: Record<string, any> = {};
				for (const [k, v] of Object.entries(providers)) {
					if (typeof v === "string") {
						maskedProviders[k] = maskApiKey(v);
					} else if (v && typeof v === "object") {
						maskedProviders[k] = { ...v };
						if ("api_key" in maskedProviders[k]) {
							maskedProviders[k].api_key = maskApiKey(
								maskedProviders[k].api_key,
							);
						}
					}
				}
				console.log(JSON.stringify(maskedProviders, null, 2));
			} else if (target === "models") {
				console.log(JSON.stringify(config.models || [], null, 2));
			} else {
				console.log(JSON.stringify(config, null, 2));
			}
			return 0;
		}

		// Tampilan Visual Dashboard (Prose Mode)
		printGnHeader("CONFIGURATION MANAGER");
		console.log(`\n${ANSI_GRAY}Path: ${configPath}${ANSI_RESET}\n`);

		if (target === "agent") {
			console.log(`${ANSI_BOLD}󰘚 AGENTS LIST${ANSI_RESET}`);
			console.log(`${ANSI_GRAY}${"─".repeat(80)}${ANSI_RESET}`);
			const agents = config.agents || [];
			if (agents.length === 0) {
				console.log(`  󰋽 Tidak ada agent terkonfigurasi.`);
			} else {
				const headers = [
					"ID",
					"Name",
					"Model",
					"Permissions Count",
					"Tools Count",
				];
				const rows = agents.map((a) => [
					a.id,
					a.name,
					a.model,
					String(a.permissions?.length || 0),
					String(a.tools?.length || 0),
				]);
				console.log(formatTable(headers, rows));
			}
		} else if (target === "mcp") {
			console.log(`${ANSI_BOLD}󰒓 MCP SERVERS${ANSI_RESET}`);
			console.log(`${ANSI_GRAY}${"─".repeat(80)}${ANSI_RESET}`);
			const mcp = config.mcp_servers || {};
			const entries = Object.entries(mcp);
			if (entries.length === 0) {
				console.log(`  󰋽 Tidak ada MCP server terkonfigurasi.`);
			} else {
				const headers = ["Server Name", "Command", "Status"];
				const rows = entries.map(([name, srv]) => [
					name,
					srv.command,
					srv.disabled ? "󰅚 DISABLED" : "󰄬 ENABLED",
				]);
				console.log(formatTable(headers, rows));
			}
		} else if (target === "settings") {
			console.log(`${ANSI_BOLD}󰒓 GLOBAL SETTINGS${ANSI_RESET}`);
			console.log(`${ANSI_GRAY}${"─".repeat(80)}${ANSI_RESET}`);
			// Fallback {} di-assert eksplisit agar union type tidak membuang properti CompactionConfig
			const comp: CompactionConfig = config.compaction || {};
			console.log(`  Compaction:`);
			console.log(`    Enabled         : ${formatBoolStatus(comp.enabled)}`);
			console.log(`    Trigger Tokens  : ${comp.trigger_token_count || "-"}`);
			console.log(
				`    Keep Percent    : ${comp.keep_percent ? comp.keep_percent + "%" : "-"}`,
			);

			const features = config.features || {};
			console.log(`\n  Features:`);
			for (const [k, v] of Object.entries(features)) {
				if (k !== "providers") {
					console.log(
						`    ${k.padEnd(16)}: ${typeof v === "boolean" ? formatBoolStatus(v) : v}`,
					);
				}
			}
		} else if (target === "providers") {
			console.log(`${ANSI_BOLD}󰘚 PROVIDERS CREDENTIALS${ANSI_RESET}`);
			console.log(`${ANSI_GRAY}${"─".repeat(80)}${ANSI_RESET}`);
			const providers = config.providers || config.features?.providers || {};
			const entries = Object.entries(providers);
			if (entries.length === 0) {
				console.log(`  󰋽 Tidak ada credential provider dikonfigurasi.`);
			} else {
				const headers = ["Provider", "API Key / Config"];
				const rows = entries.map(([name, val]) => {
					if (typeof val === "string") {
						return [name, maskApiKey(val)];
					} else if (val && typeof val === "object") {
						const apiKey = (val as any).api_key || (val as any).token;
						return [name, apiKey ? maskApiKey(apiKey) : JSON.stringify(val)];
					}
					return [name, "-"];
				});
				console.log(formatTable(headers, rows));
			}
		} else if (target === "models") {
			console.log(`${ANSI_BOLD}󰘚 MODEL PRICING & WINDOWS${ANSI_RESET}`);
			console.log(`${ANSI_GRAY}${"─".repeat(80)}${ANSI_RESET}`);
			const models = config.models || [];
			if (models.length === 0) {
				console.log(`  󰋽 Tidak ada model terdaftar.`);
			} else {
				const headers = [
					"ID",
					"Provider",
					"Input / M",
					"Output / M",
					"Context Window",
				];
				const rows = models.map((m) => [
					m.id,
					m.provider,
					m.input_price_per_m ? `$${m.input_price_per_m}` : "-",
					m.output_price_per_m ? `$${m.output_price_per_m}` : "-",
					m.context_window ? m.context_window.toLocaleString() : "-",
				]);
				console.log(formatTable(headers, rows));
			}
		} else {
			console.log(
				`${ANSI_YELLOW}󰀦 Target get tidak valid. Gunakan: agent | mcp | settings | providers | models${ANSI_RESET}`,
			);
		}
		console.log();
		return 0;
	}

	if (action === "set") {
		const fieldPath = cleanSubArgs[0];
		const rawValue = cleanSubArgs[1];

		if (!fieldPath || rawValue === undefined) {
			stderr.write(`❌ Gunakan format: gn config set <fieldPath> <value>\n`);
			stderr.write(`   Contoh: gn config set compaction.enabled true\n`);
			return 1;
		}

		// Konversi basic types
		let value: any = rawValue;
		if (rawValue.toLowerCase() === "true") value = true;
		else if (rawValue.toLowerCase() === "false") value = false;
		else if (!isNaN(Number(rawValue))) value = Number(rawValue);

		// Create Backup
		const backupPath = `${configPath}.bak`;
		try {
			fs.copyFileSync(configPath, backupPath);
		} catch (err) {
			stderr.write(
				`❌ Gagal membuat backup file konfigurasi di: ${backupPath}\n`,
			);
			return 1;
		}

		// Update config immutably
		const updatedConfig = updateConfigField(config, fieldPath, value);

		// Save Config
		const success = writeOpenCodeConfig(configPath, updatedConfig);
		if (success) {
			console.log(
				`\n${ANSI_GREEN}✅ Sukses memperbarui '${fieldPath}' menjadi '${value}'${ANSI_RESET}`,
			);
			console.log(
				`${ANSI_GRAY}   Backup dibuat di: ${backupPath}${ANSI_RESET}\n`,
			);
			return 0;
		} else {
			stderr.write(
				`❌ Gagal menulis pembaruan konfigurasi ke file: ${configPath}\n`,
			);
			return 1;
		}
	}

	// Fallback help
	printGnConfigHelp();
	return 0;
}

function printGnConfigHelp(): void {
	const lines = [
		"",
		"GN CONFIG — OpenCode Configuration Manager",
		"════════════════════════════════════════════════════════════",
		"",
		"PENGGUNAAN:",
		"  gn config get <target> [flags]",
		"  gn config set <fieldPath> <value>",
		"",
		"TARGET GET:",
		"  agent        Tampilkan semua konfigurasi agent",
		"  mcp          Tampilkan semua konfigurasi MCP servers",
		"  settings     Tampilkan compaction & global settings",
		"  providers    Tampilkan credentials provider (masked API keys)",
		"  models       Tampilkan perbandingan model & pricing",
		"",
		"FLAGS GET:",
		"  --json       Tampilkan output mentah dalam format JSON",
		"",
		"CONTOH:",
		"  gn config get agent",
		"  gn config get settings --json",
		"  gn config set compaction.enabled true",
		"  gn config set agents.0.model google-antigravity/gemini-3.6-flash",
		"",
	];
	console.log(lines.join("\n"));
}
