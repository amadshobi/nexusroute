#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# Goblin Nexus — Shell Launcher (gn)
# ─────────────────────────────────────────────────────────────
#
# Wrapper tipis untuk seluruh subcommand `gn`.
# Logic aplikasi dipindahkan ke TypeScript master router di
# `src/index.ts`. Shell ini hanya:
#   - meneruskan argumen ke router TS (untuk semua command baru),
#   - menahan deprecation warnings (command lama yang belum dihapus),
#   - live stream logs (perintah yang memang harus shell-side).
#
# Untuk penggunaan normal, eksekusi via `bin/gn` agar PATH konsisten.
# File ini juga bisa dipanggil langsung: `bash gn.sh <command>`.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

GN_DIR="$(cd "$(dirname "$0")" && pwd)"

_gn_warn() {
    local msg="$1"
    if command -v gum >/dev/null 2>&1; then
        gum style --foreground 214 "󰀦  $msg"
    else
        echo "󰀦  $msg"
    fi
}

case "${1:-}" in
    "")
        # No-arg → tampilkan bantuan via router TS.
        exec bun "$GN_DIR/src/index.ts" help
        ;;
    help|h|--help|-h)
        # `gn help <subcmd>` ditranslasikan jadi `gn <subcmd> --help`
        # supaya setiap handler menampilkan panduan mendalam level-2.
        subcmd="${2:-}"
        if [ -n "$subcmd" ]; then
            exec bun "$GN_DIR/src/index.ts" "$subcmd" --help
        else
            exec bun "$GN_DIR/src/index.ts" help
        fi
        ;;
    logs|lg)
        # Live stream journal — perintah shell-only, tidak perlu router TS.
        shift
        exec journalctl --user -u omp-gateway.service -f "$@"
        ;;
    ping|p)
        _gn_warn "Command 'gn ping' telah didepresiasi. Gunakan REST API OMP (GET /healthz) atau 'omp ping' untuk health-check."
        exit 2
        ;;
    bench|b)
        _gn_warn "Command 'gn bench' telah didepresiasi. Gunakan REST API OMP (POST /v1/chat/completions) atau 'ocm bench' untuk benchmark model."
        exit 2
        ;;
    quarantine|q)
        _gn_warn "Command 'gn quarantine' telah didepresiasi. Gunakan REST API OMP Auth-Broker (POST /v1/credential/:id/disable)."
        exit 2
        ;;
    export|e)
        _gn_warn "Command 'gn export' telah didepresiasi. Gunakan REST API OMP Auth-Broker (GET /v1/snapshot)."
        exit 2
        ;;
    *)
        # Semua subcommand baru (usage, ollama, stats, sessions,
        # doctor, restart, version) ditangani oleh router TS master.
        exec bun "$GN_DIR/src/index.ts" "$@"
        ;;
esac
