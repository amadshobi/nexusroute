#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// Goblin Nexus — OpenCode Adapter
// Read-Only adapter untuk ~/.local/share/opencode/opencode.db
//
// Sumber data:
//   - session   : metadata sesi (id, title, model JSON, cost, tokens*)
//   - part      : JSON-heavy; tool calls + state (untuk filePath)
//   - todo      : todo list per session
//   - message   : opsional, untuk timestamp cross-check
//
// CATATAN (architect section 5.4):
//   - `session.id` adalah text UUID
//   - `session.model` adalah JSON string {"id","providerID","variant"}
//   - `session.time_created` tersedia (Unix ms) — tidak perlu
//     fallback ke rowid
//   - Default filter: parent_id IS NULL (root sessions only)
// ─────────────────────────────────────────────────────────────

import { withDb, isDatabaseAvailable, getOpenCodeDb } from "../utils/db";
import {
  BaseAdapter,
  type ISessionAdapter,
  type RecentSessionsOptions,
  type ModelSummaryOptions,
} from "./base";
import type {
  OpenCodeSession,
  SessionDetail,
  StatsSummary,
  ModelUsageSummary,
  TodoProgress,
} from "../types";

// ─── DB Row Types (mirror schema) ────────────────────────────

interface SessionRow {
  id: string;
  parent_id: string | null;
  title: string;
  directory: string | null;
  model: string | null;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  time_created: number;
  time_updated: number;
}

interface PartRow {
  session_id: string;
  tool_name: string | null;
  file_path: string | null;
}

interface TodoRow {
  session_id: string;
  status: string;
  count: number;
}

// ─── Adapter Class ───────────────────────────────────────────

/**
 * Adapter untuk opencode.db. Pure read-only, sync queries
 * via bun:sqlite. Tidak hold connection — withDb() auto-close.
 */
