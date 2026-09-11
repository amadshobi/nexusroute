import { ANSI_BOLD, ANSI_RESET, ANSI_GRAY, ANSI_CYAN, ANSI_YELLOW, ANSI_RED } from "./formatter";

/**
 * List subcommand aktif dan aliasnya untuk fuzzy matching.
 */
const ACTIVE_COMMANDS: Record<string, string> = {
  usage: "usage (alias: u)",
  u: "usage (alias: u)",
  sessions: "sessions (alias: s)",
  s: "sessions (alias: s)",
  ses: "sessions (alias: s)",
  config: "config (alias: c)",
  c: "config (alias: c)",
  ping: "ping (alias: p)",
  p: "ping (alias: p)",
  bench: "bench (alias: b)",
  b: "bench (alias: b)",
  doctor: "doctor (alias: doc)",
  doc: "doctor (alias: doc)",
  restart: "restart (alias: r)",
  r: "restart (alias: r)",
  help: "help (alias: h)",
  h: "help (alias: h)",
  version: "version (alias: v)",
  v: "version (alias: v)",
};

/**
 * Peta migrasi subcommand lama yang sudah dihapus/dilebur.
 */
const DEPRECATED_MIGRATIONS: Record<string, string> = {
  stats: `Command 'gn stats' telah dilebur ke 'gn usage'.\n  💡 Gunakan: ${ANSI_CYAN}gn u -t${ANSI_RESET} (Daily Tokens & Subagent Tree) atau ${ANSI_CYAN}gn u -t -m${ANSI_RESET} (Compact Table).`,
  ollama: `Command 'gn ollama' telah dilebur ke 'gn usage'.\n  💡 Gunakan: ${ANSI_CYAN}gn u${ANSI_RESET} (Live Quota Dashboard termasuk Ollama Cloud).`,
  o: `Command 'gn ollama' telah dilebur ke 'gn usage'.\n  💡 Gunakan: ${ANSI_CYAN}gn u${ANSI_RESET} (Live Quota Dashboard termasuk Ollama Cloud).`,
  ocm: `Tool 'ocm' telah dilebur ke 'gn config'.\n  💡 Gunakan: ${ANSI_CYAN}gn c get <target>${ANSI_RESET} atau ${ANSI_CYAN}gn c set <path> <val>${ANSI_RESET}.`,
  quarantine: `Command 'gn quarantine' telah dipangkas (deprecated).\n  💡 Jalankan ${ANSI_CYAN}gn help${ANSI_RESET} untuk melihat daftar subcommand aktif.`,
  export: `Command 'gn export' telah dipangkas (deprecated).\n  💡 Jalankan ${ANSI_CYAN}gn help${ANSI_RESET} untuk melihat daftar subcommand aktif.`,
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
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
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
    console.error(`\x1b[1;33m󰀦 [Goblin Migration Hint]\x1b[0m ${migrationHint}`);
    console.error("");
    return;
  }

  // 2. Check Fuzzy Levenshtein Matcher
  const suggestion = findClosestCommand(lowerCmd);

  console.error("");
  console.error(
    `\x1b[1;31m󰅚 [Goblin Roast Error]\x1b[0m Subcommand tidak dikenal: \x1b[1;37m"${cmd}"\x1b[0m`
  );

  if (suggestion) {
    console.error(`\n  ${ANSI_YELLOW}󰋽 Maksud lu: ${ANSI_BOLD}${ANSI_CYAN}${suggestion}${ANSI_RESET}${ANSI_YELLOW}?${ANSI_RESET}`);
  }

  console.error(
    `  ${ANSI_GRAY}💡 Jalankan ${ANSI_CYAN}gn help${ANSI_GRAY} untuk melihat daftar subcommand yang tersedia.${ANSI_RESET}\n`
  );
}
