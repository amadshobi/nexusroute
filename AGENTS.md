# AGENTS.md — NexusRoute Developer & Autonomous Agent Guide

> The single, authoritative development manual and architectural contract for human developers and autonomous AI coding agents (OpenCode, Hermes, Claude Code) working across the `nexusroute` repository.
> Every rule and operational invariant herein is strictly enforced. No deviations.

---

## 1. Project Overview & Multi-Tier Architecture

NexusRoute (`nexus`, backward-compatible alias `gn`) is an ultra-lightweight, high-performance Bun-native edge proxy and multi-agent telemetry command center (`:4010`). It intercepts local LLM calls from agent runtimes (OpenCode, Hermes), executes deterministic SHA-256 prompt caching, privacy sanitization, routes requests across upstreams, and serves a high-density Vite SPA Web Console.

```
Clients (OpenCode, Hermes, Claude Code, curl)
               │
               ▼ (:4010)
┌────────────────────────────────────────────────────────┐
│ NexusRoute Gateway Server (src/gateway/)               │
│  - context.ts            : Shared GatewayContext       │
│  - server.ts             : Bun.serve lifecycle/routing │
│  - provider-resolver.ts  : Caller detection/real-prov  │
│  - access-log.ts         : JSONL structured access log │
│  - circuit-breaker.ts    : Cooldown & trip mechanics   │
│  - openrouter-pricing.ts : Zero-hardcode pricing engine│
│  - routes/proxy.ts       : SSE streaming proxy & cache │
│  - routes/dashboard.ts   : /api/dashboard REST telecom │
│  - routes/models.ts      : Governance & whitelist      │
│  - routes/ping-probe.ts  : Active health probes        │
│  - routes/agents.ts      : SQLite telemetry ingestion  │
│  - routes/static.ts      : Serves web/dist SPA         │
└──────────────┬───────────────────┬─────────────────────┘
               │                   │
               ▼                   ▼
    OMP Gateway (:4000)    VansRouter (:20128)
```

---

## 2. Essential Developer Commands & Toolchains

### 2.1 Backend & Gateway Commands (Root Repository)

```bash
# Backend typecheck (covers src/, telemetry/, tests/ ONLY via TypeScript 5.4, strict: true)
bun run typecheck

# Run backend unit tests (also runs formatters.test.ts in web/src/lib/)
bun test

# Run a single focused test file
bun test tests/gateway/gateway.test.ts

# Run local CLI doctor diagnostic
./bin/nexus doctor
```

### 2.2 Frontend Web Console Commands (`web/`)

```bash
# Frontend dev server with hot reload (Vite, base path is /dashboard/)
bun run --cwd web dev

# Frontend lint (oxlint)
bun run --cwd web lint

# Frontend typecheck + production build (tsc -b && vite build via TypeScript ~6.0)
# NOTE: This is the ONLY command that typechecks web/ (root bun run typecheck does NOT)
bun run --cwd web build

# Frontend unit tests
bun run --cwd web test
```

### 2.3 Mandatory Full Verification Sequence

🔴 **CRITICAL**: There is **no automated remote CI, no pre-commit hook, and no `.github/` workflow**. The following command sequence is the **SOLE quality gate**. Every agent MUST execute this and verify exit code 0 before declaring any task done:

```bash
bun run typecheck && bun test && bun run --cwd web build
```

### 2.4 Rebuild & Service Restart Invariant

> The Bun gateway daemon serves the pre-compiled static bundle from `web/dist/` at `:4010/dashboard/*`.
> Any code changes inside `web/src/` remain completely invisible until you recompile and restart the daemon:
>
> ```bash
> bun run --cwd web build && systemctl --user restart nexus-gateway.service
> ```

---

## 3. Strict Operational Invariants (NON-NEGOTIABLE)

