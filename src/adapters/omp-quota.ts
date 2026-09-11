import { withDb, isDatabaseAvailable, getOmpAgentDb } from "../utils/db";
import type { QuotaEntry, QuotaStatus } from "../types";

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

const FRESH_WINDOW_MS = 60 * 60 * 1000;

export class OmpQuotaAdapter {
  public readonly name = "omp-quota";
  private readonly dbPath: string;
  private readonly freshWindowMs: number;

  constructor(dbPath?: string, freshWindowMs: number = FRESH_WINDOW_MS) {
    this.dbPath = dbPath ?? getOmpAgentDb();
    this.freshWindowMs = freshWindowMs;
  }

  isAvailable(): boolean {
    return isDatabaseAvailable(this.dbPath);
  }

  async getQuotas(): Promise<QuotaEntry[]> {
    return this.fetchData();
  }

  async fetchData(options?: { provider?: string }): Promise<QuotaEntry[]> {
    if (!this.isAvailable()) {
      return [];
    }

    return withDb(this.dbPath, (db) => {
      const maxRow = db
        .query<{ max_recorded: number | null }, []>(
          "SELECT MAX(recorded_at) as max_recorded FROM usage_history",
        )
        .get();

      if (!maxRow || maxRow.max_recorded === null) {
        return [];
      }

      const cutoff = maxRow.max_recorded - this.freshWindowMs;
      let query = `
        SELECT id, recorded_at, provider, account_key, email, account_id,
               limit_id, label, window_label, used_fraction, status, resets_at
        FROM usage_history
        WHERE recorded_at >= ?
      `;
      const params: (string | number)[] = [cutoff];

      if (options?.provider) {
        query += " AND LOWER(provider) LIKE ?";
        params.push(`%${options.provider.toLowerCase()}%`);
      }

      query += " ORDER BY id ASC";

      const rows = db.query<UsageHistoryRow, (string | number)[]>(query).all(...params);

      // Deduplicate per (provider, account_key, limit_id)
      const latestByKey = new Map<string, UsageHistoryRow>();
      for (const row of rows) {
        const key = `${row.provider}:${row.account_key}:${row.limit_id}`;
        latestByKey.set(key, row);
      }

      return Array.from(latestByKey.values()).map((r): QuotaEntry => ({
        provider: r.provider,
        email: r.email ?? undefined,
        label: r.label,
        windowLabel: r.window_label ?? undefined,
        usedFraction: r.used_fraction ?? 0,
        status: (r.status as QuotaStatus) ?? "ok",
        resetsAt: r.resets_at ?? undefined,
      }));
    });
  }
}
