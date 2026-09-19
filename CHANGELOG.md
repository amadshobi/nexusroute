# Changelog — NexusRoute (`nexus`)

> Full history of changes for **NexusRoute** (formerly `gn` / Goblin Nexus).
> Follows [Keep a Changelog](https://keepachangelog.com/).

---

## [1.8.1] - 2026-09-19

### Fixed

- **fix(gateway)**: Fallback chain abort isolation — each fallback candidate now uses a fresh `AbortController` (still propagating client `req.signal`), preventing a TTFB-timeout abort on the primary hop from instantly failing every fallback fetch with `AbortError`.
- **fix(gateway)**: Eliminated opaque 502 `Body already used` responses by synthesizing a deterministic JSON error payload (including the full fallback chain) when the primary body was canceled and all fallback candidates are exhausted.
- **fix(gateway)**: Marked the losing upstream fetch rejection as handled in the TTFB `Promise.race`, removing raw `AbortError` DOMException unhandled-rejection dumps from the journal; aborts are now logged as a single concise `[proxy] request aborted` line with structured context preserved in the access log.

---

## [1.8.0] - 2026-09-18

### Added

- **feat(gateway)**: Claude Code watermark & billing header sanitizer (`sanitizeClaudeCodeWatermarks`), stripping `x-anthropic-billing-header` blocks and client SDK identifiers that trigger upstream vendor filters (e.g. 429 `RESOURCE_EXHAUSTED` or 400 Bad Request on Google Cloud Code Assist / Antigravity).
- **feat(gateway)**: Resilient Gemini schema armor (`sanitizeSchemaForGemini`), ensuring multidimensional and nested array properties always include an `items` type definition required by Google Antigravity protobuf compiler.
- **feat(gateway)**: Anthropic `input_schema` normalization support for Gemini/Antigravity upstreams.
- **feat(web)**: Implemented `vibedesign` design token system (pure black `#0a0a0a` canvas, atmospheric ambient lighting glows, 1px top-light bevel inset reflection `.bevel-inset`, `.card-chassis`, and HSLA translucent surfaces).

### Fixed

- **fix(gateway)**: Poisoned cache prevention for streaming responses by verifying recorded SSE chunks are free of in-band error events (`event: error`, `"type":"error"`, `"status":"RESOURCE_EXHAUSTED"`) before committing to cache.
- **fix(gateway)**: Segregated prompt cache retrieval based on streaming mode (`isStreamReq`), preventing stream requests from retrieving non-streaming cached responses and vice versa.
- **fix(web)**: Resolved oxlint `exhaustive-deps` warnings in `LeaderboardView.tsx` with memoized data references.
- **fix(cli)**: Resolved `nexus doctor` cache directory resolution via `resolveDefaultCacheDir()`, eliminating false-positive cache path warnings.

### Refactored

- **refactor(cli)**: Enforced strict English-only and Zero-Emoji rules across CLI commands (`doctor`, `gateway`, `index`, `error`, `access-log`), replacing legacy emojis with standard Nerd Font glyphs and clean ASCII badges.

---

## [1.7.0] - 2026-09-15

### Added

- **feat(gateway)**: Historical period-over-period (PoP) comparison analytics for OpenCode SQLite telemetry (`src/gateway/routes/agents.ts`), computing deltas for spend, messages, tokens, cache rate, cache read, and fresh input across all time ranges.
- **feat(web)**: Re-architected subagent session inspector in `OpenCodeSection.tsx` into a high-density, clean developer table layout (`ROLE | MODEL | TOKENS | SPEND`) with horizontal scroll protection for mobile.
- **feat(web)**: Aligned Agents metric cards 1:1 with Dashboard layout (Row 1: Total Spend, Messages, Tokens, Cache Hit; Row 2: Cache Read, Fresh Input) featuring dynamic `TrendingUp` / `TrendingDown` indicators.
- **feat(web)**: Clean project folder extraction in `agent-metrics.ts` displaying project directories cleanly (e.g. `nexusroute` instead of full home paths).
- **feat(web)**: Robust parsing for JSON-serialized model IDs stored in OpenCode SQLite records in `formatModelDisplayName`.

### Removed

- **refactor(web)**: Pruned obsolete views (`HermesView.tsx`, `OpenCodeView.tsx`, `HermesSection.tsx`) and removed segmented agent filter tabs, streamlining `AgentsView.tsx` into a focused OpenCode/OpenChamber command center.

---

## [1.6.0] - 2026-09-15

### Added

- **feat(gateway)**: Period-over-period (PoP) trend analytics in `/api/dashboard/overview`, calculating historical comparison metrics (`spendDelta`, `requestsDelta`, `tokensDelta`, `cacheRateDelta`, `cacheReadDelta`, `inputFreshDelta`) for bounded time windows (`1h`, `today`, `yesterday`, `24h`, `7d`, `30d`).
- **feat(gateway)**: Dynamic 1-hour time filter (`1h`/`1H`) support in `parseTimeBounds` (`src/gateway/context.ts`).
- **feat(web)**: Period-over-period trend badges with directional indicators (`TrendingUp` / `TrendingDown`) across all overview metric cards with semantic coloring (amber for spend increases, emerald for cost savings and throughput growth).
- **feat(web)**: OpenRouter-inspired single-line Top Models list with dynamic heuristic-based display name formatting (`formatModelDisplayName`) and secondary slug tooltips.
- **feat(web)**: Indonesian Rupiah formatting enhancement (`formatIdr`) using official financial denominations (`jt` for millions, `M` for billions, `T` for trillions).
- **feat(web)**: Enhanced responsive mobile viewport handling with dynamic `100dvh` root height and breathing bottom padding (`pb-20 sm:pb-16`).

### Fixed

- **fix(web)**: Replaced static placeholder metric labels (`100%`, `Total`, `Provider`, `Fresh`) with real mathematical trend calculations.
- **fix(web)**: Resolved flexbox scroll container overflow clipping the bottom cards on mobile viewports.

---

## [1.5.0] - 2026-09-13

### Added

- **feat(gateway)**: 24-bucket time-series `activity` aggregation in `/api/dashboard/overview` with token breakdown (fresh input, cache read, output), cost, and provider/model decomposition.
- **feat(web)**: OpenRouter-style `ActivityStackedBarChart` component with multi-mode tabs (Tokens, Cost, Requests, Providers, Models), interactive hover tooltips, and mobile responsiveness.
- **feat(web)**: Integrated Activity Stacked Bar Chart into Dashboard and Leaderboard views with real-time currency sync and engine filtering.

## [1.4.0] - 2026-09-13

### Added

- **feat(gateway)**: Zero-dependency in-process `GatewayEventBus` (`src/gateway/context.ts`, `src/gateway/server.ts`) with subscribe/emit/subscriber-count and per-handler error isolation.
- **feat(gateway)**: Bun-native SSE stream endpoint `GET /api/gateway/events` (alias `GET /api/dashboard/events`) in `src/gateway/routes/dashboard.ts`, emitting `connected`, `request_complete`, and 15-second `heartbeat` events with idempotent cleanup.
- **feat(web)**: Real-time `useGatewayEvents` hook (`web/src/lib/useGatewayEvents.ts`) replacing aggressive 3-second HTTP polling with event-driven `request_complete` updates, reconnect backoff, and a relaxed fallback poll.
- **feat(web)**: Unified Agents Telemetry Hub (`web/src/components/views/AgentsView.tsx`) merging OpenCode and Hermes telemetry with segmented `All | OpenCode | Hermes` filters.
- **refactor(web)**: Master-Detail Provider Hub for model governance (Issue #1) in `ModelsControlView` / `ProviderModelDetail` with compact provider cards, search, bulk controls, and a full English-only string sweep.

## [1.3.0] - 2026-09-13

### Added

- **Traffic Intelligence & Leaderboard Analytics (`src/gateway/`, `web/src/`)**:
  - Auto-detection client application (`detectClientApp` di `src/gateway/provider-resolver.ts`) via header `x-client-app` / `x-app-name` dan heuristic `User-Agent` (OpenCode, Hermes, Claude Code, cURL, dll).
  - Real provider resolution (`resolveRealProvider`) yang membedakan provider model sesungguhnya (Antigravity, DeepSeek, Ollama, CommandCode) dari transport gateway (OMP, VansRouter, Direct).
  - Perekaman field `client`, `upstream`, dan `provider` secara terstruktur pada `AccessLogEntry` di `proxy.ts`.
  - Agregasi leaderboard pada endpoint `/api/dashboard/overview` meliputi `models` (reqs, tokens, avg latency, context cache rate, cost, sparkline denyut), `providers` (dengan indikator transport gateway `via OMP` / `Direct`), dan `clients`.
  - Komponen Web Console `LeaderboardSection.tsx` yang fully mobile-first responsive:
    - Tab switching: **Top Models**, **Top Providers**, dan **Clients / Apps**.
    - Segmented distribution header bar ala GitHub Language Bar untuk proporsi provider aktif.
    - Grafik batang bertingkat (progress bar gradient) dikombinasikan dengan sparkline denyut mini real-time per baris model/provider.
    - Sub-filter mesin model (All, Antigravity, CommandCode, OpenRouter, DeepSeek, Ollama).
    - Metrik kalkulasi Tokens Per Second (TPS / Speed) pada telemetry log inspector modal di `LiveLogsView.tsx`.
    - Badge client caller dan transport gateway pada tiap item log di `LiveLogsView.tsx`.

## [1.2.0] - 2026-09-12

### Added

- **CommandCode Direct Adapter Integration (`src/adapters/commandcode/`, `src/gateway/`)**:
  - Auto-register `commandcode` sebagai upstream resmi (`https://api.commandcode.ai/alpha`) pada Gateway saat API key tersedia di environment atau auth store (`~/.config/nexus/`, `~/.omp/agent/auth.json`, dll).
  - Injeksi langsung 69 model CommandCode dengan prefix canonical `cmc/` (mis. `cmc/deepseek/deepseek-v4-flash`, `cmc/claude-opus-5`) ke `/v1/models` catalog aggregator agar mudah dibedakan di OpenCode TUI dan mencegah tabrakan namespace.
  - Smart model resolution & prefix stripping di `proxy.ts`: merutekan model dengan prefix `cmc/`, `commandcode/`, maupun nama model asli langsung ke direct cloud adapter.
  - Normalisasi toleran whitelist/blacklist di `context.ts` sehingga entri whitelist lama tetap cocok secara otomatis baik dengan atau tanpa prefix `cmc/`.
  - Dedicated ping tree dan active probe support untuk `commandcode` di `/api/dashboard/ping/tree` dan `/api/dashboard/ping/probe`.
- **CommandCode Brand Assets & Web Console Synchronization (`web/src/`)**:
  - Penambahan asset SVG resmi `commandcode.svg` di `web/src/assets/` dan `web/src/assets/providers/`.
  - Registrasi `CommandCodeIcon` di `ProviderIcons.tsx` dengan auto-detection pada `GatewayIcon` dan `ProviderIcon`.
  - Integrasi label upstream `CommandCode Direct` pada `ModelsControlView.tsx` dan auto-expansion di `PingView.tsx`.
  - Peningkatan ekstraksi provider di `model-utils.ts` untuk memetakan keluarga model CommandCode ke brand masing-masing.
- **CommandCode Live Quota & Usage Monitor (`src/quota/providers/commandcode.ts`, CLI & Web Console)**:
  - Implementasi `CommandCodeQuotaProvider` yang terhubung langsung ke internal endpoint `https://api.commandcode.ai/alpha`:
    - `/alpha/whoami`: Autentikasi dan identifikasi akun pengguna (email, username).
    - `/alpha/billing/credits`: Window limits rolling 5-jam & mingguan, waktu reset ISO-8601, status exceeded, dan monthly credits.
    - `/alpha/usage/summary`: Akumulasi spend USD, token in/out, dan total requests.
  - Tampilan visual di CLI (`nexus quota`) lengkap dengan progress bar persentase sisa kuota dan countdown waktu reset.
  - Kartu quota Command Code resmi di Web Console (`QuotaView.tsx`) dengan brand icon dan rincian dollar spend/cap.
  - Provider accordion di `QuotaView.tsx`: transisi buka-tutup super smooth berbasis CSS grid, state persistence di `localStorage` (`nexus_quota_expanded_providers`), dan default collapsed saat pertama dibuka.
  - Penyaringan otomatis teks narasi redundan Google Cloud Code ("You have used/hit...") pada kartu kuota tanpa menghilangkan angka limit nominal dollar CommandCode.
  - Kalibrasi stroke SVG CommandCode menjadi `#FFFFFF` agar kontras tinggi dan tajam di browser dark mode.

## [1.1.1] - 2026-09-12

### Fixed

- **Fast-fail Catalog Aggregation & Double-Fetch Elimination (`src/gateway/routes/models.ts`, `upstream-router.ts`)**:
  - Menghapus pemanggilan `ctx.getCatalog()` berulang di `handleModelsCatalog`: `catalogMap` kini langsung dibangun dari `responses` in-memory dan disinkronkan ke cache runtime via `updateCatalogCache()`.
  - Memangkas timeout fetch per-upstream dari `5000ms` menjadi `2000ms` (`UPSTREAM_TIMEOUT_MS`). Mengurangi durasi degradasi ketika salah satu upstream mati dari ~10 detik menjadi ~2 detik dan mencegah downstream client/plugin mengalami timeout abort.
  - Memastikan model dari upstream aktif (seperti VansRouter) tetap lolos filter dan langsung disajikan ke client meskipun upstream lain (seperti OMP) sedang offline.

## [1.1.0] - 2026-09-11

### Added

- **Multi-Model Provider Ping Engine & Batching Concurrency (`web/src/components/views/PingView.tsx`)**:
  - Tombol Ping pada level Provider kini memicu pengecekan live ke **seluruh model** di bawah provider tersebut secara paralel (concurrency queue limit = 3 untuk mencegah HTTP 429).
  - Auto-expand accordion saat probe provider dimulai agar pengguna dapat memantau spinner aktif di tiap model secara real-time.
  - Aggregasi summary status di banner atas: `Provider (X/Y OK • Avg latency ms)`.
- **Health Ping Synchronization Wizard in Model Governance (`web/src/components/views/models/`)**:
  - Tombol **"Sync with Ping"** pada `ProviderModelDetail`: secara cerdas mengaktifkan model sehat (HTTP 200 OK) ke whitelist dan menonaktifkan model yang gagal (HTTP non-200), sementara model yang belum pernah di-ping dipertahankan status aktifnya.
  - Live latency badge per-model di `ProviderAccordion` menampilkan status HTTP dan latency terkini (`120ms` atau `FAIL`) yang dibaca langsung dari snapshot cache.
- **Unified Nexus Cyber Emerald Favicon & Brand Icon**:
  - Sinkronisasi 1:1 antara favicon browser tab (`web/public/favicon.svg`) dan icon brand Sidebar (`NexusIcon`), mengadopsi geometric cyber bolt dengan palette emerald neon (`#00FFA3` ➔ `#00EA88` ➔ `#059669`) dan specular sheen.

### Changed

- **Navigation & Page Label Simplification (`web/src/components/layout/`)**:
  - Merampingkan nama navigasi menjadi 1 kata minimalis:
    - `Live Logs` ➔ **`Logs`**
    - `Ping Monitor` ➔ **`Ping`**
    - `Quota Monitor` ➔ **`Quota`**
- **Dark Mode Provider Icon Visibility & Color Calibration (`web/src/assets/`, `ProviderIcons.tsx`)**:
  - Memperbaiki rendering icon yang sebelumnya gelap/hitam akibat isolasi `currentColor` pada tag `<img>`:
    - **Google Gemini**: Gradasi resmi Gemini Blue-Purple-Rose (`#4285F4` ➔ `#9B72CB` ➔ `#D96570`).
    - **Anthropic Claude**: Authentic terracotta coral `#CC785C`.
    - **Xiaomi Mimo**: Vibrant brand orange `#FF6900`.
    - **Ollama**: Kontras tinggi dengan siluet putih `#FFFFFF` dan detail `#131722`.

### Removed

- **Redundant Global Blacklist Card in Model Governance (`ModelsControlView.tsx`)**:
  - Menghapus card input teks manual "Global Blacklist" di bawah kartu gateway; manajemen model kini bersih dan terpusat di halaman detail "Kelola Model" per-upstream.

---

## [1.0.0] - 2026-09-11

### Added

- **Kelahiran Baru NexusRoute (Standalone Independence & Rebranding)**:
  - Ekstraksi mandiri dari Goblin Vault monorepo (`tools-cli/src/gn/`) menjadi standalone repository **`nexusroute`** dengan Semantic Versioning fresh dimulai dari **`v1.0.0`**.
  - Binary CLI kanonik baru: `bin/nexus` dengan shell launcher pendamping `nexus.sh`.
  - Service daemon systemd kanonik: `nexus-gateway.service` dengan konfigurasi sandboxing ketat (`ProtectSystem=strict`, `LimitNOFILE=65536`, `CacheDirectory=nexus nexus-gateway`).
  - Terminal ASCII Art Banner baru `NEXUSROUTE` Unicode Block tebal di `src/utils/formatter.ts`.
- **Arsitektur Gateway Modular (`src/gateway/`)**:
  - Memecah file monolitik `server.ts` (2.300+ baris) menjadi modul-modul terisolasi:
    - `src/gateway/server.ts`: Slim orchestrator dan dispatcher siklus hidup `Bun.serve`.
    - `src/gateway/context.ts`: Shared runtime context contract (`GatewayContext`).
    - `src/gateway/routes/proxy.ts`: SSE streaming proxy hot-path, deterministic SHA-256 prompt caching, cancellation propagation, dan cascading fallback.
    - `src/gateway/routes/dashboard.ts`: REST API endpoints untuk Web Console (`/api/dashboard/*`).
    - `src/gateway/routes/models.ts`: Filtering katalog `/v1/models`, whitelist per-upstream, dan global blacklist.
    - `src/gateway/routes/ping-probe.ts`: Hierarchical ping tree inspection dan live health latency probes.
    - `src/gateway/routes/agents.ts`: Telemetry ingestion dan SQLite queries untuk OpenCode & Hermes.
    - `src/gateway/routes/static.ts`: High-performance static SPA server untuk Web Console (`web/dist/`).
- **Flattened Top-Level CLI Commands (`src/index.ts`, `src/commands/gateway.ts`)**:
  - Menghilangkan nesting panjang `nexus gateway <subcmd>` menjadi perintah langsung di root:
    - `nexus start` : Menjalankan proxy gateway daemon di port `:4010`.
    - `nexus stop` : Menghentikan instance gateway aktif.
    - `nexus status`: Pemeriksaan kesehatan gateway live.
    - `nexus stats` : Metrik real-time cache hit rate, requests, dan streaming.
    - `nexus logs` : Audit live streaming log akses dan riwayat fallback.
    - `nexus cache` : Prune atau bersihkan prompt cache.
    - `nexus quota` : Monitor kuota multi-provider.
    - `nexus doctor`: Diagnostik full-chain kesehatan sistem & dependensi.
    - `nexus restart`: Restart daemon user systemd.
    - `nexus record <name>`: Merekam traffic ke fixture JSONL deterministik.
    - `nexus mock <name>` : Replay offline fixture JSONL tanpa koneksi upstream.
- **Unified Quota CLI Engine (`src/commands/quota.ts`)**:
  - Implementasi CLI baru yang mendelegasikan langsung ke `src/quota/registry.ts` sebagai Single Source of Truth bersama Web Console.
  - Tampilan visual quota cards dengan status bar real-time tanpa data matematis palsu.
- **CommandCode Direct Adapter Schema Alignment (`src/adapters/commandcode/`)**:
  - Normalisasi OpenAI tools call ke CommandCode envelope translator (`request-translator.ts`).
  - Multi-source hybrid API key auto-discovery: `COMMANDCODE_API_KEY` env -> `~/.config/nexus/` -> `~/.commandcode/auth.json` -> `~/.9router/db/data.sqlite` -> `~/.omp/agent/auth.json`.

### Changed

- **Layered Backward Compatibility Resolution**:
  - Dukungan binary ganda: `bin/nexus` (kanonik) dan `bin/gn` (alias symlink aktif untuk host PATH `~/.local/bin/gn`).
  - Dual HTTP Health & Stats Endpoints: `/nexus/health` + `/gn/health`, `/nexus/stats` + `/gn/stats`.
  - Dual Cache Headers: `X-Nexus-Cache` + `X-GN-Cache`, `x-nexus-no-cache` + `x-gn-no-cache`.
  - Config & Cache Layering: `~/.config/nexus/` (prioritas 1) -> `~/.config/gn/` (fallback legacy); `~/.cache/nexus/` -> `~/.cache/gn/`.
- **Backend Tests Relocation**:
  - Memindahkan seluruh suite pengujian backend dari `src/gateway/` ke direktori root `tests/gateway/` agar `src/` murni berisi runtime code.
- **Documentation Overhaul**:
  - Pembaruan menyeluruh `README.md`, pembuatan root `AGENTS.md`, serta pembersihan path monorepo lama pada `web/README.md` dan `web/AGENTS.md`.

### Removed

- **Dead Weight Artifacts & Obsolete Scripts**:
  - Menghapus file legacy yang sudah digantikan: `help-formatter.sh`, `gn.sh`, `gn-gateway.service`, `src/gateway/telemetry.sqlite`, `storage/history.json`, dan `storage/output.md`.
  - Menghapus subcommand kuno dan dependensinya: `bench.ts`, `ping.ts`, `usage.ts`, `config.ts`, `sessions.ts`, `omp-quota.ts`, `paths.ts`, `opencode-cli.ts`, `ping-config.ts`.
  - Menghapus dependensi usang `@clack/prompts`.

---

## [v2.3.0] - 2026-09-10

### Added

- **Model Governance & Routing Control Center (`gateway/server.ts`, `gateway/rules.ts`, `web/src/`)**:
  - Halaman **Model Governance & Routing** di Web Console sebagai pusat kontrol katalog model upstream, whitelist aktif untuk coding agent, dan isolasi blacklist.
  - **Provider Cards Overview**: kartu per-upstream (`OMP Gateway`, `Vans Gateway`) menampilkan total model katalog, jumlah model aktif, dan progress bar; badge `All Active (Passthrough)` ditampilkan ketika upstream belum memiliki whitelist.
  - **Provider Model Governance Detail**: editor whitelist per-upstream dengan search bar, aksi massal `Active All` / `Disable All`, daftar model aktif yang mudah di-nonaktifkan, serta catalog pool berupa pill `+ modelId` untuk menambahkan model ke whitelist.
  - **Global Blacklist (Block & Reject)**: input dan chip model terlarang; model di daftar ini ditolak langsung oleh proxy dengan **HTTP 403** (`model_blacklisted`) dan disembunyikan dari `/v1/models`.
  - **Per-upstream whitelist management** untuk OMP dan VansRouter melalui `PUT /api/dashboard/models/whitelist` (semantik backend: whitelist kosong = passthrough, semua model lolos).
  - **Filtered `/v1/models` catalog**: katalog gabungan disaring oleh whitelist per-upstream dan blacklist global agar resolusi model coding agent lebih bersih.
  - Endpoint model governance: `GET /api/dashboard/models/config`, `GET /api/dashboard/models/catalogs`, `PUT /api/dashboard/models/whitelist`, `PUT /api/dashboard/models/blacklist`.

### Changed

- **Gateway Config Path Override (`gateway/rules.ts`)**: `getUserConfigPath()` kini menghormati env `GN_CONFIG_PATH` dan di-resolve lazily per pemanggilan, sehingga test dapat mengarahkan persistensi ke direktori temporary tanpa menyentuh `~/.config/gn/config.json`.

### Testing

- **Model Filter & CRUD Endpoint Suite (`gateway/models-filter.test.ts`)**: 12 automated test mencakup semantik whitelist/blacklist (passthrough vs restricted vs blocked), seluruh endpoint `/api/dashboard/models/*`, penyaringan `/v1/models`, dan penolakan proxy HTTP 403, dengan isolasi `GN_CONFIG_PATH` ke temporary directory.

---

## [v2.2.1] - 2026-09-09

### Added

- **Hierarchical Ping Monitor & Live Probe Engine (`src/commands/ping.ts`, `server.ts`, `web/`)**:
  - Menghadirkan engine `gn ping` ke Web Console dalam tab baru **Ping Monitor** (di section `MONITOR`, tepat di atas `Quota Monitor` dengan icon `FlaskConical`).
  - Arsitektur pohon bertingkat: **Gateway** (`OMP Gateway :4000`, `Vans Gateway :20128`) -> **Provider** (`google-antigravity`, `openrouter`, `cmc`, `gh`, dll) -> **Model ID**.
  - Tombol aksi ping berupa **pure icon-only** (`FlaskConical`) tanpa teks, transparan dengan border yang menyesuaikan tema, tanpa tanda kurung siku `[]`, dan bebas dari emoji.
  - Spinner interaktif berputar di tombol saat request probe sedang berlangsung.
  - **Floating Output Terminal Popup**:
    - Popup melayang di pojok kanan bawah dengan tombol `X` di kanan atas (tidak auto-close).
    - Log tersusun ke bawah di mana log baru mendorong log lama ke atas secara vertikal.
    - Format output: `• 200 - 184ms - <modelid>` (Hijau untuk status 200, Merah untuk selain 200).
    - Bagian bawah memuat panduan status standar HTTP API dalam bahasa Inggris (`200 OK`, `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `429 Too Many Requests`, `500 Internal Error`, `504 Gateway Timeout`).
  - Endpoint baru di backend gateway:
    - `GET /api/dashboard/ping/tree`: Menghasilkan pohon Gateway -> Provider -> Model secara dinamis dari catalog upstream.
    - `POST /api/dashboard/ping/probe`: Menjalankan test ping terisolasi untuk probe gateway port, sampel model provider, atau model spesifik dengan latency pengukuran presisi ms.
- **Keep-Alive View Snapshot & In-Session Tab State Preservation (`web/src/App.tsx`)**:
  - Mengubah rendering tab SPA dari yang sebelumnya unmount komponen (`key={activeNav}`) menjadi Keep-Alive container (`animate-page-enter` vs `hidden`).
  - Menjaga seluruh status interaktif per-halaman tetap utuh (_snapshot preservation_) saat berpindah tab (Dashboard, OpenCode, Live Logs, Settings).
  - Memisahkan state filter waktu menjadi `viewTimeRanges` per-halaman (`overview-dashboard`, `overview-opencode`, `overview-hermes`).
- **Server-Side Full-Window Sparklines & Range-All Fix (`gateway/server.ts`, `web/src/`)**:
  - Endpoint `/api/dashboard/overview` kini menghitung langsung 10 bucket sparkline waktu presisi (`cost`, `req`, `tokens`, `cacheRead`, `inputFresh`) di sisi backend.
  - Mengintegrasikan pembacaan cache historis dari `opencode.db` ke dalam bucket sparkline `cacheRead`.
  - Mengamankan endpoint `/api/dashboard/logs` dengan default limit 150 entri ketika polling agar transfer network tetap ringan (<40KB).
- **Real Provider Context Caching & Sparklines (`web/`, `gateway/server.ts`)**:
  - Mengganti metrik pasif HTTP cache dengan **Real Provider Context Cache** yang dihitung dari agregasi token streaming & database OpenCode/Hermes.
  - Kartu sparkline real-time: **Cache Read** (`#A855F7`) dan **Input Asli** (`#7AA2F7`).
- **Modern Developer Typography & Chronological Log Stream (`web/`)**:
  - Pasang **`@fontsource-variable/inter`** (`font-sans`) dan **`@fontsource-variable/jetbrains-mono`** (`font-mono`).
  - Mengaktifkan OpenType features `tnum` (tabular numbers) dan `ss01`/`ss02`.
  - Urutan tampilan log di `LiveLogsView` descending (`b.ts - a.ts`).
- **True Database-Level Time Range Filtering (`gateway/server.ts`, `web/src/App.tsx`)**:
  - Endpoint `/api/dashboard/overview` dan `/api/dashboard/agents` mendukung parameter `?range=`.
- **Dynamic Zero-Hardcode Time-Series Sparklines (`web/src/`)**:
  - Utility time-series bucket dinamis (`computeTimeSeriesBuckets`) di `formatters.ts`.
- **Per-Request Token Analytics in Access Log (`gateway/access-log.ts`, `gateway/server.ts`, `web/src/`)**:
  - Rekam metrik token per request (`tokensInput`, `tokensOutput`, `tokensCache`, `tokensTotal`) langsung ke `access.jsonl`.
- **Lifecycle Session-Scoped Log Streaming (`gateway/access-log.ts`, `gateway/server.ts`)**:
  - Filter `since?: number` pada `AccessLogFilter` dan query parameter `/api/dashboard/logs`.

### Changed

- **React 19 Purity & Oxlint Cleanliness (`web/src/`)**:
  - `MiniSparkline.tsx`: Menggunakan `useId()` bawaan React untuk menghasilkan ID SVG linear-gradient yang stabil.
  - `TopHeader.tsx`: Indikator koneksi dinamis (`Live` vs `Offline`).
- **Dead Code Cleanup & Metadata (`web/`)**:
  - Membersihkan boilerplate CSS Vite yang tidak terpakai di `src/App.css`.

---

## [v2.2.0] - 2026-09-08

### Added

- **Hybrid Multi-Upstream Router (`gateway/server.ts`, `gateway/upstream-router.ts`)**:
  - Gateway (`:4010`) me-route request ke beberapa upstream: **OMP Gateway (`:4000`)** dan **VansRouter (`:20128`)**.
  - Routing bersifat catalog-driven: model di-resolve ke upstream yang mempublikasikan model tsb di `/v1/models`.
  - Modul baru `gateway/upstream-router.ts`: `buildUpstreamUrl`, `parseModelIds`, `resolveUpstreamForModel`, `mergeModelResponses`, `collectCatalogs`.
- **Unified `/v1/models` Aggregator (`gateway/server.ts`)**:
  - Intercept `GET /v1/models`, menggabungkan catalog kedua upstream dengan header `X-GN-Upstreams`.
- **Upstream API Key Auto-Resolution (`gateway/upstream-router.ts`)**:
  - Zero-config: key VansRouter dibaca langsung dari DB `~/.9router/db/data.sqlite`.

---

## [v2.1.4] - 2026-09-01

### Fixed

- **Anthropic Messages Endpoint Streaming Guard (`gateway/server.ts`)**:
  - Deteksi endpoint `isMessagesReq` (`/messages`) pada streaming response handler.
  - Mematikan injeksi synthetic OpenAI completion usage chunk pada endpoint Anthropic Messages.

---

## [v2.1.3] - 2026-08-29

### Fixed

- **Systemd NAMESPACE Failure**:
  - Mengganti `ReadWritePaths` untuk direktori cache dengan directive `CacheDirectory=gn goblin-nexus`.
  - Chain diselaraskan: `opencode → gateway:4010 → omp auth-gateway:4000`.

---

## [v2.1.2] - 2026-08-28

### Added

- **CommandCode Tool Normalizer (`gateway/sanitizer.ts`)**:
  - Auto-normalisasi tools OpenAI standard ke schema Anthropic untuk endpoint `commandcode.ai`.
- **Synthetic SSE Usage Injector (`gateway/server.ts`)**:
  - Injeksi chunk `usage` standar OpenAI di akhir stream SSE jika upstream tidak mengirimkan token usage.

---

## [v2.1.1] - 2026-08-26

### Added

- **Structured Access Logger & Live Analytics (`gateway/access-log.ts`)**:
  - Append-Only JSONL Access Logger ke `access.jsonl`.
  - Cascading Fallback Hop Visualization (`✖ kilo-auto (503) → ✓ minimax-m3`).
  - CLI `gateway logs` subcommand dengan streaming & filtering.

### Fixed

- **Typecheck Pipeline & Strict Types**:
  - Perbaikan `tsconfig.json` dan 46 hidden type errors.
  - `computePromptHash` v2 dengan parameter lengkap.

---

## [v2.1.0] - 2026-08-24

### Added

- **`gn gateway` Interceptor Core Engine**:
  - Bun HTTP/SSE proxy di port 4010 dengan passthrough streaming SSE.
  - Deterministic SHA-256 prompt caching dengan auto-pruning.
  - Privacy Shield regex sanitization & secret masking.
  - Cascading fallback & circuit breaker (3 failures -> 60s cooldown).
  - Fixture recording & offline replay engine.

---

## [v2.0.2] - 2026-08-18

### Added

- **Speed Leaderboard & Visual Matrix (`commands/bench.ts`)**:
  - Throughput gauge bar dinamis dengan kalkulasi tok/s.
- **Tree-Structured Diagnostic for Doctor (`commands/doctor.ts`)**:
  - Kategori Daemons, Databases, Auth Matrix, dan Storage.

---

## [v2.0.0] - 2026-08-09

### Added

- **TypeScript Native CLI Engine Architecture**:
  - Port total core dari Shell Script raksasa ke TypeScript modular berbasis Bun runtime.
  - Formatter murni dengan dukungan Nerd Font icons.
  - Daily Tokens & Subagent Tree Activity Engine (`~/.omp/agent/agent.db`).
- **Fuzzy Levenshtein Error Matcher** di `src/utils/error.ts`.

---

## [v0.3.15] s/d [v0.3.0] - Juli 2026

- **Early Goblin Nexus Iterations**:
  - Shell-based interceptors, ASCII art banner generators, Ollama Cloud scraper, multi-role prompts, and dynamic pool switching.