1. **Strict 100% English-Only Rule for Code & Interface**:
   - Every file, comment, variable, type, commit message, and user interface element (labels, placeholders, buttons, badges, toast alerts, empty states) **MUST BE IN ENGLISH**.
   - Zero Indonesian words in codebase and UI strings. (Indonesian is reserved strictly for conversational user chat). Existing legacy Indonesian in comments or deprecation strings must be cleaned up opportunistically.
2. **Zero-Fluff & Dense Vertical Space Rule (Mobile-First Optimization)**:
   - Never add decorative, poetic, or redundant descriptive subtitles underneath page titles or card headers (e.g. `<p className="text-xs text-[#8A94A6]">Manage model catalogs and governance...</p>`).
   - The user operates primarily via Termius mobile SSH and mobile browsers while managing real-world operations: vertical screen real estate is precious. Jump straight into controls, filters, cards, and data tables.
3. **Strict Zero-Emoji Rule**:
   - Never output emojis in CLI, terminal text, logs, code, or web UI components.
   - Use Lucide React icons (`lucide-react`) or official inline SVGs for Web.
   - Use Nerd Font glyphs (e.g. `󰄬`, `󰀦`, `󰋼`, `󰚌`) or clean ASCII (e.g. `[warn]`, `[error]`) for terminal CLI and logs.
4. **Binary & PATH Coexistence**:
   - `bin/nexus` is the canonical CLI wrapper.
   - `bin/gn` is an exact duplicate executable retained for backward compatibility (`~/.local/bin/gn` links here).
   - **Never delete or move `bin/gn`**. If you modify `bin/nexus`, you must keep `bin/gn` identical.
5. **Layered Fallback Resolution**:
   - **Env vars**: Prefer `NEXUS_*` (e.g. `NEXUS_GATEWAY_PORT`), fallback to `GN_*`.
   - **Config file**: Check `~/.config/nexus/config.json` first, fallback to `~/.config/gn/config.json`.
   - **Cache & logs**: Check `~/.cache/nexus/` first, fallback to `~/.cache/gn/`.
   - **Endpoints**: Support dual paths (`/nexus/health` and `/gn/health`; `/nexus/stats` and `/gn/stats`).
   - **Telemetry DB**: SQLite store lives dynamically at `~/.cache/goblin-nexus/telemetry.db`. Never place `.sqlite` files inside `src/`.
6. **Git Discipline & Modular Commit Separation**:
   - **Zero unprompted commits**: Never run `git commit` or `git push` without explicit user instruction.
   - When instructed to commit, **separate changes into modular, atomic commits**:
     1. `feat(gateway)` or `fix(gateway)`: Backend logic, route endpoints, adapters, and tests.
     2. `feat(web)` or `fix(web)`: React frontend components, views, styles, and bundle builds.
     3. `chore(release)`: Version bump in `package.json`, `src/version.ts`, and `CHANGELOG.md`.
   - Commit trailers: Always include `--trailer "Co-authored-by: opencode-agent[bot] <219766164+opencode-agent[bot]@users.noreply.github.com>"`.
   - Use conventional commit format (<= 72 chars, lowercase, no emojis).

---

## 4. Testing & Reliability Invariants

1. **Strict Mocked / Ephemeral Tests (Zero Flaky Live Network Dependencies)**:
   - Backend tests reside in `tests/gateway/` (never put test files in `src/`).
   - Unit tests run via `bun test` must **NEVER fail due to offline environment, network jitter, or remote API rate-limits**.
   - Any test exercising external vendor endpoints (e.g. `commandcode`, `openrouter`, `ollama`) must:
     - Wrap live execution behind an `isAvailable()` check and exit cleanly (`return`) if credentials or network are absent.
     - Never make unmocked calls that cause `bun test` to hang or exceed 2000ms.
2. **Ephemeral Ports for Mock Upstreams**:
   - When creating integration tests with `GatewayServer`, bind mock upstreams to dynamic ephemeral ports (`mockServer.port`) instead of defaulting to `4000`, `4001`, or `4010` to prevent collisions with running background services.
