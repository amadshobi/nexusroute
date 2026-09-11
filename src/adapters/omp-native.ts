#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// Goblin Nexus — OMP Native Stats Adapter
// Read-Only adapter untuk ~/.omp/stats.db (best-effort fallback).
//
// Sumber data: tabel `messages` (per-request aggregation dari
// OMP CLI sessions). Schema sudah pre-aggregated per row:
// input/output/cache tokens + cost fields SUDAH dihitung oleh
// OMP CLI saat write.
//
// ARSITEKTUR (architect section 5.5):
//   - Adapter ini GRACEFUL DEGRADATION. Jika stats.db tidak
//     ada, return []. Jangan throw.
//   - Dipakai sebagai fallback ketika opencode adapter kosong
//     (misal: user pakai native OMP CLI, bukan opencode TUI).
// ─────────────────────────────────────────────────────────────

import { stderr } from "node:process";
import { withDb, isDatabaseAvailable, getOmpStatsDb } from "../utils/db";
import {
  BaseAdapter,
  type IOmpNativeAdapter,
} from "./base";
import type { OmpNativeMessageSummary } from "../types";

// ─── DB Row Types (mirror schema) ────────────────────────────

/**
 * Shape baris dari `messages` stats.db. Field name pakai
 * snake_case; di-mapping ke camelCase saat return.
 */
interface MessagesRow {
  provider: string;
  model: string;
  total_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_write_tokens: number;
  total_cost: number;
}

// ─── Adapter Class ───────────────────────────────────────────

/**
 * Adapter untuk OMP native stats.db. Best-effort: return []
 * jika DB tidak ada, log error ke stderr jika query gagal.
 *
 * CATATAN: Berbeda dengan OmpQuotaAdapter & OpenCodeAdapter,
 * adapter ini TIDAK throw — caller (command layer) bisa skip
 * silently jika ini dipakai sebagai fallback.
 */
export class OmpNativeAdapter
  extends BaseAdapter<OmpNativeMessageSummary[]>
  implements IOmpNativeAdapter
{
  /** Identifier adapter. */
  public readonly name = "omp-native";

  constructor(dbPath?: string) {
    super("omp-native", dbPath ?? getOmpStatsDb());
  }

  // ─── IDataAdapter contract ───────────────────────────────

  /**
   * Override default: untuk best-effort adapter, kita return
   * true selama path di-set (mungkin DB belum dibuat). Caller
   * yang akan handle empty result dengan graceful.
   *
   * Rationale: stats.db dibuat oleh OMP CLI lazily. Adapter
   * yang selalu dianggap "available" lebih useful sebagai
   * fallback — caller cukup cek apakah return [] (kosong) atau
   * tidak.
   */
  isAvailable(): boolean {
    return Boolean(this.dbPath);
  }

  // ─── IOmpNativeAdapter contract ──────────────────────────

  /**
   * Convenience: ambil summary tanpa filter.
   */
  async getMessagesSummary(): Promise<OmpNativeMessageSummary[]> {
    return this.fetchData();
  }

  /**
   * Ambil summary agregat per provider+model dari tabel messages.
   *
   * @param options.since  Filter messages.timestamp >= since (Unix ms, opsional)
   * @returns Daftar OmpNativeMessageSummary, diurutkan total_cost DESC
   */
  async fetchData(
    options: { since?: number } = {}
  ): Promise<OmpNativeMessageSummary[]> {
    if (!isDatabaseAvailable(this.dbPath)) {
      return [];
    }

    const since = options.since ?? 0;

    try {
      const rows = withDb(this.dbPath, (db) => {
        return db
          .query<MessagesRow, [number]>(`
            SELECT
              COALESCE(provider, 'unknown') AS provider,
              COALESCE(model, 'unknown') AS model,
              COUNT(*) AS total_requests,
              COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
              COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
              COALESCE(SUM(cache_read_tokens), 0) AS total_cache_read_tokens,
              COALESCE(SUM(cache_write_tokens), 0) AS total_cache_write_tokens,
              COALESCE(SUM(cost_total), 0) AS total_cost
            FROM messages
            WHERE timestamp >= ?
            GROUP BY provider, model
            ORDER BY total_cost DESC
          `)
          .all(since);
      });

      return rows.map(rowToSummary);
    } catch (err) {
      // Best-effort: log error tapi JANGAN throw. Caller bisa
      // fallback ke adapter lain (misal opencode).
      const msg = err instanceof Error ? err.message : String(err);
      stderr.write(`⚠️  omp-native adapter failed: ${msg}\n`);
      return [];
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Konversi MessagesRow (snake_case DB shape) ke
 * OmpNativeMessageSummary (camelCase domain type).
 */
function rowToSummary(row: MessagesRow): OmpNativeMessageSummary {
  return {
    provider: row.provider,
    model: row.model,
    totalRequests: row.total_requests,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalCacheReadTokens: row.total_cache_read_tokens,
    totalCacheWriteTokens: row.total_cache_write_tokens,
    totalCost: row.total_cost,
  };
}
