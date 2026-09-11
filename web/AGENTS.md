# AGENTS.md — NexusRoute Web Dashboard Architecture & Design Standard

> Pedoman, wawasan teknis, dan panduan baku pengembangan frontend SPA **NexusRoute (`nexus`) Console**.
> Dokumen ini wajib dibaca dan dipatuhi oleh semua AI agent, subagent, dan pengembang yang memodifikasi, menambah adapter, atau merombak UI/UX pada proyek web ini.

---

## 1. Filosofi & Visi Proyek

NexusRoute Web Console adalah command center visual untuk memantau aktivitas gateway proxy LLM lokal, kuota multi-provider (Google Cloud Code / Antigravity, Claude, DeepSeek), telemetri agen otonom (OpenCode & Hermes), dan manajemen rute model AI.

### Prinsip Desain Utama

- **Developer-First & Zero-Gimmick**: Tampilan bersih, padat, dan fungsional ala Linear.app, Raycast, atau Grafana.
- **Strict No Emojis**: Dilarang keras menggunakan emoji di seluruh elemen UI (teks kartu, tabel, badge, tombol, dialog, alert, placeholder). Simbol visual hanya boleh menggunakan **Lucide React Icons** atau **Official Inline SVGs**.
- **Dark Mode Exclusive Palette**:
  - Root App Canvas: `#0E1117`
  - Cards & Panels: `#131722`
  - Sidebar & TopHeader Surface: `#121622` / `#0E1117` (dengan `backdrop-blur`)
  - Border System: `#1E2433`
  - Subtle Hover / Input Surface: `#161B26` / `#1A2030`
  - Primary Accent: `#00EA88` (Goblin Emerald — live status, active tab, ok quota)
  - Secondary Accent: `#7AA2F7` (Tokyo Night Blue — input fresh token, session metrics)
  - Tertiary Accent: `#A855F7` (Cache Purple — provider context cache)
  - Warning Accent: `#FBBF24` (Amber 400 — warning quota <= 50%)
  - Critical Accent: `#F43F5E` (Rose 500 — critical quota <= 20%, error requests)
  - Text Heading & Values: `#FFFFFF`
  - Text Body & Labels: `#94A3B8` / `#8A94A6`
  - Text Muted & Timestamps: `#64748B`

---

## 2. Struktur Direktori & Peta Komponen

```
web/
├── src/
│   ├── assets/              # SVG brand icons (antigravity, google, anthropic, hero)
│   ├── components/
│   │   ├── charts/          # MiniSparkline.tsx (SVG vector sparkline renderer)
│   │   ├── common/          # TimeFilterBar.tsx (sliding pill time filter selector)
│   │   ├── icons/           # ProviderIcons.tsx (SVG icon wrappers)
│   │   ├── layout/          # Sidebar.tsx, TopHeader.tsx
│   │   ├── ui/              # shadcn primitives (badge, button, card, sheet, switch, table, tabs)
│   │   └── views/           # Halaman utama (Keep-Alive views):
│   │       ├── DashboardView.tsx       # Macro gateway telemetry & spend
│   │       ├── OpenCodeView.tsx        # Sesi per-project dari opencode.db
│   │       ├── HermesView.tsx          # Sesi dari ~/.hermes/state.db
│   │       ├── QuotaView.tsx           # Multi-account provider quota hierarchy
│   │       ├── LiveLogsView.tsx        # Chronological request inspector
│   │       ├── GatewayControlView.tsx  # Service health & restart control
│   │       └── ModelsControlView.tsx   # Model whitelist/blacklist & cascade combos
│   ├── lib/
│   │   ├── formatters.ts    # Single source of truth untuk format angka, waktu, & bucket sparkline
│   │   ├── formatters.test.ts # Unit test formatters (bun test)
│   │   └── utils.ts         # cn() utility helper (clsx + tailwind-merge)
│   ├── types/
│   │   └── dashboard.ts     # Single source of truth untuk seluruh TypeScript interfaces & contracts
│   ├── App.tsx              # Root state orchestrator & Keep-Alive container
│   ├── index.css            # Tailwind v4 theme, keyframe animations, & tabular font settings
│   └── main.tsx             # DOM entrypoint
├── public/                  # Static assets & favicons
├── dist/                    # Output bundle hasil tsc -b && vite build
├── package.json
└── vite.config.ts
```

