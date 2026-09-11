#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// Goblin Nexus — Terminal Formatter Utilities
// Pure rendering functions untuk output terminal yang konsisten.
// ZERO side-effects di luar console.log() di renderTable/printGnHeader.
//
// ARSITEKTUR (architect spec section 5.7):
//   - Semua fungsi di sini PURE (input → output, no I/O).
//   - TIDAK ADA business logic — hanya formatting.
//   - Reusable lintas command (usage, stats, sessions, ollama).
//   - Tidak depend on chalk/boxen — pakai ANSI escape manual.
// ─────────────────────────────────────────────────────────────

// ─── ANSI Escape Constants ───────────────────────────────────

/** Reset semua style. */
export const ANSI_RESET = "\x1b[0m";
/** Bold + white (default untuk banner per coding-style §9). */
export const ANSI_BOLD_WHITE = "\x1b[1;37m";
/** Abu-abu redup (untuk badge unused/secondary text). */
export const ANSI_GRAY = "\x1b[0;90m";
/** Hijau (untuk status OK). */
export const ANSI_GREEN = "\x1b[0;32m";
/** Kuning (untuk status WARN). */
export const ANSI_YELLOW = "\x1b[0;33m";
/** Merah (untuk status ERROR/CRITICAL). */
export const ANSI_RED = "\x1b[0;31m";
/** Cyan (untuk info/accent). */
export const ANSI_CYAN = "\x1b[0;36m";
/** Bold (untuk header emphasis). */
export const ANSI_BOLD = "\x1b[1m";

// ─── Banner (port dari gn.sh line 23-29) ─────────────────────

/**
 * ASCII art banner "GN" — di-port dari `gn.sh` _gn_header().
 * Per coding-style §9: pakai Unicode Block Font dengan default
 * color Pure White.
 */
const GN_BANNER_LINES: readonly string[] = [
  "  ██████╗ ███╗   ██╗",
  " ██╔════╝ ████╗  ██║",
  " ██║  ███╗██╔██╗ ██║",
  " ██║   ██║██║╚██╗██║",
  " ╚██████╔╝██║ ╚████║",
  "  ╚═════╝ ╚═╝  ╚═══╝",
];

// ─── Number & Currency Formatters ───────────────────────────

/**
 * Format angka dengan thousand separator (locale en-US).
 *
 * @example
 * formatNumber(1687912)      // "1,687,912"
 * formatNumber(1234.5)       // "1,234.5"
 * formatNumber(0)            // "0"
 * formatNumber(NaN)          // "NaN"
 * formatNumber(Infinity)     // "Infinity"
 */
