#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// Goblin Nexus — OMP Quota Adapter
// Read-Only adapter untuk ~/.omp/agent/agent.db
//
// Sumber data: tabel `usage_history` (snapshot per provider +
//              account_key + limit_id).
//
// CATATAN PENTING (architect spec section 5.3):
//   - TIDAK ADA write ke DB ini. Pure SELECT.
//   - DB ini pakai WAL journal (`agent.db-wal`). SQLite di Bun
//     support WAL read tanpa lock — tapi omp-broker boleh tetap
//     menulis saat kita membaca.
//   - Schema mirror dari broker; kolom sudah stabil.
//
// STRATEGI FRESH-WINDOW (lihat fetchData):
//   Adapter ini HANYA mengembalikan snapshot dari batch polling
//   TERBARU broker — baris dengan `recorded_at` dalam window
//   FRESH_WINDOW_MS terakhir dari MAX(recorded_at). Pendekatan
//   ini menjamin output `gn u` sama bersihnya dengan `omp usage`
//   native: akun lama yang tidak lagi di-poll, weekly window
//   yang broker tidak refresh, dan snapshot dengan resets_at
//   yang sudah lama lewat semuanya otomatis terbuang.
// ─────────────────────────────────────────────────────────────

import { withDb, isDatabaseAvailable, getOmpAgentDb } from "../utils/db";
import {
  BaseAdapter,
  type IQuotaAdapter,
  type QuotaFetchOptions,
} from "./base";
import type { QuotaEntry, QuotaStatus } from "../types";

// ─── DB Row Types (mirror schema, snake_case) ────────────────

/**
 * Shape baris dari `usage_history` agent.db. Field name pakai
 * snake_case sesuai konvensi SQLite; di-mapping ke camelCase
 * saat return QuotaEntry.
 */
interface UsageHistoryRow {
  id: number;
  recorded_at: number;
  provider: string;
  account_key: string;
  email: string | null;
  account_id: string | null;
  limit_id: string;
  label: string;
  window_label: string | null;
  used_fraction: number | null;
  status: string | null;
  resets_at: number | null;
}

// ─── Fresh-Window Strategy ───────────────────────────────────

/**
 * Lebar window (ms) untuk "batch polling terbaru" broker.
 *
 * Broker OMP menulis snapshot per provider+akun dalam satu
 * polling pass — semua baris dalam batch yang sama memiliki
 * `recorded_at` sangat berdekatan (orde detik-menit). Snapshot
 * dari batch lama (akun yang sudah tidak aktif, weekly window
 * yang sudah lewat, atau yang resets_at-nya sudah lama) akan
 * punya `recorded_at` jauh lebih kecil.
 *
 * Dengan hanya mengambil baris yang `recorded_at`-nya berada
 * dalam 1 jam terakhir dari MAX(recorded_at), kita secara
 * otomatis membuang:
 *   - Akun yang sudah lama tidak di-poll (token expired, dll)
 *   - Weekly/daily window yang broker tidak refresh lagi
 *   - Snapshot dari broker lama yang tidak sinkron lagi
 *
 * Toleransi 1 jam menutupi skew waktu antar akun dalam satu
 * batch (beberapa provider kadang delay beberapa menit saat
 * fetch paralel). 1 jam cukup lebar untuk batch normal
 * (broker biasanya polling tiap 1-5 menit) tapi cukup sempit
 * untuk memotong snapshot akun yang sudah mati.
 */
export const FRESH_WINDOW_MS = 60 * 60 * 1000; // 1 jam

// ─── Adapter Class ───────────────────────────────────────────

/**
 * Adapter yang membaca snapshot quota terkini dari agent.db.
 *
 * STRATEGI QUERY (lihat fetchData untuk detail):
 *   1. SQL CTE: tentukan MAX(recorded_at) sebagai anchor batch.
 *   2. SQL WHERE: hanya baris dalam FRESH_WINDOW_MS dari anchor.
 *   3. SQL GROUP BY: dedup MAX(id) per (provider, account_key,
 *      limit_id) — ambil snapshot paling baru per grup.
 *   4. JS post-filter: drop baris dengan `resets_at` di masa
 *      lalu jauh sebagai pengaman tambahan.
 *   5. JS post-dedup: safety-belt per (provider, email, label)
 *      untuk menghadapi drift schema broker.
 *
 * Pakai MAX(id) (bukan MAX(recorded_at)) sebagai tie-breaker
 * di step 3 — id adalah PK autoincrement sehingga deterministic
 * saat ada race condition broker menulis concurrent.
 */