### Aturan Penempatan Modul

1. **View Komponen Baru**: Wajib dibuat di `src/components/views/`.
2. **Komponen Pembantu / Shared**: Masuk ke `src/components/common/`.
3. **Format Angka / Waktu**: Wajib diekstraksi ke `src/lib/formatters.ts` lengkap dengan unit test di `formatters.test.ts`. Jangan membuat fungsi formatting lokal tersembunyi di dalam view.
4. **Types & Interfaces**: Semua model data backend wajib didefinisikan di `src/types/dashboard.ts`.
5. **UI Primitives (`src/components/ui/`)**: Berisi komponen shadcn murni, hindari modifikasi langsung kecuali styling dasar.

---

## 3. Standar Tipografi, Layout, & Resep Tailwind v4

### Font Developer & OpenType Features

- **UI / Teks Antarmuka**: `@fontsource-variable/inter` (`font-sans`).
- **Angka, Metrik, Jam, & Kode**: `@fontsource-variable/jetbrains-mono` (`font-mono`).
- **Tabular Numbers (`tnum`)**: Semua digit metrik dan jam wajib sejajar vertikal:
  ```css
  font-feature-settings:
    "tnum" 1,
    "ss01" 1,
    "ss02" 1;
  ```

### Format Mata Uang (IDR & USD)

- **USD**: Menggunakan simbol `$`, 2 desimal (misal: `$1,234.56`).
- **IDR (Standar Singkatan Indonesia)**: Wajib format shorthand `rb` (ribu), `jt` (juta), `M` (miliar), `T` (triliun) tanpa spasi setelah prefix `Rp`:
  ```ts
  // Standar baku formatIdr() di DashboardView:
  Rp19.95jt   // BENAR
  Rp1.20M     // BENAR
  Rp450.5rb   // BENAR
  Rp 19.95 jt // SALAH (ada spasi)
  IDR 19.9M   // SALAH (gunakan prefix Rp)
  ```

### Resep Styling Kartu Metric (Card Class Recipe)

Gunakan kombinasi kelas Tailwind standar berikut untuk menjaga konsistensi visual:

```html
<div
  className="group rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-200 animate-card-enter stagger-N"
>
  <!-- Card Header -->
  <div className="flex justify-between items-start">
    <span className="text-xs font-medium text-[#8A94A6]">Metric Title</span>
    <span className="text-[11px] font-medium text-[#7AA2F7]">Badge</span>
  </div>
  <!-- Value -->
  <div className="mt-2 mb-1">
    <span className="text-2xl font-bold tracking-tight text-white font-mono">
      Value
    </span>
  </div>
  <!-- MiniSparkline -->
  <MiniSparkline data="{sparklineData}" color="#10B981" />
</div>
```

### Standar Grid Layout

- **Top-Row Macro Metrics**: `grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4`
- **Second-Row Sparklines**: `grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4`
- **Quota Accounts & Groups**: `grid grid-cols-1 md:grid-cols-2 gap-3`
- **Text Selection Highlight**: `selection:bg-[#1D68FE] selection:text-white`

---

## 4. Sistem Animasi CSS & Keyframes

File `src/index.css` mendefinisikan sistem animasi performan dengan kurva akselerasi `cubic-bezier(0.16, 1, 0.3, 1)`:

### Keyframes & Utility Classes

