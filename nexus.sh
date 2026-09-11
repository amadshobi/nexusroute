#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# NexusRoute — Shell Launcher (nexus)
# ─────────────────────────────────────────────────────────────
#
# Wrapper tipis untuk seluruh subcommand `nexus`.
# Logic aplikasi dipindahkan ke TypeScript master router di
# `src/index.ts`. Shell ini hanya:
#   - meneruskan argumen ke router TS (untuk semua command baru),
#   - menahan deprecation warnings (command lama yang belum dihapus),
#   - live stream logs (perintah yang memang harus shell-side).
#
# Untuk penggunaan normal, eksekusi via `bin/nexus` agar PATH konsisten.
# File ini juga bisa dipanggil langsung: `bash nexus.sh <command>`.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

NEXUS_DIR="$(cd "$(dirname "$0")" && pwd)"

_nexus_warn() {
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
        exec bun "$NEXUS_DIR/src/index.ts" help
        ;;
    help|h|--help|-h)
        # `nexus help <subcmd>` ditranslasikan jadi `nexus <subcmd> --help`
        # supaya setiap handler menampilkan panduan mendalam level-2.
        subcmd="${2:-}"
        if [ -n "$subcmd" ]; then
            exec bun "$NEXUS_DIR/src/index.ts" "$subcmd" --help
        else
            exec bun "$NEXUS_DIR/src/index.ts" help
        fi
        ;;
    logs|lg)
        # Live stream journal — perintah shell-only, tidak perlu router TS.
        # Target utama nexus-gateway.service, fallback ke gn- lalu omp-gateway.
        shift
        target=""
        for unit in nexus-gateway.service gn-gateway.service omp-gateway.service; do
            if systemctl --user cat "$unit" >/dev/null 2>&1; then
                target="$unit"
                break
            fi
        done
        exec journalctl --user -u "${target:-nexus-gateway.service}" -f "$@"
        ;;
    ping|p)
        _nexus_warn "Command 'nexus ping' telah didepresiasi. Gunakan Web Console (http://localhost:4010/dashboard#ping) atau REST API probe."
        exit 2
        ;;
    bench|b)
        _nexus_warn "Command 'nexus bench' telah didepresiasi. Gunakan Web Console probe latency atau benchmark REST API."
        exit 2
        ;;
    sessions|s|ses)
        _nexus_warn "Command 'nexus sessions' telah didepresiasi. Gunakan OpenCode CLI langsung ('oc session')."
        exit 2
        ;;
    config|c)
        _nexus_warn "Command 'nexus config' telah didepresiasi. Kelola opencode.jsonc langsung melalui OpenCode."
        exit 2
        ;;
    quarantine)
        _nexus_warn "Command 'nexus quarantine' telah didepresiasi. Gunakan REST API OMP Auth-Broker (POST /v1/credential/:id/disable)."
        exit 2
        ;;
    export|e)
        _nexus_warn "Command 'nexus export' telah didepresiasi. Gunakan REST API OMP Auth-Broker (GET /v1/snapshot)."
        exit 2
        ;;
    *)
        # Semua subcommand baru (usage, ollama, stats, sessions,
        # doctor, restart, version) ditangani oleh router TS master.
        exec bun "$NEXUS_DIR/src/index.ts" "$@"
        ;;
esac
