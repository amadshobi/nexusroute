#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Goblin Nexus CLI — Level 2 Contextual Help Formatter
# Provides deep manual guides per subcommand
# ─────────────────────────────────────────────────────────────

_show_subcommand_help() {
    local cmd="${1:-}"
    case "$cmd" in
        usage|u)
            cat <<'HELP'
GN USAGE — Quota, Tokens, and Sessions Dashboard

DESKRIPSI
  Dashboard terpadu untuk monitoring penggunaan:
  - Live quota usage per-akun dari broker OMP (/v1/usage)
  - Real token burn & cost dari SQLite DB (tabel client_usage)
  - Analitik detail sesi OpenCode

USAGE
  $ gn usage [provider] [options]
  $ gn u [provider] [options]

MODES & OPTIONS
  (default)          Tampilkan dashboard kuota live (Daily/Weekly) per akun
  --tokens, -t       Mode token burn & cost
  --sessions, -s     Mode detail analitik sesi
  --json             Output JSON mentah (cocok untuk scripting / piping)
  --days <int>       Window hari untuk data token burn (default: 7)
  --limit <int>      Limit jumlah sesi yang ditampilkan (default: 10)

EXAMPLES
  $ gn usage                           Dashboard kuota live semua akun
  $ gn usage --tokens                  Token burn & cost
  $ gn usage --sessions                Tampilkan riwayat sesi terbaru
HELP
            ;;
        config|c)
            cat <<'HELP'
GN CONFIG — OpenCode Configuration Manager

DESKRIPSI
  Mengelola dan menampilkan konfigurasi OpenCode (opencode.jsonc):
  - get: Menampilkan agen, mcp, setting global, provider credentials (masked), dan model pricing
  - set: Mengubah field konfigurasi secara aman (immutable) dengan backup otomatis

USAGE
  $ gn config get <target> [--json]
  $ gn config set <fieldPath> <value>

TARGETS (get)
  agent        Daftar agen terkonfigurasi
  mcp          Konfigurasi dan status server MCP
  settings     Konfigurasi compaction dan global features
  providers    Provider credentials dengan masking API key
  models       Daftar model pricing dan context window

EXAMPLES
  $ gn config get agent
  $ gn config get settings --json
  $ gn config set compaction.enabled true
HELP
            ;;
        ping|p)
            cat <<'HELP'
GN PING — Connectivity Checker

DESKRIPSI
  Melakukan pemeriksaan konektivitas instan ke port OMP Gateway, OMP Broker, Ollama API, dan OpenCode DB.

USAGE
  $ gn ping [--json]
HELP
            ;;
        bench|b)
            cat <<'HELP'
GN BENCH — Gateway Latency Benchmark

DESKRIPSI
  Mengukur performa latensi endpoint OMP Gateway secara berkala.

USAGE
  $ gn bench [-n runs] [--json]

OPTIONS
  -n, --runs <runs>  Jumlah iterasi benchmark (default: 5)
HELP
            ;;
        doctor|doc)
            cat <<'HELP'
GN DOCTOR — Full-Chain System & Credential Health Diagnostic

DESKRIPSI
  Memeriksa kesehatan full-chain infrastruktur OMP:
  1. Service status (omp-broker, omp-gateway)
  2. Port availability (4000, 4001)
  3. SQLite database integrity (agent.db)
  4. Broker authentication token
  5. Gateway API health check
  6. Secret vault integrity

USAGE
  $ gn doctor
  $ gn doc

EXAMPLES
  $ gn doctor          Jalankan diagnostic full-chain
HELP
            ;;
        *)
            cat <<'HELP'
GOBLIN NEXUS CLI — HELPER

Command tidak dikenali atau tidak memiliki deep help khusus.
Gunakan `gn --help` untuk melihat daftar lengkap command utama.
HELP
            ;;
    esac
}