1. **`animate-page-enter` (`@keyframes pageEnter`)**:
   - Durasi: `0.35s ease-out forwards`
   - Efek: `opacity: 0 -> 1`, `translateY: 8px -> 0`, `filter: blur(3px) -> blur(0)`
   - Penggunaan: Pembungkus setiap view aktif pada Keep-Alive container.
2. **`animate-card-enter` (`@keyframes cardEnter`)**:
   - Durasi: `0.45s cubic-bezier(0.16, 1, 0.3, 1) both`
   - Optimasi GPU: `will-change: transform, opacity, filter`
   - Efek: `opacity: 0 -> 1`, `translateY: 12px -> 0`, `scale: 0.985 -> 1`, `filter: blur(4px) -> blur(0)`
   - Penggunaan: Kartu-kartu metrik di Dashboard, OpenCode, dan Hermes.
3. **Cascading Stagger Classes**:
   - `.stagger-1` : `animation-delay: 40ms`
   - `.stagger-2` : `animation-delay: 80ms`
   - `.stagger-3` : `animation-delay: 120ms`
   - `.stagger-4` : `animation-delay: 160ms`
   - `.stagger-5` : `animation-delay: 200ms`
   - `.stagger-6` : `animation-delay: 240ms`
4. **TimeFilterBar Sliding Pill**: Menggunakan elemen pill absolute `bg-[#1E2538]` dengan `transition-all duration-200 ease-out` yang mengikuti koordinat `offsetLeft` dan `offsetWidth` tombol yang aktif.

---

## 5. Keep-Alive View Snapshot Architecture (WAJIB)

> 🔴 **CRITICAL RULE**: DILARANG merender view dengan conditional destruction seperti `{activeNav === "x" && <View />}` atau membungkus area konten dengan dynamic key seperti `<div key={activeNav}>`.

### Kenapa?

Ketika komponen di-unmount oleh React, seluruh state interaksi pengguna (pilihan rentang filter waktu per-halaman, query pencarian, filter status, accordion project yang sedang di-expand, toggle mata uang, dan posisi scroll) akan hancur dan ter-reset ke default saat pengguna kembali ke halaman tersebut.

### Pola Baku Keep-Alive Container

Semua view utama harus tetap terpasang di DOM dan dikontrol visibilitasnya menggunakan kelas Tailwind (`animate-page-enter` vs `hidden`):

```tsx
<main className="p-4 sm:p-8 space-y-6 max-w-5xl w-full mx-auto">
  <div className={activeNav === "overview-dashboard" ? "animate-page-enter" : "hidden"}>
    <DashboardView ... />
  </div>
  <div className={activeNav === "overview-opencode" ? "animate-page-enter" : "hidden"}>
    <OpenCodeView ... />
  </div>
  <div className={activeNav === "overview-hermes" ? "animate-page-enter" : "hidden"}>
    <HermesView ... />
  </div>
  <div className={activeNav === "quota" ? "animate-page-enter" : "hidden"}>
    <QuotaView ... />
  </div>
  <div className={activeNav === "logs" ? "animate-page-enter" : "hidden"}>
    <LiveLogsView ... />
  </div>
  <div className={activeNav === "settings-gateway" ? "animate-page-enter" : "hidden"}>
    <GatewayControlView ... />
  </div>
  <div className={activeNav === "settings-models" ? "animate-page-enter" : "hidden"}>
    <ModelsControlView ... />
  </div>
</main>
```

### Snapshot Behavior Guidelines

1. **In-Session Persistence**: Saat pengguna berpindah antar tab (misal: Dashboard -> Quota -> Dashboard), state halaman sebelumnya harus 100% utuh seperti saat ditinggalkan.
2. **Per-View Time Filter**: Tiap view yang memiliki filter waktu (`Dashboard`, `OpenCode`, `Hermes`) memiliki snapshot `viewTimeRanges[viewKey]` masing-masing di `App.tsx`.
3. **Fresh Open / Hard Reload**: Saat tab browser baru dibuka pertama kali atau tombol refresh di TopHeader ditekan, seluruh halaman me-reset snapshot kembali ke default bersih (`all`).
4. **TopHeader Refresh Button**: Menjalankan Hard Reload (F5) via `window.location.reload()` dengan animasi muter visual 180ms.