3. **Test Fixtures**:
   - Test fixtures for replay testing live in `~/.config/nexus/fixtures/` (legacy fallback `~/.config/gn/fixtures/`).
   - Runtime test artifact `.tmp-test-gateway/` is gitignored and ephemeral.

---

## 5. Web Console Architecture & Frontend Standards (`web/`)

### Frontend Stack Non-Defaults

- **React 19 + Tailwind CSS v4** via `@tailwindcss/vite` plugin — **no PostCSS config, no `tailwind.config.*`**. Do not look for or create one.
- **shadcn/ui** with `radix-nova` style (`web/components.json`); `lucide-react` icons.
- **Path alias `@/` → `web/src/`** (`web/vite.config.ts`, `web/tsconfig.json`).
- **Vite `base: '/dashboard/'`** — the SPA is served by the Bun gateway at `:4010/dashboard/*`, not at Vite's default root. Dev server also serves under `/dashboard/`.
- `cn` utility is re-exported from `@/lib/utils.ts` (wraps the `cn` package), not a custom implementation.

### Keep-Alive View Snapshot Architecture (MANDATORY)

🔴 **CRITICAL**: Never render views with conditional destruction like `{activeNav === "x" && <View />}` or dynamic keys like `<div key={activeNav}>`.

All primary views must remain permanently mounted in the DOM to preserve user interaction state (active sub-filters, search queries, expanded accordions, scroll position):

```tsx
<main className="p-4 sm:p-8 space-y-6 max-w-5xl w-full mx-auto">
  <div className={activeNav === "overview-dashboard" ? "animate-page-enter" : "hidden"}>
    <DashboardView ... />
  </div>
  <div className={activeNav === "overview-leaderboard" ? "animate-page-enter" : "hidden"}>
    <LeaderboardView ... />
  </div>
  <div className={activeNav === "quota" ? "animate-page-enter" : "hidden"}>
    <QuotaView ... />
  </div>
  <div className={activeNav === "logs" ? "animate-page-enter" : "hidden"}>
    <LiveLogsView ... />
  </div>
</main>
```

### Visual Palette & Tokens

- Root Canvas: `#0E1117`
- Cards & Panels: `#131722`
- Sidebar & Header: `#121622` / `#0E1117` (with `backdrop-blur`)
- Border System: `#1E2433`
- Accent Primary: `#00EA88` (Goblin Emerald — live status, active tab, healthy quota)
- Accent Secondary: `#7AA2F7` (Tokyo Night Blue — input fresh token, session metrics)
- Accent Tertiary: `#A855F7` (Cache Purple — provider context cache)
- Warning: `#FBBF24` (Amber 400 — warning quota <= 50%)
- Critical: `#F43F5E` (Rose 500 — critical quota <= 20%, error requests)
- Typography: `@fontsource-variable/inter` for UI text, `@fontsource-variable/jetbrains-mono` for numbers, metrics, code, and timestamps.

### Module Organization Rules

1. **New Page Views**: Place strictly inside `web/src/components/views/`.
2. **Layout & Shell**: Place inside `web/src/components/layout/` (`Sidebar.tsx`, `TopHeader.tsx`).
3. **Icons & Charts**: `web/src/components/icons/` and `web/src/components/charts/`.
4. **Formatting & Math**: Extract strictly to `web/src/lib/formatters.ts` with comprehensive unit tests in `web/src/lib/formatters.test.ts`. Never define inline formatting logic inside React views.
5. **Data Contracts**: Single source of truth is `web/src/types/dashboard.ts`.

---

## 6. Systemd Service Quirks

- Canonical service unit: `gn-gateway.service` (alias `nexus-gateway.service`).
- `ExecStart` uses an explicit user home path `%h/civil/projects/nexusroute/...` (intentional for systemd user mode).
- When modifying systemd paths, `ReadWritePaths` must include:
  `%h/.config/nexus %h/.config/gn %h/.cache/nexus %h/.cache/gn %h/.cache/goblin-nexus %h/.bun`
  (systemd user mode does not auto-create directories outside `CacheDirectory`).
