#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// Goblin Nexus — Command: `gn sessions` / `gn s`
//
// Session Search & Explorer CLI Tool (Plan 2).
// Digunakan untuk mencari dan mendaftar riwayat sesi berdasarkan:
//   - `--title <query>` / `-t <query>`
//   - `--limit N` / `-n N`
//   - `--json`
// ─────────────────────────────────────────────────────────────

import { queryOpenCodeCli, parseModelName, type OpenCodeCliSessionRow } from "../utils/opencode-cli";
import {
  ANSI_BOLD,
  ANSI_RESET,
  ANSI_GRAY,
  ANSI_CYAN,
  ANSI_YELLOW,
} from "../utils/formatter";

interface SessionArgs {
  titleQuery: string | null;
  limit: number;
  json: boolean;
  help: boolean;
}

function parseSessionArgs(argv: string[]): SessionArgs {
  const args: SessionArgs = {
    titleQuery: null,
    limit: 15,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      args.json = true;
    } else if (a === "-h" || a === "--help") {
      args.help = true;
    } else if (a === "-t" || a === "--title") {
      if (argv[i + 1]) args.titleQuery = argv[++i];
    } else if (a.startsWith("--title=")) {
      args.titleQuery = a.split("=")[1];
    } else if (a === "-n" || a === "--limit") {
      if (argv[i + 1]) args.limit = parseInt(argv[++i], 10) || 15;
    } else if (a.startsWith("-n=") || a.startsWith("--limit=")) {
      args.limit = parseInt(a.split("=")[1], 10) || 15;
    } else if (!a.startsWith("-") && a !== "list") {
      args.titleQuery = a;
    }
  }
  return args;
}

function printSessionsHelp(): void {
  console.log(`
GN SESSIONS — OpenCode Session Search & Explorer
════════════════════════════════════════════════════════════

PENGGUNAAN:
  gn sessions [command/flags]
  gn s        [command/flags]

COMMAND & FLAGS:
  gn s list                    Tampilkan 15 sesi terbaru
  gn s --title "refactor"      Cari sesi berdasarkan judul
  gn s -n 25                   Set limit jumlah sesi (default: 15)
  --json                       Output JSON mentah

CONTOH:
  gn s list                    # 15 sesi terbaru
  gn s "ocm"                   # Cari sesi yang memuat kata "ocm"
  gn s --title "vault" -n 5    # 5 sesi teratas ber-title "vault"
`);
}

export async function handleSessionsCommand(argv: string[]): Promise<number> {
  const args = parseSessionArgs(argv);

  if (args.help) {
    printSessionsHelp();
    return 0;
  }

  let sql = `SELECT id, parent_id, title, directory, agent, model, cost, tokens_input, tokens_output, time_created, time_updated FROM session WHERE (parent_id IS NULL OR parent_id = '')`;

  if (args.titleQuery) {
    const sanitized = args.titleQuery.replace(/'/g, "''");
    sql += ` AND title LIKE '%${sanitized}%'`;
  }

  sql += ` ORDER BY time_updated DESC LIMIT ${args.limit}`;

  const rows = queryOpenCodeCli<OpenCodeCliSessionRow>(sql);

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }

  console.log(`\n  ${ANSI_BOLD}󰈙 OPENCODE SESSION EXPLORER${ANSI_RESET} ${ANSI_GRAY}(Limit ${args.limit})${ANSI_RESET}\n`);

  if (rows.length === 0) {
    console.log(`  ${ANSI_GRAY}󰋽 Tidak ada sesi ditemukan.${ANSI_RESET}\n`);
    return 0;
  }

  console.log(`  ${ANSI_BOLD}${"SESSION ID".padEnd(28)}  ${"TITLE".padEnd(32)}  ${"MODEL".padEnd(20)}  ${"COST".padEnd(10)}${ANSI_RESET}`);
  console.log(`  ${ANSI_GRAY}${"─".repeat(95)}${ANSI_RESET}`);

  for (const r of rows) {
    const model = parseModelName(r.model);
    const title = r.title.length > 30 ? r.title.slice(0, 27) + "..." : r.title.padEnd(30);
    const id = r.id.padEnd(28);
    const modelStr = model.length > 18 ? model.slice(0, 15) + "..." : model.padEnd(18);
    const costStr = `$ ${r.cost.toFixed(2)}`;

    console.log(`  ${ANSI_CYAN}${id}${ANSI_RESET}  ${ANSI_BOLD}${title}${ANSI_RESET}  ${ANSI_YELLOW}${modelStr}${ANSI_RESET}  ${ANSI_GRAY}${costStr}${ANSI_RESET}`);
  }
  console.log();

  return 0;
}