---

## 6. Arsitektur State Management (3-Tier)

1. **Tier 1: App-Level Persistent State (`App.tsx`)**
   - Bertahan selama sesi browsing dan mengalir ke sub-views:
     - `activeNav`: Tab aktif (tersinkron ke URL hash `#` dan `localStorage`).
     - `viewTimeRanges`: Record snapshot filter waktu per-halaman (`{ "overview-dashboard": "all", ... }`).
     - `overview`, `quota`, `agents`, `logs`: Data payload dari backend.
     - `isOnline`, `loading`, `lastRefreshed`: Status konektivitas dan timestamp refresh.
     - `combos`, `whitelistedModels`, `blacklistedModels`: Konfigurasi rute gateway.
2. **Tier 2: View-Local Keep-Alive State (Komponen View)**
   - Bertahan otomatis saat pindah tab berkat Keep-Alive container:
     - `DashboardView`: Toggle mata uang `currency` (`USD` vs `IDR`).
     - `OpenCodeView`: Map accordion folder yang terbuka `openProjects`.
     - `LiveLogsView`: Input `searchQuery`, tombol filter `filterType`, dan log inspeksi modal `selectedLog`.
     - `QuotaView`: Clipboard feedback `copiedId`.
3. **Tier 3: Derived State (`useMemo`)**
   - Dihitung secara murni dari data:
     - `filteredLogs`: Hasil filter log berdasarkan `activeTimeRange`.
     - `llmLogs`: Sub-filter khusus endpoint chat completions.
     - Sparklines fallback: Dihitung dengan `computeTimeSeriesBuckets` jika data server kosong.

---

## 7. Siklus Hidup Polling, Error Handling, & Data Fetching

### Polling Cadence (3000ms)

- Background polling berjalan setiap 3000ms (`setInterval`) di `App.tsx`.
- Polling otomatis me-reset timer dan langsung memicu fetch baru ketika `activeNav` berpindah atau `viewTimeRanges[activeNav]` berubah.

### Parallel Request dengan `Promise.allSettled`

`fetchData()` memanggil 4 endpoint secara paralel:

```ts
const [ovRes, qRes, logRes, agentRes] = await Promise.allSettled([
  fetch(`/api/dashboard/overview${rangeQuery}`),
  fetch("/api/dashboard/quota"),
  fetch(`/api/dashboard/logs${rangeQuery}`),
  fetch(`/api/dashboard/agents${rangeQuery}`),
]);
```

- Kegagalan salah satu endpoint (misal `agents` down) tidak memblokir render data endpoint lainnya (`overview` & `logs`).
- Status badge `isOnline` ditentukan oleh `anySuccess` (jika minimal 1 endpoint berhasil merespons).

---

## 8. Spesifikasi Lengkap Kontrak API Gateway

