#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// Goblin Nexus — SQLite Read-Only Helper
//
// Wrapper tipis di atas `bun:sqlite` dengan INVARIAN:
//   1. SELALU dibuka dengan { readonly: true } — TIDAK ADA
//      write operation ke database eksternal.
//   2. SELALU close setelah query selesai — CLI bukan server.
//   3. Throw dengan pesan jelas jika DB tidak ada / terkunci.
//
// File ini adalah SATU-SATUNA cara adapter membuka DB.
// Adapter tidak boleh import `bun:sqlite` secara langsung.
// ─────────────────────────────────────────────────────────────

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Default Paths (single source of truth) ──────────────────

/** Default path ke SQLite OpenCode telemetry DB. */
export const OPENCODE_DB_PATH: string = join(
	homedir(),
	".local",
	"share",
	"opencode",
	"opencode.db",
);

/** Default path ke SQLite OMP broker agent DB. */
export const OMP_AGENT_DB_PATH: string = join(
	homedir(),
	".omp",
	"agent",
	"agent.db",
);

/** Default path ke SQLite OMP native stats DB (opsional, mungkin tidak ada). */
export const OMP_STATS_DB_PATH: string = join(homedir(), ".omp", "stats.db");

// ─── Low-level: openReadOnly ─────────────────────────────────

/**
 * Buka SQLite database dalam mode read-only.
 *
 * @param dbPath Path absolut ke file .db
 * @returns Instance Database yang siap query
 * @throws Error jika file tidak ada
 * @throws Error jika file ada tapi tidak bisa dibuka (locked, corrupt, perm)
 *
 * PENTING: Caller WAJIB panggil .close() setelah selesai,
 * atau gunakan withDb() / safeQuery() yang auto-close.
 */
export function openReadOnly(dbPath: string): Database {
	if (!existsSync(dbPath)) {
		throw new Error(
			`Database tidak ditemukan: ${dbPath}\n` +
				`Pastikan service terkait pernah dijalankan untuk membuat file ini.`,
		);
	}
	try {
		return new Database(dbPath, { readonly: true, create: false });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(
			`Gagal membuka database (read-only): ${dbPath}\n` + `Detail: ${msg}`,
		);
	}
}

// ─── Mid-level: withDb (auto-close) ──────────────────────────

/**
 * Buka DB read-only, jalankan fn, lalu close otomatis — bahkan
 * jika fn throw. Direkomendasikan untuk semua adapter agar
 * tidak ada connection leak.
 *
 * @example
 * const rows = withDb(OPENCODE_DB_PATH, (db) => {
 *   return db.query("SELECT * FROM session").all();
 * });
 */
export function withDb<T>(dbPath: string, fn: (db: Database) => T): T {
	const db = openReadOnly(dbPath);
	try {
		return fn(db);
	} finally {
		db.close();
	}
}

// ─── High-level: safeQuery (graceful missing) ───────────────

/**
 * Cek apakah DB tersedia tanpa throw.
 * Pakai di awal adapter untuk graceful degradation.
 *
 * @example
 * if (!isDatabaseAvailable(OMP_AGENT_DB_PATH)) return [];
 */
export function isDatabaseAvailable(dbPath: string): boolean {
	return existsSync(dbPath);
}

/**
 * Query single-statement dengan auto-close + error handling.
 * Return rows sebagai array of T (typed via generic).
 *
 * PERILAKU:
 *   - DB tidak ditemukan → return [] (graceful, untuk adapter
 *     yang sumbernya opsional seperti OMP native stats).
 *   - DB ada tapi SQL/permission error → THROW (jangan silent
 *     swallow — biarkan command layer tangani & tampilkan ke user).
 *
 * @param dbPath  Path ke file .db
 * @param sql     SQL query dengan placeholder ? untuk parameter
 * @param params  Parameter untuk placeholder (default: [])
 * @returns       Array of rows, atau [] jika DB tidak ada
 */
export function safeQuery<T = unknown>(
	dbPath: string,
	sql: string,
	params: SQLQueryBindings[] = [],
): T[] {
	if (!existsSync(dbPath)) {
		return [];
	}
	return withDb(dbPath, (db) => {
		// bun:sqlite's .all() expects variadic args, hence spread.
		return db.query<T, SQLQueryBindings[]>(sql).all(...params);
	});
}

// ─── Typed path getters (env-overrideable) ───────────────────

/**
 * Get path ke OpenCode telemetry DB.
 * Bisa di-override via env GN_OPENCODE_DB_PATH (untuk testing).
 */
export function getOpenCodeDb(): string {
	return process.env.GN_OPENCODE_DB_PATH || OPENCODE_DB_PATH;
}

/**
 * Get path ke OMP broker agent DB.
 * Bisa di-override via env GN_OMP_AGENT_DB_PATH (untuk testing).
 */
export function getOmpAgentDb(): string {
	return process.env.GN_OMP_AGENT_DB_PATH || OMP_AGENT_DB_PATH;
}

/**
 * Get path ke OMP native stats DB.
 * Bisa di-override via env GN_OMP_STATS_DB_PATH (untuk testing).
 *
 * Catatan: DB ini mungkin tidak ada. Adapter yang memakainya
 * WAJIB cek dengan isDatabaseAvailable() sebelum query, atau
 * gunakan safeQuery() yang sudah handle missing file.
 */
export function getOmpStatsDb(): string {
	return process.env.GN_OMP_STATS_DB_PATH || OMP_STATS_DB_PATH;
}