export class OmpQuotaAdapter
  extends BaseAdapter<QuotaEntry[]>
  implements IQuotaAdapter
{
  /** Identifier adapter. */
  public readonly name = "omp-quota";

  /**
   * Lebar window (ms) untuk filter "batch terbaru". Bisa di-
   * override untuk testing; default = FRESH_WINDOW_MS.
   */
  private readonly freshWindowMs: number;

  constructor(dbPath?: string, freshWindowMs: number = FRESH_WINDOW_MS) {
    super("omp-quota", dbPath ?? getOmpAgentDb());
    this.freshWindowMs = freshWindowMs;
  }

  // ─── IDataAdapter contract ───────────────────────────────

  isAvailable(): boolean {
    return isDatabaseAvailable(this.dbPath);
  }

  // ─── IQuotaAdapter contract ──────────────────────────────

  /**
   * Convenience: sama dengan fetchData() tanpa filter.
   */
  async getQuotas(): Promise<QuotaEntry[]> {
    return this.fetchData();
  }

  /**
   * Ambil snapshot quota terkini per provider+akun+limit.
   *
   * HANYA snapshot dari batch polling TERBARU broker yang
   * dikembalikan — lihat strategi fresh-window di header file
   * dan class docstring. Hasilnya identik dengan output
   * `omp usage` native: tanpa baris stale/expired, tanpa
   * akun lama yang sudah tidak di-poll, tanpa duplikat.
   *
   * @param options.provider  Filter substring match (case-insensitive)
   * @returns Daftar QuotaEntry, diurutkan provider ASC lalu
   *          recorded_at DESC
   */
  async fetchData(options: QuotaFetchOptions = {}): Promise<QuotaEntry[]> {
    if (!isDatabaseAvailable(this.dbPath)) {
      return [];
    }

    // ── SQL: fresh-window + dedup by MAX(id) ──────────────
    //
    // CTE `max_ts` meng-anchor timestamp batch terbaru. Outer
    // query hanya mengambil baris dalam FRESH_WINDOW_MS dari
    // anchor; subquery `id IN (...)` mengambil MAX(id) per
    // (provider, account_key, limit_id) di window yang sama.
    //
    // Catatan: subquery filter `recorded_at >= ts - ?` penting
    // agar MAX(id) dihitung hanya dari baris fresh — kalau
    // tidak, MAX(id) bisa jadi milik batch lama yang sudah
    // terfilter di outer WHERE (meskipun hasilnya tetap benar
    // karena outer filter sudah restrict, ini lebih eksplisit).
    const freshWindowMs = this.freshWindowMs;
    const rows = withDb(this.dbPath, (db) => {
      return db
        .query<UsageHistoryRow, [number, number]>(`
          WITH max_ts AS (
            SELECT MAX(recorded_at) AS ts FROM usage_history
          )
          SELECT
            id, recorded_at, provider, account_key, email, account_id,
            limit_id, label, window_label, used_fraction, status, resets_at
          FROM usage_history
          WHERE recorded_at >= (SELECT ts FROM max_ts) - ?
            AND id IN (
              SELECT MAX(id)
              FROM usage_history
              WHERE recorded_at >= (SELECT ts FROM max_ts) - ?
              GROUP BY provider, account_key, limit_id
            )
          ORDER BY provider, recorded_at DESC
        `)
        .all(freshWindowMs, freshWindowMs);
    });

    // ── Post-filter: drop snapshot yang resets_at-nya sudah lama lewat ──
    //
    // Safety net: kalau ada baris lolos fresh-window (mis. broker
    // menulis baris baru dengan recorded_at fresh tapi tidak update
    // resets_at), tetap drop. Grace period 1 jam sama dengan
    // FRESH_WINDOW_MS agar konsisten dengan strategi SQL.
    //
    // Baris tanpa `resets_at` (null) DIKEEP — bukan berarti expired,
    // hanya broker tidak menulis field tsb.
    const now = Date.now();
    const notExpired = rows.filter((r) => {
      if (r.resets_at == null) return true;
      return r.resets_at >= now - freshWindowMs;
    });

    // ── Post-dedup: safety-belt per (provider, email, label) ──
    //
    // SQL sudah menjamin 1 row per (provider, account_key, limit_id).
    // Filter ini adalah pengaman untuk skenario drift schema —
    // mis. broker menulis limit_id berbeda untuk quota yang secara
    // user-facing sama (label + email identik). Saat ini tidak
    // terjadi, tapi biayanya murah dan mencegah duplikat visual.
    const dedup = new Map<string, UsageHistoryRow>();
    for (const r of notExpired) {
      const key = `${r.provider}|${r.email ?? ""}|${r.label}`;
      const existing = dedup.get(key);
      if (!existing || r.id > existing.id) {
        dedup.set(key, r);
      }
    }
    const dedupedRows = Array.from(dedup.values());

    // ── Optional provider filter (substring, case-insensitive) ──
    const filtered = options.provider
      ? dedupedRows.filter((r) =>
          r.provider.toLowerCase().includes(options.provider!.toLowerCase())
        )
      : dedupedRows;

    return filtered.map(rowToQuotaEntry);
  }
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Konversi UsageHistoryRow (snake_case DB shape) ke QuotaEntry
 * (camelCase domain type). Dipisah agar mudah di-test dan
 * konsisten dipakai di banyak method.
 */
function rowToQuotaEntry(row: UsageHistoryRow): QuotaEntry {
  return {
    provider: row.provider,
    email: row.email ?? undefined,
    label: row.label,
    windowLabel: row.window_label ?? undefined,
    usedFraction: row.used_fraction ?? 0,
    status: normalizeStatus(row.status),
    resetsAt: row.resets_at ?? undefined,
  };
}

/**
 * Normalize status string dari DB ke QuotaStatus union type.
 * Broker bisa menulis status custom — fallback ke "ok" jika
 * tidak dikenali (avoid crash pada schema drift).
 */
function normalizeStatus(raw: string | null): QuotaStatus {
  if (!raw) return "ok";
  const lower = raw.toLowerCase();
  if (lower === "ok" || lower === "warn" || lower === "error" || lower === "critical") {
    return lower;
  }
  return "ok";
}