| Endpoint                         | Method | Query Parameters                                  | Response Shape                                                 | Deskripsi                                                                      |
| -------------------------------- | ------ | ------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/api/dashboard/overview`        | GET    | `?range=15m\|today\|yesterday\|24h\|7d\|30d\|all` | `OverviewData`                                                 | Metrik makro, spend USD, token context cache, dan 10-bucket sparklines presisi |
| `/api/dashboard/quota`           | GET    | none                                              | `QuotaResponse`                                                | Hierarki kuota live multi-account dari Antigravity CCA API                     |
| `/api/dashboard/logs`            | GET    | `?range=...&limit=N&since=ts&all=true`            | `{ logs: LogEntry[], count: number, uptimeStartTime: number }` | Log request gateway terbaru (default limit 150 entri)                          |
| `/api/dashboard/agents`          | GET    | `?type=all\|opencode\|hermes&range=...`           | `AgentsData`                                                   | Sesi, pesan, token, dan biaya dari SQLite OpenCode & Hermes                    |
| `/api/dashboard/ping/tree`       | GET    | none                                              | `PingTreeResponse`                                             | Pohon hirarki dinamis Gateway -> Provider -> Model katalog upstream            |
| `/api/dashboard/ping/probe`      | POST   | Body: `{ type, gateway, provider?, modelId? }`    | `PingProbeResponse`                                            | Eksekusi live test ping latency & health status model/gateway                  |
| `/api/dashboard/control/gateway` | POST   | Body: `{ action: "restart" }`                     | `{ ok: boolean, message: string }`                             | Sinyal restart daemon service gateway                                          |

### Catatan Penanganan Dual Format Logs

Endpoint `/api/dashboard/logs` mengembalikan object `{ logs: [...], count }`. Frontend `App.tsx` memiliki guard dual format:

```ts
setLogs(Array.isArray(data) ? data : data.logs || []);
```

---

## 9. Arsitektur Kuota & Rendering Specifications

### Hierarki Data Kuota

```
QuotaResponse
└── providers: ProviderQuotaResult[]
    └── accounts: AccountQuota[]
        ├── email: string
        └── groups: QuotaGroup[]
            ├── displayName: string (misal: "Gemini 2.5 Flash", "Claude 3.7 Sonnet")
            └── buckets: QuotaBucket[]
                ├── displayName: string
                ├── remainingFraction: number (0.0 s/d 1.0)
                ├── window: string (misal: "1 Day Window")
                └── resetTime: string (ISO-8601 timestamp)