export class OpenCodeAdapter
  extends BaseAdapter<OpenCodeSession[]>
  implements ISessionAdapter
{
  /** Identifier adapter. */
  public readonly name = "opencode";

  constructor(dbPath?: string) {
    super("opencode", dbPath ?? getOpenCodeDb());
  }

  // ─── IDataAdapter contract ───────────────────────────────

  isAvailable(): boolean {
    return isDatabaseAvailable(this.dbPath);
  }

  /**
   * Default fetchData: return top-10 root sessions sebagai
   * OpenCodeSession (ringkas, tanpa join ke part/todo).
   * Pakai fetchRecentSessions() untuk data lebih kaya.
   */
  fetchData(options?: RecentSessionsOptions): OpenCodeSession[] {
    const limit = 10;
    const details = this.fetchRecentSessions(
      limit,
      options?.startTs,
      options?.endTs
    );
    return details.map(toOpenCodeSession);
  }

  // ─── ISessionAdapter contract ────────────────────────────

  /**
   * Ambil N sesi terbaru dengan join ke part (tools/files) dan
   * todo (progress). Default filter: root sessions only
   * (parent_id IS NULL).
   *
   * @param limit          Maksimum sesi dikembalikan
   * @param filterStartTs  time_created >= startTs (opsional)
   * @param filterEndTs    time_created <= endTs   (opsional)
   */
  fetchRecentSessions(
    limit: number,
    filterStartTs?: number,
    filterEndTs?: number
  ): SessionDetail[] {
    if (!isDatabaseAvailable(this.dbPath) || limit <= 0) {
      return [];
    }

    // Range filter: COALESCE untuk handling null start/end.
    // 0 = lower bound Unix epoch (tidak filter), 9.2e15 = far future.
    const startTs = filterStartTs ?? 0;
    const endTs = filterEndTs ?? Number.MAX_SAFE_INTEGER;

    // Step 1: query root sessions dalam range
    const sessionRows = withDb(this.dbPath, (db) => {
      return db
        .query<SessionRow, [number, number, number]>(`
          SELECT
            id, parent_id, title, directory, model, cost,
            tokens_input, tokens_output, tokens_reasoning,
            tokens_cache_read, tokens_cache_write,
            time_created, time_updated
          FROM session
          WHERE parent_id IS NULL
            AND time_created >= ?
            AND time_created <= ?
          ORDER BY time_updated DESC
          LIMIT ?
        `)
        .all(startTs, endTs, limit);
    });

    if (sessionRows.length === 0) return [];

    // Step 2: batch fetch tool parts & todos untuk semua sesi
    const sessionIds = sessionRows.map((r) => r.id);
    const placeholders = sessionIds.map(() => "?").join(",");

    const partRows = withDb(this.dbPath, (db) => {
      return db
        .query<PartRow, string[]>(`
          SELECT
            session_id,
            json_extract(data, '$.tool') AS tool_name,
            json_extract(data, '$.state.input.filePath') AS file_path
          FROM part
          WHERE session_id IN (${placeholders})
            AND json_extract(data, '$.type') = 'tool'
        `)
        .all(...sessionIds);
    });

    const todoRows = withDb(this.dbPath, (db) => {
      return db
        .query<TodoRow, string[]>(`
          SELECT session_id, status, COUNT(*) AS count
          FROM todo
          WHERE session_id IN (${placeholders})
          GROUP BY session_id, status
        `)
        .all(...sessionIds);
    });

    // Step 3: group part/todo data per session_id
    const partsBySession = groupPartsBySession(partRows);
    const todosBySession = groupTodosBySession(todoRows);

    // Step 4: assemble SessionDetail
    return sessionRows.map((row) => {
      const model = parseSessionModel(row.model);
      const parts = partsBySession.get(row.id) ?? [];
      const todoMap = todosBySession.get(row.id) ?? new Map<string, number>();

      return {
        id: row.id,
        title: row.title,
        modelId: model ? `${model.providerID}/${model.id}` : "unknown",
        cost: row.cost,
        tokensInput: row.tokens_input,
        tokensOutput: row.tokens_output,
        tokensReasoning: row.tokens_reasoning,
        tokensCacheRead: row.tokens_cache_read,
        tokensCacheWrite: row.tokens_cache_write,
        timeCreated: row.time_created,
        parentId: row.parent_id ?? undefined,
        directory: row.directory ?? undefined,
        durationMs: row.time_updated - row.time_created,
        toolCount: aggregateToolCount(parts),
        modifiedFiles: extractModifiedFiles(parts),
        todoProgress: aggregateTodoProgress(todoMap),
      };
    });
  }

  /**
   * Agregasi token & cost per provider + model + variant.
   * Cocok untuk `gn stats --models`.
   *
   * @param isToday    Filter hanya baris dengan time_created hari ini
   * @param targetDate Filter ke tanggal tertentu (YYYY-MM-DD, UTC)
   */
  fetchModelUsageSummary(
    isToday?: boolean,
    targetDate?: string
  ): ModelUsageSummary[] {
    if (!isDatabaseAvailable(this.dbPath)) return [];

    const cutoffTs = computeCutoffTimestamp(isToday, targetDate);

    // json_extract dari session.model JSON. model bisa NULL
    // (untuk legacy row) — COALESCE ke "unknown" agar GROUP BY
    // konsisten.
    const rows = withDb(this.dbPath, (db) => {
      return db
        .query<ModelAggRow, [number]>(`
          SELECT
            COALESCE(json_extract(model, '$.providerID'), 'unknown') AS provider,
            COALESCE(json_extract(model, '$.id'), 'unknown') AS model_id,
            COALESCE(json_extract(model, '$.variant'), '') AS variant,
            COUNT(*) AS session_count,
            COALESCE(SUM(cost), 0) AS total_cost,
            COALESCE(SUM(tokens_input), 0) AS total_input,
            COALESCE(SUM(tokens_output), 0) AS total_output
          FROM session
          WHERE time_created >= ?
          GROUP BY provider, model_id, variant
          ORDER BY total_cost DESC
        `)
        .all(cutoffTs);
    });

    return rows.map((r) => ({
      modelId: `${r.provider}/${r.model_id}${r.variant ? ` (${r.variant})` : ""}`,
      provider: r.provider,
      variant: r.variant || null,
      totalCost: r.total_cost,
      totalTokensInput: r.total_input,
      totalTokensOutput: r.total_output,
      totalTokens: r.total_input + r.total_output,
      sessionCount: r.session_count,
    }));
  }

  /**
   * Ringkasan statistik agregat untuk window N hari terakhir.
   */
  getStatsSummary(days: number): StatsSummary {
    const safeDays = Math.max(1, days);
    const perModel = this.fetchModelUsageSummary(false);

    // Hitung total window
    const cutoffTs = Date.now() - safeDays * 24 * 60 * 60 * 1000;
    const totals = withDb(this.dbPath, (db) => {
      return db
        .query<
          { total_cost: number; total_input: number; total_output: number },
          [number]
        >(`
          SELECT
            COALESCE(SUM(cost), 0) AS total_cost,
            COALESCE(SUM(tokens_input), 0) AS total_input,
            COALESCE(SUM(tokens_output), 0) AS total_output
          FROM session
          WHERE time_created >= ?
        `)
        .get(cutoffTs);
    });

    return {
      periodLabel: `${safeDays} days`,
      totalCost: totals?.total_cost ?? 0,
      totalTokensInput: totals?.total_input ?? 0,
      totalTokensOutput: totals?.total_output ?? 0,
      perModel,
    };
  }
}

