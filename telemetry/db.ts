#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// Goblin Nexus — Telemetry DB
// Independent SQLite-based telemetry store. NO FAKE MATH.
// Schema is intentionally minimal: 1 table, indexed on
// (timestamp) and (provider, model) for fast rollups.
// ─────────────────────────────────────────────────────────────

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ─── Paths ────────────────────────────────────────────────────

const CACHE_DIR = join(homedir(), ".cache", "goblin-nexus");
export const TELEMETRY_DB_PATH = join(CACHE_DIR, "telemetry.db");

// ─── Types ────────────────────────────────────────────────────

export interface TelemetryEntry {
  /** Provider id, e.g. "google-antigravity", "openrouter" */
  provider: string;
  /** Model id, e.g. "gemini-2.5-flash" */
  model: string;
  /** Client app name (default: "opencode") */
  clientApp?: string;
  /** Prompt / input tokens */
  promptTokens?: number;
  /** Completion / output tokens */
  completionTokens?: number;
  /** Cache read tokens (if any) */
  cacheReadTokens?: number;
  /** Cache write tokens (if any) */
  cacheWriteTokens?: number;
  /** Total tokens (optional, computed if missing) */
  totalTokens?: number;
  /** Latency in milliseconds */
  latencyMs?: number;
  /** Cost in USD — caller may pre-compute via pricing engine */
  costUsd?: number;
  /** HTTP status code, default 200 */
  statusCode?: number;
  /** Optional epoch ms timestamp (defaults to Date.now()) */
  timestamp?: number;
}

export interface TelemetryQueryOptions {
  provider?: string;
  days?: number;
  limit?: number;
}

export interface TelemetryRow {
  id: number;
  timestamp: number;
  provider: string;
  model: string;
  client_app: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  latency_ms: number;
  cost_usd: number;
  status_code: number;
}

export interface TelemetrySummary {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  days: number;
  rowCount: number;
}

// ─── DB Lifecycle ─────────────────────────────────────────────

let _db: Database | null = null;

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      client_app TEXT DEFAULT 'opencode',
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0.0,
      status_code INTEGER DEFAULT 200
    );
    CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_telemetry_provider_model ON telemetry_logs(provider, model);
  `);
}

/** Get (or lazily open) the singleton DB handle. Applies WAL on first open. */
export function getDb(): Database {
  if (_db) return _db;
  ensureCacheDir();
  // mkdir parent of db file as a safety net
  const parent = dirname(TELEMETRY_DB_PATH);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  const db = new Database(TELEMETRY_DB_PATH, { create: true });
  // Pragmas — WAL mode enables concurrent readers + 1 writer
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
  } catch {
    // Some environments may not support WAL pragmas; fall through.
  }
  initSchema(db);
  _db = db;
  return db;
}

/** Close the singleton DB (mostly for tests / clean shutdown). */
export function closeDb(): void {
  if (_db) {
    try { _db.close(); } catch { /* noop */ }
    _db = null;
  }
}

// ─── Logging ──────────────────────────────────────────────────

/**
 * Persist a telemetry entry. Non-blocking semantics: callers should
 * NOT await the promise on the hot path if they want fire-and-forget.
 * Errors are swallowed into stderr to avoid cascading failures.
 */
export async function logTelemetry(entry: TelemetryEntry): Promise<void> {
  try {
    const db = getDb();
    const ts = entry.timestamp ?? Date.now();
    const prompt = Math.max(0, Math.trunc(entry.promptTokens ?? 0));
    const comp = Math.max(0, Math.trunc(entry.completionTokens ?? 0));
    const cacheRead = Math.max(0, Math.trunc(entry.cacheReadTokens ?? 0));
    const cacheWrite = Math.max(0, Math.trunc(entry.cacheWriteTokens ?? 0));
    const total = Math.max(
      0,
      Math.trunc(entry.totalTokens ?? (prompt + comp + cacheRead + cacheWrite)),
    );
    const latency = Math.max(0, Math.trunc(entry.latencyMs ?? 0));
    const cost = Number.isFinite(entry.costUsd ?? 0) ? Number(entry.costUsd) : 0.0;
    const status = Math.trunc(entry.statusCode ?? 200);
    const client = entry.clientApp ?? "opencode";

    db.query(
      `INSERT INTO telemetry_logs
        (timestamp, provider, model, client_app,
         prompt_tokens, completion_tokens,
         cache_read_tokens, cache_write_tokens, total_tokens,
         latency_ms, cost_usd, status_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ts, entry.provider, entry.model, client,
      prompt, comp, cacheRead, cacheWrite, total,
      latency, cost, status,
    );
  } catch (err) {
    // Never crash the caller on telemetry failure
    process.stderr.write(`⚠️  telemetry.db write failed: ${(err as Error).message}\n`);
  }
}

// ─── Querying ─────────────────────────────────────────────────

/**
 * Query telemetry rows. Returns empty array if DB is missing or empty.
 * Resilient: all errors are caught and surfaced to caller as [].
 */
export function queryTelemetry(options: TelemetryQueryOptions = {}): TelemetryRow[] {
  try {
    const db = getDb();
    const days = options.days ?? 7;
    const sinceMs = Date.now() - days * 86_400_000;
    const limit = options.limit ?? 1000;

    let sql = `SELECT * FROM telemetry_logs WHERE timestamp >= ?`;
    const params: (number | string)[] = [sinceMs];

    if (options.provider) {
      sql += ` AND provider = ?`;
      params.push(options.provider);
    }

    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    return db.query(sql).all(...params) as TelemetryRow[];
  } catch (err) {
    process.stderr.write(`⚠️  telemetry.db query failed: ${(err as Error).message}\n`);
    return [];
  }
}

/**
 * Aggregate summary for a rolling window (in days).
 * Returns zeroed summary if no rows found.
 */
export function getSummary(days: number = 7): TelemetrySummary {
  const empty: TelemetrySummary = {
    totalRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    avgLatencyMs: 0,
    days,
    rowCount: 0,
  };

  try {
    const db = getDb();
    const sinceMs = Date.now() - days * 86_400_000;

    const row = db.query(
      `SELECT
         COUNT(*) as rowCount,
         COALESCE(SUM(prompt_tokens), 0) as totalPrompt,
         COALESCE(SUM(completion_tokens), 0) as totalComp,
         COALESCE(SUM(cache_read_tokens), 0) as totalCacheRead,
         COALESCE(SUM(cache_write_tokens), 0) as totalCacheWrite,
         COALESCE(SUM(total_tokens), 0) as totalTokens,
         COALESCE(SUM(cost_usd), 0.0) as totalCost,
         COALESCE(AVG(latency_ms), 0.0) as avgLatency
       FROM telemetry_logs WHERE timestamp >= ?`,
    ).get(sinceMs) as {
      rowCount: number;
      totalPrompt: number;
      totalComp: number;
      totalCacheRead: number;
      totalCacheWrite: number;
      totalTokens: number;
      totalCost: number;
      avgLatency: number;
    } | null;

    if (!row || row.rowCount === 0) return empty;

    return {
      totalRequests: row.rowCount,
      totalPromptTokens: row.totalPrompt,
      totalCompletionTokens: row.totalComp,
      totalCacheReadTokens: row.totalCacheRead,
      totalCacheWriteTokens: row.totalCacheWrite,
      totalTokens: row.totalTokens,
      totalCostUsd: row.totalCost,
      avgLatencyMs: row.avgLatency,
      days,
      rowCount: row.rowCount,
    };
  } catch (err) {
    process.stderr.write(`⚠️  telemetry.db summary failed: ${(err as Error).message}\n`);
    return empty;
  }
}
