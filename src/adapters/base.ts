#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// Goblin Nexus — Adapter Contract (base)
// Interface & abstract class untuk semua data source adapter.
//
// Setiap adapter di src/adapters/ WAJIB mengimplementasikan
// IDataAdapter<T>. Spesifik adapter (quota, session, native)
// extend IQuotaAdapter / ISessionAdapter / IOmpNativeAdapter
// untuk typed convenience methods.
//
// Tipe domain (QuotaEntry, OpenCodeSession, dll) di-import
// dari ../types. TIDAK ADA import runtime lain di sini
// (kecuali utility db & types).
// ─────────────────────────────────────────────────────────────

import { isDatabaseAvailable } from "../utils/db";
import type {
  QuotaEntry,
  OpenCodeSession,
  SessionDetail,
  StatsSummary,
  ModelUsageSummary,
  OmpNativeMessageSummary,
} from "../types";

// ─── Generic Adapter Contract ────────────────────────────────

/**
 * Generic adapter contract — base untuk semua adapter.
 * Pakai generic <T> untuk type-safety: setiap adapter
 * mendefinisikan tipe data yang dikembalikan.
 *
 * PRINSIP (architect section 5.2):
 *   1. isAvailable() HARUS synchronous & cheap — dipakai
 *      command layer untuk graceful skip sebelum fetch.
 *   2. fetchData() boleh sync atau async — pilih sesuai
 *      karakteristik data source (DB sync, HTTP async).
 *   3. Adapter WAJIB pure read-only. Tidak boleh modify
 *      DB eksternal atau konfigurasi.
 */
export interface IDataAdapter<T> {
  /** Identifier adapter, misal "omp-quota" | "opencode" | "omp-native" */
  readonly name: string;
  /**
   * Cek apakah adapter bisa beroperasi. Return false → command
   * layer skip adapter dengan pesan informatif, BUKAN throw.
   *
   * Implementasi default BaseAdapter mengecek DB existence.
   * Override jika adapter lebih kompleks (cek versi schema,
   * dependencies, dll).
   */
  isAvailable(): boolean;
  /**
   * Ambil data utama adapter.
   *
   * @param options - Opsi query generic. Tiap sub-interface
   *                  mendokumentasikan opsi yang didukung.
   * @returns Data sesuai T. Boleh sync (T) atau async (Promise<T>).
   */
  fetchData(options?: unknown): T | Promise<T>;
}

// ─── Specific Adapter Contracts ──────────────────────────────

/**
 * Opsi yang didukung oleh IQuotaAdapter.fetchData().
 */
export interface QuotaFetchOptions {
  /** Filter hanya provider tertentu (case-insensitive substring match) */
  provider?: string;
}

/**
 * Adapter yang mengembalikan daftar quota per provider+akun.
 * Implementasi: src/adapters/omp-quota.ts
 */
export interface IQuotaAdapter extends IDataAdapter<QuotaEntry[]> {
  fetchData(options?: QuotaFetchOptions): Promise<QuotaEntry[]>;
  /** Ambil snapshot quota terkini per provider+akun (convenience). */
  getQuotas(): Promise<QuotaEntry[]>;
}

/**
 * Opsi untuk ISessionAdapter.fetchRecentSessions().
 *
 * CATATAN: Method fetchRecentSessions di ISessionAdapter menggunakan
 * parameter POSITIONAL (limit, startTs, endTs) sesuai task brief.
 * Interface ini hanya deklarasi typed view — concrete adapter
 * opencode.ts mengimplementasikan signature persis.
 */
export interface RecentSessionsOptions {
  /** Filter session dari timestamp (Unix ms) */
  startTs?: number;
  /** Filter session sampai timestamp (Unix ms) */
  endTs?: number;
}

/**
 * Opsi untuk ISessionAdapter.fetchModelUsageSummary().
 */
export interface ModelSummaryOptions {
  /** Jika true, hanya session hari ini (override startTs ke awal hari) */
  isToday?: boolean;
  /** Filter ke tanggal tertentu (YYYY-MM-DD, UTC) */
  targetDate?: string;
}

