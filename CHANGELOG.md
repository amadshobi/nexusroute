# Changelog — NexusRoute (`nexus`)

> Riwayat lengkap perubahan untuk **NexusRoute** (sebelumnya dikenal sebagai `gn` / Goblin Nexus).
> Format mengikuti [Keep a Changelog](https://keepachangelog.com/).

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