export function formatNumber(num: number): string {
  if (!Number.isFinite(num)) return String(num);
  if (Number.isInteger(num)) {
    return num.toLocaleString("en-US");
  }
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Format nilai USD dengan 4 desimal (presisi cukup untuk token cost).
 *
 * @example
 * formatCost(1.225)          // "$1.2250"
 * formatCost(0)              // "$0.0000"
 * formatCost(-0.5)           // "-$0.5000"
 * formatCost(0.000042)       // "$0.0000"  (rounds to 4dp)
 */
export function formatCost(num: number): string {
  if (!Number.isFinite(num)) return `$${String(num)}`;
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  // Round to 4dp, lalu format integer part dengan thousands separator.
  // Approach: pisah integer + fractional, format integer via formatNumber.
  const fixed = abs.toFixed(4);
  const [intPart, fracPart] = fixed.split(".");
  return `${sign}$${formatNumber(Number(intPart))}.${fracPart}`;
}

// ─── Progress Bar ───────────────────────────────────────────

/**
 * Visual progress bar ASCII Unicode.
 * Default width 20 chars + 1 spasi + persen.
 *
 * CATATAN: fraction di-clamp ke [0, 1]. Fraction > 1 atau < 0
 * akan di-clip, bukan throw.
 *
 * @example
 * formatProgressBar(0.54)        // "[███████████░░░░░░░░░] 54%"
 * formatProgressBar(0.42, 30)    // "[█████████████░░░░░░░░░░░░░] 42%"
 * formatProgressBar(1.0)         // "[████████████████████] 100%"
 * formatProgressBar(0)           // "[░░░░░░░░░░░░░░░░░░░░] 0%"
 */
export function formatProgressBar(fraction: number, width: number = 12): string {
  return formatQuotaBar(fraction, undefined, width);
}

/**
 * Architect-spec alias: `formatQuotaBar(used, total?, width?)`.
 * Jika `total` diberikan, fraction = used/total. Jika tidak,
 * `used` diperlakukan sebagai fraction langsung (0..1).
 */
export function formatQuotaBar(
  used: number,
  total?: number,
  width: number = 12
): string {
  const safeWidth = Math.max(1, Math.floor(width));
  const fraction = total !== undefined && total > 0
    ? used / total
    : used;
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(clamped * safeWidth);
  const empty = safeWidth - filled;
  const pct = Math.round(clamped * 100);

  let color = ANSI_GREEN;
  if (pct >= 100) {
    color = ANSI_RED;
  } else if (pct >= 70) {
    color = ANSI_YELLOW;
  }

  const filledStr = `${color}${"━".repeat(filled)}${ANSI_RESET}`;
  const emptyStr = `${ANSI_GRAY}${"─".repeat(empty)}${ANSI_RESET}`;
  return `${filledStr}${emptyStr}`;
}

// ─── Status Badge ───────────────────────────────────────────

/**
 * Status badge visual sesuai standar Goblin Vault CLI.
 * Input case-insensitive. Mapping eksplisit:
 *
 *   "ok"       → "🟢 OK"
 *   "warn"     → "🟡 WARN"
 *   "error"    → "🔴 ERROR"
 *   "critical" → "🔴 CRITICAL"
 *   (lainnya)  → "⚪ UNUSED"
 *
 * @example
 * formatStatusBadge("ok")        // "🟢 OK"
 * formatStatusBadge("WARN")      // "🟡 WARN"
 * formatStatusBadge("critical")  // "🔴 CRITICAL"
 * formatStatusBadge("foo")       // "⚪ UNUSED"
 */
export function formatStatusBadge(status: string): string {
  const s = status.toLowerCase().trim();
  switch (s) {
    case "ok":
      return "󰄬 OK";
    case "warn":
    case "warning":
      return "󰀦 WARN";
    case "error":
    case "failed":
    case "exhausted":
      return "󰅚 ERROR";
    case "critical":
      return "󰅚 CRITICAL";
    default:
      return "󰅖 UNUSED";
  }
}

// ─── Date Formatter ─────────────────────────────────────────

/**
 * Format Unix ms / ISO string ke format ramah-terminal.
 * Adaptif:
 *   - Hari ini       → "14:32"
 *   - Tahun ini      → "Aug 3 14:32"
 *   - Tahun berbeda  → "2025-12-25 09:15"
 *
 * @example
 * formatDate(Date.now())                       // "14:32" (jika hari ini)
 * formatDate("2026-08-03T10:00:00Z")          // "Aug 3 17:00" (WIB)
 * formatDate("2025-12-25T09:15:00Z")          // "2025-12-25 16:15"
 * formatDate("not-a-date")                    // "not-a-date" (passthrough)
 */
export function formatDate(ts: number | string): string {
  let d: Date;
  if (typeof ts === "number") {
    d = new Date(ts);
  } else if (typeof ts === "string" && /^\d+$/.test(ts.trim())) {
    // Numeric string → Unix ms
    d = new Date(Number(ts));
  } else {
    d = new Date(ts);
  }

  if (isNaN(d.getTime())) {
    return String(ts);
  }

  const now = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;

  if (isSameDay(d, now)) {
    return time;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()} ${time}`;
  }
  // Tahun berbeda → ISO date
  const yyyy = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mo}-${dd} ${time}`;
}

/** Nama bulan singkat (English) — konstanta private untuk formatDate. */
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Cek apakah dua Date adalah hari yang sama di local timezone. */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ─── Provider & Cost Badges (architect bonus) ───────────────

/**
 * Format provider ID ke badge visual dengan emoji.
 * Substring match (case-insensitive).
 *
 * @example
 * formatProviderBadge("google-antigravity")   // "🤖 Google"
 * formatProviderBadge("openai-codex")         // "🔑 OpenAI"
 * formatProviderBadge("anthropic-claude")     // "🧠 Anthropic"
 * formatProviderBadge("github-copilot")       // "🐙 GitHub"
 * formatProviderBadge("ollama-cloud")         // "🦙 Ollama"
 * formatProviderBadge("goblin-nexus")         // "👹 Goblin Nexus"
 * formatProviderBadge("unknown")              // "🔌 unknown"
 */
export function formatProviderBadge(provider: string): string {
  const p = provider.toLowerCase();
  if (p.includes("google")) return "󰘚 Google";
  if (p.includes("openai")) return "󰘚 OpenAI";
  if (p.includes("anthropic") || p.includes("claude")) return "󰘚 Anthropic";
  if (p.includes("copilot") || p.includes("github")) return "󰊤 GitHub";
  if (p.includes("ollama")) return "󰘚 Ollama";
  if (p.includes("goblin") || p.includes("nexus")) return "󰚌 Goblin Nexus";
  return `󰘚 ${provider}`;
}

/**
 * Format cost USD dengan color coding sesuai threshold.
 * Threshold berurutan:
 *   - abs < $0.01  → gray (kecil/insignifikan)
 *   - abs < $0.10  → green
 *   - abs < $1.00  → yellow
 *   - abs >= $1.00 → red
 *
 * @example
 * formatCostBadge(0.0042)    // "\x1b[0;32m$0.0042\x1b[0m" (green)
 * formatCostBadge(1.5)       // "\x1b[0;31m$1.5000\x1b[0m" (red)
 */
export function formatCostBadge(usd: number): string {
  const formatted = formatCost(usd);
  const abs = Math.abs(usd);
  if (abs < 0.01) return `${ANSI_GRAY}${formatted}${ANSI_RESET}`;
  if (abs < 0.1) return `${ANSI_GREEN}${formatted}${ANSI_RESET}`;
  if (abs < 1) return `${ANSI_YELLOW}${formatted}${ANSI_RESET}`;
  return `${ANSI_RED}${formatted}${ANSI_RESET}`;
}

/**
 * Format Unix ms timestamp ke countdown string.
 * Return "expired" jika resetsAt <= now.
 *
 * @example
 * formatResetCountdown(Date.now() + 2 * 3600 * 1000 + 15 * 60 * 1000)
 * // "resets in 2h 15m"
 * formatResetCountdown(Date.now() - 1000)
 * // "expired"
 * formatResetCountdown(Date.now() + 5 * 86400 * 1000)
 * // "resets in 5d 0h"
 */
export function formatResetCountdown(resetsAt: number): string {
  const now = Date.now();
  if (!Number.isFinite(resetsAt) || resetsAt <= now) {
    return "expired";
  }
  const diffMs = resetsAt - now;
  const totalMin = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const minutes = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ─── Table Renderer ─────────────────────────────────────────

/**
 * Format tabel aligned tanpa box-drawing outer borders.
 * Detect numeric columns dan right-align otomatis.
 * Pure function — return string. Lihat `renderTable` untuk versi
 * yang langsung print ke stdout.
 *
 * Format output:
 *   Header1    Header2    Header3
 *   ────────   ────────   ────────
 *   value1     value2     value3
 *
 * @param headers  Array of header strings
 * @param rows     Array of rows; setiap row array of cell values
 * @returns String dengan newline-joined rows (no trailing newline)
 */
export function formatTable(headers: string[], rows: string[][]): string {
  if (headers.length === 0) return "";

  // Normalize rows: pad ke column count, semua cell jadi string
  const colCount = headers.length;
  const headerStrs = headers.map((h) => String(h));
  const normalizedRows = rows.map((row) => {
    const cells = row.map((c) => String(c ?? ""));
    while (cells.length < colCount) cells.push("");
    return cells.slice(0, colCount);
  });

  // Hitung max width per column (visible length, ANSI-stripped)
  // Catatan: visibleLength() return string, jadi kita ambil .length (number)
  // agar Math.max() tidak dapat NaN dari string coercion.
  const widths: number[] = headerStrs.map((h, i) => {
    const colValues = normalizedRows.map((r) => r[i] ?? "");
    const allValues = [h, ...colValues];
    return Math.max(...allValues.map((v) => visibleWidth(v)));
  });

  // Detect numeric column untuk right-align
  const aligns: Array<"left" | "right"> = headerStrs.map((_, i) => {
    const colValues = normalizedRows.map((r) => r[i] ?? "");
    return isNumericColumn(colValues) ? "right" : "left";
  });

  // Build lines
  const lines: string[] = [];

  // Header
  lines.push(
    headerStrs
      .map((h, i) => padCell(h, widths[i], aligns[i]))
      .join("  ")
  );
  // Separator
  lines.push(widths.map((w) => "─".repeat(w)).join("  "));
  // Data rows
  for (const row of normalizedRows) {
    lines.push(
      row.map((v, i) => padCell(v, widths[i], aligns[i])).join("  ")
    );
  }

  return lines.join("\n");
}

/**
 * Render tabel ke stdout. Konversi otomatis cell number ke string.
 * Wrapper tipis di atas formatTable() + console.log().
 *
 * @param headers  Array of header strings
 * @param rows     Array of rows; cells bisa string ATAU number
 */
export function renderTable(
  headers: string[],
  rows: (string | number)[][]
): void {
  const stringRows = rows.map((row) =>
    row.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
  );
  console.log(formatTable(headers, stringRows));
}

// ─── Table Helpers ──────────────────────────────────────────

/**
 * Pad cell ke width tertentu sesuai alignment.
 * Mempertahankan ANSI escape codes (visible length dihitung).
 */
function padCell(
  value: string,
  width: number,
  align: "left" | "right"
): string {
  const visLen = visibleWidth(value);
  const padding = Math.max(0, width - visLen);
  if (align === "right") {
    return " ".repeat(padding) + value;
  }
  return value + " ".repeat(padding);
}

/**
 * Detect apakah kolom berisi numeric values (untuk right-align).
 * Strip $, %, koma, spasi sebelum test. Empty cell di-skip.
 */
function isNumericColumn(colValues: string[]): boolean {
  const nonEmpty = colValues.filter((v) => v.trim() !== "");
  if (nonEmpty.length === 0) return false;
  return nonEmpty.every((v) => {
    const cleaned = v
      .trim()
      .replace(/^\$/, "")
      .replace(/%$/, "")
      .replace(/,/g, "")
      .replace(/\s/g, "");
    return cleaned !== "" && /^-?[\d.]+$/.test(cleaned) && !isNaN(Number(cleaned));
  });
}

/**
 * Hitung visible length sebuah string.
 * Strip ANSI escape codes, lalu count chars.
 * Emojis dihitung sebagai 1 char (cukup untuk ASCII-aligned table;
 * untuk perfect alignment butuh grapheme cluster lib — out of scope).
 */
export function visibleLength(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

export function visibleWidth(s: string): number {
  return Array.from(visibleLength(s)).length;
}

// ─── Header / Banner ────────────────────────────────────────

/**
 * Format standard banner + title. Pure function — return string.
 * Per coding-style §9: 1 baris kosong di atas, banner white, title
 * di bawah, 1 baris kosong di bawah.
 *
 * @example
 * formatHeader("GOBLIN NEXUS — QUOTA DASHBOARD")
 * // "\n  ██████╗ ███╗   ██╗\n ██╔════╝ ████╗  ██║\n ..."
 */
export function formatHeader(title: string): string {
  const banner = GN_BANNER_LINES
    .map((line) => `${ANSI_BOLD_WHITE}${line}${ANSI_RESET}`)
    .join("\n");
  const titleLine = `${ANSI_BOLD_WHITE}   Goblin Nexus${ANSI_RESET} \n ${title}`;
  return `\n${banner}\n${titleLine}\n`;
}

/**
 * Print gn banner ke stdout dengan subtitle opsional.
 * Convenience wrapper untuk command layer.
 */
export function printGnHeader(subtitle?: string): void {
  const text = formatHeader(subtitle ?? "GOBLIN NEXUS");
  console.log(text);
}

/**
 * Format solid Unicode Box Table matching `opencode stats --models` style.
 * Uses `┌`, `┬`, `┐`, `├`, `┼`, `┤`, `└`, `┴`, `┘` borders and `│` column dividers.
 * Ensures 100% pixel-perfect straight vertical right border alignment across all terminals.
 */
export function formatBoxTable(
  title: string | null,
  headers: string[],
  rows: string[][]
): string {
  if (headers.length === 0 && rows.length === 0) return "";

  const colCount = Math.max(headers.length, ...rows.map((r) => r.length));
  const normalizedRows = rows.map((row) => {
    const cells = row.map((c) => String(c ?? ""));
    while (cells.length < colCount) cells.push("");
    return cells.slice(0, colCount);
  });

  // Strip ANSI to calculate exact visible width per column
  const colWidths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    const colValues = normalizedRows.map((r) => r[c] ?? "");
    const maxW = Math.max(...colValues.map((v) => visibleWidth(v)));
    colWidths.push(maxW);
  }

  // Inner row width = sum(colWidths) + 2 spaces per col + 3 chars per divider (" │ ")
  const rowInnerWidth = colWidths.reduce((a, b) => a + b, 0) + (colCount > 1 ? (colCount - 1) * 3 : 0) + 2;

  const titleVisLen = title ? visibleWidth(title) : 0;
  const totalBoxWidth = Math.max(rowInnerWidth, titleVisLen + 4);

  const lines: string[] = [];

  // 1. Top border
  lines.push(`┌${"─".repeat(totalBoxWidth)}┐`);

  // 2. Title row
  if (title) {
    const titlePad = totalBoxWidth - titleVisLen;
    const padL = Math.floor(titlePad / 2);
    const padR = totalBoxWidth - padL - titleVisLen;
    lines.push(`│${" ".repeat(padL)}${ANSI_BOLD_WHITE}${title}${ANSI_RESET}${" ".repeat(padR)}│`);
    lines.push(`├${"─".repeat(totalBoxWidth)}┤`);
  }

  // 3. Data Rows
  for (const r of normalizedRows) {
    const formattedCells = r.map((cell, idx) => {
      const visLen = visibleWidth(cell);
      const isNumeric = /^\d+/.test(visibleLength(cell).trim());
      const pad = Math.max(0, colWidths[idx] - visLen);
      if (isNumeric && idx === 1) {
        return `${" ".repeat(pad)}${cell}`;
      }
      return `${cell}${" ".repeat(pad)}`;
    });

    const content = ` ${formattedCells.join(" │ ")} `;
    const contentVisLen = visibleWidth(content);
    const rightFill = " ".repeat(Math.max(0, totalBoxWidth - contentVisLen));

    lines.push(`│${content}${rightFill}│`);
  }

  // 4. Bottom Border
  lines.push(`└${"─".repeat(totalBoxWidth)}┘`);

  return lines.join("\n");
}