```

### Threshold Warna Kuota

Progress bar dan badge kuota di `QuotaView.tsx` menggunakan threshold ketat:

- **`remainingFraction <= 0.2` (Kritis / Sisa <= 20%)**:
  - Warna: `bg-rose-500 text-rose-400 border-rose-500/30`
  - Status: Critical
- **`remainingFraction <= 0.5` (Peringatan / Sisa <= 50%)**:
  - Warna: `bg-amber-400 text-amber-300 border-amber-500/30`
  - Status: Warning
- **`remainingFraction > 0.5` (Aman / Sisa > 50%)**:
  - Warna: `bg-[#00EA88] text-[#00EA88] border-[#00EA88]/30`
  - Status: OK

### Format Waktu Reset (`formatRelativeTime`)

Waktu reset kuota dihitung relatif terhadap waktu lokal:

- `< 1 jam` -> `Xm` (misal: `42m`)
- `>= 1 jam & < 24 jam` -> `Xh Ym` (misal: `3h 15m`)
- `>= 24 jam` -> `Xd Yh` (misal: `1d 4h`)
- Sudah lewat -> `ready`

---

## 10. Brand Assets & Provider Icons

- **Sumber Asset Provider**: Asset SVG resmi diadopsi langsung dari repositori monorepo **OpenCode** (`packages/ui/src/assets/icons/provider/`) dan profil provider **VansRouter** (`public/providers/`).
- File asset SVG resmi terletak di `src/assets/`:
  - `antigravity.svg` -> Google Cloud Code Antigravity
  - `google.svg` -> Google Gemini
  - `anthropic.svg` -> Anthropic Claude
  - `omp.svg` -> Oh-My-Pi Gateway
  - `vans.svg` -> VansRouter Gateway
  - `openrouter.svg` -> OpenRouter
  - `deepseek.svg` -> DeepSeek
  - `github.svg` -> GitHub Models / Copilot
  - `xiaomi.svg` -> Xiaomi Mimo
  - `ollama.svg` -> Ollama Cloud / Local
  - `moark.svg` -> ByteDance ModelArk (`bpm` / BytePlus / Volcano Engine ModelArk)
  - `opencode.svg` -> OpenCode (`oc`)
  - `nvidia.svg` -> NVIDIA NIM (`nvidia`)
- Komponen pembungkus di `src/components/icons/ProviderIcons.tsx`:
  - `GatewayIcon({ name })`: Resolves icon resmi OMP atau VansRouter.
  - `ProviderIcon({ name })`: Resolves icon provider (Antigravity, Google, Claude, OpenRouter, DeepSeek, GitHub, Xiaomi, Ollama, BPM, OpenCode, NVIDIA).
- Dilarang keras menggunakan CDN eksternal atau gambar bitmap resolusi rendah.

---

## 11. Extension Playbooks (Panduan Praktis)

### Playbook 1: Menambah Halaman / Tab View Baru

1. Buat file view baru di `src/components/views/NamaView.tsx`.
2. Buka `src/App.tsx`:
   - Tambahkan key baru ke `VALID_NAVS` (misal: `"analytics"`).
   - Tambahkan default time range di `viewTimeRanges` jika view mendukung filter rentang waktu.
   - Tambahkan div pembungkus Keep-Alive di dalam `<main>`:
     ```tsx
     <div className={activeNav === "analytics" ? "animate-page-enter" : "hidden"}>
       <AnalyticsView ... />
     </div>
     ```
3. Buka `src/components/layout/TopHeader.tsx`:
   - Tambahkan mapping judul di `getHeaderTitle(nav)` (misal: `case "analytics": return "Analytics Center";`).
4. Buka `src/components/layout/Sidebar.tsx`:
   - Tambahkan tombol navigasi dengan icon Lucide yang sesuai dan panggil `handleNavClick("analytics")`.

### Playbook 2: Menambah Kartu Sparkline / Metrik Baru

1. Pastikan backend di `src/gateway/server.ts` menghitung bucket sparkline pada handler `/api/dashboard/overview` dan menyertakannya ke objek `sparklines`.
2. Buka `src/types/dashboard.ts` dan tambahkan nama metrik baru ke interface `OverviewData.sparklines`.
3. Buka `src/App.tsx` dan tambahkan `useMemo` sparkline dengan prioritas data server (`overview?.sparklines?.metricBaru`).
4. Pasang `MiniSparkline` di dalam kartu view dengan warna aksen yang serasi.

### Playbook 3: Menambah Provider Kuota Baru

1. Implementasikan adapter provider di backend `src/quota/providers/` (mengikuti `IQuotaProvider`).
2. Daftarkan di `src/quota/registry.ts`.
3. Tambahkan icon resmi SVG di `src/assets/nama-provider.svg`.
4. Ekspor komponen di `src/components/icons/ProviderIcons.tsx`.
5. Tambahkan conditional icon routing di `src/components/views/QuotaView.tsx`.

---

## 12. Checklist Kualitas & Developer Workflow

Sebelum melakukan commit, merge, atau menandai pekerjaan selesai:

- [ ] Seluruh view dibungkus container Keep-Alive (`animate-page-enter` vs `hidden`).
- [ ] State interaktif (filter per-page, accordion folder, keyword search, toggle mata uang) tidak hilang saat berpindah tab.
- [ ] Nol emoji di seluruh kode antarmuka (hanya Lucide icon atau SVG resmi).
- [ ] Font angka dan jam menggunakan `font-mono` dengan tabular numbers.
- [ ] Format mata uang Rupiah mengikuti singkatan baku Indonesia (`rb`, `jt`, `M`, `T`) tanpa spasi setelah `Rp`.
- [ ] Unit test frontend (`bun test` di direktori `web/`) lulus 100%.
- [ ] Unit test gateway backend (`bun test` di root repository) lulus 100%.
- [ ] Build bundle produksi (`bun run build` -> `tsc -b && vite build`) bebas error tipe dan kompilasi.
- [ ] Catat riwayat fitur di CHANGELOG.