// ─── Internal DB Row Types ───────────────────────────────────

interface ModelAggRow {
  provider: string;
  model_id: string;
  variant: string;
  session_count: number;
  total_cost: number;
  total_input: number;
  total_output: number;
}

// ─── Helpers ────────────────────────────────────────────────

/** Parsed model JSON dari session.model. */
interface ParsedModel {
  id: string;
  providerID: string;
  variant: string | null;
}

/**
 * Parse JSON string dari session.model. Return null jika
 * invalid/empty (schema drift safety).
 */
function parseSessionModel(raw: string | null): ParsedModel | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return {
      id: String(obj.id ?? "unknown"),
      providerID: String(obj.providerID ?? "unknown"),
      variant: obj.variant ? String(obj.variant) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Group part rows by session_id untuk efficient lookup.
 */
function groupPartsBySession(
  rows: PartRow[]
): Map<string, PartRow[]> {
  const map = new Map<string, PartRow[]>();
  for (const row of rows) {
    const arr = map.get(row.session_id);
    if (arr) {
      arr.push(row);
    } else {
      map.set(row.session_id, [row]);
    }
  }
  return map;
}

/**
 * Group todo rows by session_id → Map<status, count>.
 */
function groupTodosBySession(
  rows: TodoRow[]
): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const row of rows) {
    let inner = map.get(row.session_id);
    if (!inner) {
      inner = new Map();
      map.set(row.session_id, inner);
    }
    inner.set(row.status, row.count);
  }
  return map;
}

/**
 * Aggregate tool call count per tool name.
 */
function aggregateToolCount(parts: PartRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of parts) {
    if (!p.tool_name) continue;
    out[p.tool_name] = (out[p.tool_name] ?? 0) + 1;
  }
  return out;
}

/**
 * Extract unique file paths dari edit/write tool calls.
 * Mengembalikan array deduped (preserve insertion order).
 */
function extractModifiedFiles(parts: PartRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (p.tool_name !== "edit" && p.tool_name !== "write") continue;
    if (!p.file_path) continue;
    if (seen.has(p.file_path)) continue;
    seen.add(p.file_path);
    out.push(p.file_path);
  }
  return out;
}

/**
 * Aggregate todo status count ke TodoProgress object.
 * Status string lain (selain 4 standar) dihitung sebagai
 * "other" via total - (pending + inProgress + completed + cancelled).
 */
function aggregateTodoProgress(
  statusMap: Map<string, number>
): TodoProgress {
  const pending = statusMap.get("pending") ?? 0;
  const inProgress = statusMap.get("in_progress") ?? 0;
  const completed = statusMap.get("completed") ?? 0;
  const cancelled = statusMap.get("cancelled") ?? 0;
  const known = pending + inProgress + completed + cancelled;
  const total = Array.from(statusMap.values()).reduce((a, b) => a + b, 0);
  // Sanity: jika statusMap punya status lain, "total" > known.
  // Untuk sekarang, return total = known (ignore unknown status)
  // agar tidak misleading. Caller bisa cross-check via statusMap.
  return {
    total: total,
    pending,
    inProgress,
    completed,
    cancelled,
  };
}

/**
 * Compute Unix ms cutoff untuk filter time.
 * - isToday=true: awal hari UTC hari ini
 * - targetDate="YYYY-MM-DD": awal hari UTC tanggal tersebut
 * - default: 0 (no filter)
 */
function computeCutoffTimestamp(
  isToday?: boolean,
  targetDate?: string
): number {
  if (targetDate) {
    const ts = Date.parse(`${targetDate}T00:00:00.000Z`);
    return Number.isFinite(ts) ? ts : 0;
  }
  if (isToday) {
    const d = new Date();
    return Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      0, 0, 0, 0
    );
  }
  return 0;
}

/**
 * Strip SessionDetail down ke OpenCodeSession shape.
 * Dipakai oleh default fetchData() untuk konsistensi dengan
 * IDataAdapter<OpenCodeSession[]> contract.
 */
function toOpenCodeSession(s: SessionDetail): OpenCodeSession {
  return {
    id: s.id,
    title: s.title,
    modelId: s.modelId,
    cost: s.cost,
    tokensInput: s.tokensInput,
    tokensOutput: s.tokensOutput,
    tokensReasoning: s.tokensReasoning,
    tokensCacheRead: s.tokensCacheRead,
    tokensCacheWrite: s.tokensCacheWrite,
    timeCreated: s.timeCreated,
  };
}
