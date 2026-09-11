# NexusRoute Web Dashboard

Web monitor & Mission Control visual untuk **NexusRoute Gateway** (`:4010`) yang menjembatani lalu lintas AI antara **OpenCode**, **Hermes Subagents**, **OMP Antigravity Broker** (`:4000`), dan **VansRouter Proxy** (`:20128`).

Desain mengadopsi aesthetic **SalesOps Dark Minimalist** dipadukan dengan palet **Trizzle & Tokyo Night** (`#0E1117` / `#121622` / `#1D68FE`) yang hemat daya, responsif di layar smartphone, dan bebas dari gaya corporate generik.

---

## 🧭 Panduan Struktur File & Direktori

```
web/
├── public/                 # Static asset publik (favicon.svg, icons.svg)
├── src/
│   ├── components/ui/      # Komponen dasar Shadcn UI (Tailwind CSS v4)
│   │   ├── badge.tsx       # Pill badge untuk status HTTP & cache tag
│   │   ├── button.tsx      # Tombol interaktif dengan variant outline/ghost
│   │   ├── card.tsx        # Container card modular dengan border tipis
│   │   ├── sheet.tsx       # Drawer primitif untuk mobile menu
│   │   ├── switch.tsx      # Toggle switch untuk whitelist model routing
│   │   ├── table.tsx       # Komponen tabel untuk log streaming
│   │   └── tabs.tsx        # Navigasi tab switching
│   ├── lib/
│   │   └── utils.ts        # Helper merge Tailwind class (`cn` utility)
│   ├── App.tsx             # [CORE] Komponen utama Dashboard (State, Routing, HUD)
│   ├── index.css           # Styling dasar, deklarasi font Geist, & warna Trizzle
│   └── main.tsx            # React DOM mounting entry point
├── dist/                   # Production build statis (diserve langsung oleh Bun di :4010)
├── index.html              # HTML shell mentah untuk Vite development
├── package.json            # Daftar dependensi frontend (React, Vite, Lucide, Tailwind)
├── tsconfig.json           # Root TypeScript configuration
├── vite.config.ts          # Konfigurasi Vite bundler (base path: `/dashboard/`)
└── README.md               # Dokumentasi panduan arsitektur (file ini)
```

---

## ⚡ Arsitektur & Jalur Komunikasi

Dashboard ini dikompilasi menjadi aset statis murni di `dist/` dan dilayani secara **zero-runtime overhead** oleh Bun Server di NexusRoute:

```
[ Browser / HP ]  ──(HTTP :4010/dashboard/)──>  [ NexusRoute Bun Gateway Engine ]
                                                           │
                                          ┌────────────────┴────────────────┐
                                          ▼                                 ▼
                              [ Static HTML/JS/CSS ]            [ REST API Monitoring ]
                              - /dashboard/                     - /api/dashboard/overview
                              - /dashboard/assets/*             - /api/dashboard/quota
                                                                - /api/dashboard/logs
```

### Endpoint API Gateway yang Dikonsumsi:

- `GET /api/dashboard/overview` -> Status uptime, total request AI, metrik SQLite prompt cache, dan daftar active upstreams.
- `GET /api/dashboard/quota` -> Snapshot sisa kuota Google Antigravity & waktu reset dari database lokal OMP.
- `GET /api/dashboard/logs` -> Ringkasan 50 request terakhir (Model, Latency, Status Code, Cache Hit/Miss).

---

## 🛠️ Panduan Pengembangan (Development Workflow)

### 1. Mode Hot-Reload (Vite Dev Server)

Gunakan mode ini ketika ingin melakukan eksplorasi layout UI secara live:

```bash
cd web
bun run dev --host 0.0.0.0 --port 3030
```

- Akses via browser Windows: `http://localhost:3030/dashboard/`
- Akses via smartphone (WiFi LAN): `http://192.168.1.2:3030/dashboard/`

### 2. Mode Production Build (Wajib Setelah Selesai Mengedit)

Setelah melakukan perubahan pada file di dalam `src/`, bundle harus dikompilasi ulang agar terbaca oleh service systemd GN Gateway:

```bash
cd web
bun run build
systemctl --user restart nexus-gateway.service
```

Bundle akan ter-update dalam waktu ~300ms ke dalam folder `dist/`.

---

## 📱 Akses dari Smartphone (Warung Mode)

Dashboard telah dilengkapi **Mobile Drawer Slide-Over** dengan backdrop blur dan touch target minimal 44px:

1. Pastikan port `4010` sudah diizinkan di Windows Firewall:
   ```powershell
   New-NetFirewallRule -DisplayName "NexusRoute Port 4010" -Direction Inbound -LocalPort 4010 -Protocol TCP -Action Allow
   ```
2. Buka browser smartphone di URL:
   👉 **`http://192.168.1.2:4010/dashboard/`**