/**
 * Adapter yang mengembalikan data sesi & statistik OpenCode.
 * Implementasi canonical: src/adapters/opencode.ts
 * Fallback: src/adapters/omp-native.ts (untuk native OMP CLI).
 */
export interface ISessionAdapter extends IDataAdapter<OpenCodeSession[]> {
  /**
   * Ambil daftar sesi terbaru dengan info detail.
   * Method ini LEBIH KAYA dari IDataAdapter.fetchData() — bisa
   * join ke tabel part (tools), todo (progress), dll.
   *
   * @param limit          Maksimum jumlah sesi dikembalikan
   * @param filterStartTs  Filter session.time_created >= startTs (opsional)
   * @param filterEndTs    Filter session.time_created <= endTs   (opsional)
   */
  fetchRecentSessions(
    limit: number,
    filterStartTs?: number,
    filterEndTs?: number
  ): SessionDetail[];

  /**
   * Agregasi total token & cost per provider + model + variant.
   *
   * @param isToday    Jika true, hanya agregasi untuk hari ini (UTC)
   * @param targetDate Filter ke tanggal tertentu (YYYY-MM-DD, UTC)
   */
  fetchModelUsageSummary(
    isToday?: boolean,
    targetDate?: string
  ): ModelUsageSummary[];

  /** Ambil ringkasan statistik agregat untuk window N hari terakhir. */
  getStatsSummary(days: number): StatsSummary;
}

/**
 * Adapter untuk native OMP CLI stats (read-only dari stats.db).
 * Best-effort fallback ketika opencode adapter kosong.
 */
export interface IOmpNativeAdapter extends IDataAdapter<OmpNativeMessageSummary[]> {
  fetchData(options?: { since?: number }): Promise<OmpNativeMessageSummary[]>;
  /** Convenience: sama dengan fetchData() tanpa filter. */
  getMessagesSummary(): Promise<OmpNativeMessageSummary[]>;
}

// ─── Abstract Base Class (optional convenience) ──────────────

/**
 * Abstract base class yang meng-handle hal-hal generik:
 *   - name injection (readonly, dari constructor)
 *   - default isAvailable() yang cek DB path existence
 *   - protected dbPath untuk query
 *
 * Cara pakai di concrete adapter:
 *   1. extends BaseAdapter<MyDataType>
 *   2. panggil super("adapter-name", dbPath) di constructor
 *   3. override isAvailable() jika logic lebih kompleks
 *   4. implement fetchData() dengan signature typed (opsional
 *      override interface juga)
 *
 * @example
 * export class OmpQuotaAdapter extends BaseAdapter<QuotaEntry[]>
 *   implements IQuotaAdapter {
 *   constructor(dbPath?: string) {
 *     super("omp-quota", dbPath ?? getOmpAgentDb());
 *   }
 *   async fetchData(options?: QuotaFetchOptions): Promise<QuotaEntry[]> {
 *     // ... query
 *   }
 * }
 */
export abstract class BaseAdapter<T> implements IDataAdapter<T> {
  /** Identifier adapter, di-inject dari constructor. */
  public readonly name: string;
  /** Path ke SQLite database adapter. Empty = tidak ada DB. */
  protected readonly dbPath: string;

  constructor(name: string, dbPath: string) {
    this.name = name;
    this.dbPath = dbPath;
  }

  /**
   * Default implementation: cek apakah DB file ada di filesystem.
   * Override di subclass jika availability check lebih kompleks
   * (misal: cek schema version, dependencies, port listening).
   */
  isAvailable(): boolean {
    if (!this.dbPath) return false;
    return isDatabaseAvailable(this.dbPath);
  }

  /**
   * Ambil data utama adapter. Wajib di-implement di subclass.
   * Subclass BOLEH narrowing parameter type dari `unknown` ke
   * opsi yang lebih spesifik (lihat IQuotaAdapter.fetchData).
   */
  abstract fetchData(options?: unknown): T | Promise<T>;
}
