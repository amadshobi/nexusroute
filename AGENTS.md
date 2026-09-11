# AGENTS.md — NexusRoute Developer & Agent Guide

Instruction guide for AI agents and developers working on `nexusroute`.
Keep responses brief and strictly follow the operational invariants below.

---

## 1. Project Overview & Architecture

NexusRoute is a high-performance, ultra-lightweight Bun-native edge proxy and multi-agent telemetry gateway (`:4010`). It intercepts local LLM calls from tools (OpenCode, Hermes), applies deterministic prompt caching and privacy sanitization, routes requests across upstreams, and serves a Vite SPA Web Console.

```
Clients (OpenCode, Hermes, curl)
               │
               ▼ (:4010)
┌────────────────────────────────────────────────────────┐
│ NexusRoute Gateway Server (src/gateway/)               │
│  - context.ts          : Shared GatewayContext         │
│  - server.ts           : Bun.serve lifecycle & routing │
│  - routes/proxy.ts     : SSE streaming proxy & cache   │
│  - routes/dashboard.ts : /api/dashboard REST endpoints │
│  - routes/models.ts    : Catalog filtering & cascades  │
│  - routes/ping-probe.ts: Active health probes          │
│  - routes/static.ts    : Serves web/dist SPA           │
└────────────────┬───────────────────┬───────────────────┘
                 │                   │
                 ▼                   ▼
      OMP Gateway (:4000)    VansRouter (:20128)
```

---

## 2. Essential Developer Commands

Run from the repository root:

```bash
# Typecheck (zero emit)
bun run typecheck

# Run backend unit tests
bun test

# Run a single focused test file
bun test tests/gateway/gateway.test.ts

# Build frontend Web Console SPA
bun run --cwd web build

# Full verification sequence (must pass before marking done)
bun run typecheck && bun test && bun run --cwd web build

# Run local CLI doctor diagnostic
./bin/nexus doctor
```

---

## 3. Critical Operational Invariants

1. **Strict Zero-Emoji Rule**:
   - Never output emojis in CLI, terminal text, logs, or UI components.
   - Use Nerd Font icons (e.g. `󰄬`, `󰀦`, `󰋼`, `󰚌`) or ASCII. (User chat is the sole exception).
2. **Binary & PATH Coexistence**:
   - `bin/nexus` is the canonical CLI wrapper.
   - `bin/gn` is an active alias retained for backward compatibility (`~/.local/bin/gn` links here).
   - **Never delete or move `bin/gn`** without verifying the user's host PATH symlink first.
3. **Layered Fallback Resolution**:
   - **Env vars**: Prefer `NEXUS_*` (e.g. `NEXUS_GATEWAY_PORT`), fallback to `GN_*`.
   - **Config file**: Check `~/.config/nexus/config.json` first, fallback to `~/.config/gn/config.json`.
   - **Cache & logs**: Check `~/.cache/nexus/` first, fallback to `~/.cache/gn/`.
   - **Endpoints**: Support dual paths (`/nexus/health` and `/gn/health`; `/nexus/stats` and `/gn/stats`).
   - **Telemetry DB**: SQLite store lives dynamically at `~/.cache/goblin-nexus/telemetry.db`. Never place `.sqlite` files inside `src/`.
4. **Git Discipline**:
   - Never stage, commit, or push without explicit user instruction.
   - Commit trailers: include `--trailer "Co-authored-by: opencode-agent[bot] <219766164+opencode-agent[bot]@users.noreply.github.com>"`.
   - Use conventional commit format (<= 72 chars, lowercase, no emojis).

---

## 4. Test & Fixture Guidelines

- Backend tests reside in `tests/gateway/` (never put test files in `src/`).
- When creating integration tests with `GatewayServer`, bind mock upstreams to dynamic ephemeral ports (`mockServer.port`) instead of defaulting to `4000` or `4010` to prevent collisions with running background services.
- Test fixtures for replay testing live in `~/.config/nexus/fixtures/` (legacy fallback `~/.config/gn/fixtures/`).

---

## 5. Systemd Service Quirks

- Canonical service unit: `nexus-gateway.service`.
- When modifying systemd paths, `ReadWritePaths` must include:
  `%h/.config/nexus %h/.config/gn %h/.cache/nexus %h/.cache/gn %h/.cache/goblin-nexus %h/.bun`
  (systemd user mode does not auto-create directories outside `CacheDirectory`).
