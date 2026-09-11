import { Database } from "bun:sqlite";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

export interface OpenCodeCliSessionRow {
	id: string;
	parent_id: string | null;
	title: string;
	directory: string | null;
	agent: string | null;
	model: string | null;
	cost: number;
	tokens_input: number;
	tokens_output: number;
	tokens_cache_read: number;
	tokens_cache_write: number;
	tokens_reasoning: number;
	time_created: number;
	time_updated: number;
}

export interface OpenCodeCliToolUsageRow {
	tool: string;
	count: number;
}

export interface FileDiffStat {
	filePath: string;
	additions: number;
	deletions: number;
}

/**
 * Resolver path opencode.db secara otomatis.
 */
export function getOpenCodeDbPath(): string {
	if (process.env.OPENCODE_DB_PATH) {
		return process.env.OPENCODE_DB_PATH;
	}
	const homeDir = os.homedir();
	return path.join(homeDir, ".local", "share", "opencode", "opencode.db");
}

/**
 * Execute callback with read-only bun:sqlite connection safely.
 */
function withOpenCodeDb<T>(fn: (db: Database) => T): T | null {
	const dbPath = getOpenCodeDbPath();
	try {
		const db = new Database(dbPath, { readonly: true });
		try {
			return fn(db);
		} finally {
			db.close();
		}
	} catch {
		return null;
	}
}

/**
 * Run SQL query via `opencode db --format=json` CLI command as fallback.
 */
export function queryOpenCodeCli<T>(sqlQuery: string): T[] {
	try {
		const sanitizedSql = sqlQuery.replace(/"/g, '\\"');
		const stdout = execSync(`opencode db --format=json "${sanitizedSql}"`, {
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
			stdio: ["pipe", "pipe", "ignore"],
		});

		if (!stdout || !stdout.trim()) {
			return [];
		}

		const data = JSON.parse(stdout.trim());
		return Array.isArray(data) ? data : [];
	} catch {
		return [];
	}
}

/**
 * Calculate start of today timestamp in ms.
 */
export function getStartOfTodayMs(): number {
	const now = new Date();
	now.setHours(0, 0, 0, 0);
	return now.getTime();
}

/**
 * Fetch root sessions + all subagent sessions in BATCH queries (super fast!).
 */
export function fetchAllSessionData(
	cutoffTs?: number,
	sessionFilter?: string | null,
) {
	const ts = cutoffTs ?? getStartOfTodayMs();

	return (
		withOpenCodeDb((db) => {
			let rootSessions: OpenCodeCliSessionRow[] = [];

			if (sessionFilter) {
				const sanitized = sessionFilter.trim();
				if (sanitized.startsWith("ses_")) {
					// Direct session ID lookup
					const found = db
						.query<OpenCodeCliSessionRow, [string]>(
							`SELECT id, parent_id, title, directory, agent, model, cost, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, tokens_reasoning, time_created, time_updated FROM session WHERE id = ?`,
						)
						.all(sanitized);

					if (found.length > 0) {
						const row = found[0];
						if (row.parent_id) {
							rootSessions = db
								.query<OpenCodeCliSessionRow, [string]>(
									`SELECT id, parent_id, title, directory, agent, model, cost, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, tokens_reasoning, time_created, time_updated FROM session WHERE id = ?`,
								)
								.all(row.parent_id);
						} else {
							rootSessions = [row];
						}
					}
				} else {
					// Title keyword filter
					if (ts > 0) {
						rootSessions = db
							.query<OpenCodeCliSessionRow, [string, number, number]>(
								`SELECT id, parent_id, title, directory, agent, model, cost, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, tokens_reasoning, time_created, time_updated FROM session WHERE (parent_id IS NULL OR parent_id = '') AND title LIKE ? AND (time_created >= ? OR time_updated >= ?) ORDER BY time_updated DESC`,
							)
							.all(`%${sanitized}%`, ts, ts);
					} else {
						rootSessions = db
							.query<OpenCodeCliSessionRow, [string]>(
								`SELECT id, parent_id, title, directory, agent, model, cost, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, tokens_reasoning, time_created, time_updated FROM session WHERE (parent_id IS NULL OR parent_id = '') AND title LIKE ? ORDER BY time_updated DESC`,
							)
							.all(`%${sanitized}%`);
					}
				}
			} else {
				// Time cutoff filter
				if (ts > 0) {
					rootSessions = db
						.query<OpenCodeCliSessionRow, [number, number]>(
							`SELECT id, parent_id, title, directory, agent, model, cost, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, tokens_reasoning, time_created, time_updated FROM session WHERE (parent_id IS NULL OR parent_id = '') AND (time_created >= ? OR time_updated >= ?) ORDER BY time_updated DESC`,
						)
						.all(ts, ts);
				} else {
					rootSessions = db
						.query<OpenCodeCliSessionRow, []>(
							`SELECT id, parent_id, title, directory, agent, model, cost, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, tokens_reasoning, time_created, time_updated FROM session WHERE (parent_id IS NULL OR parent_id = '') ORDER BY time_updated DESC`,
						)
						.all();
				}
			}

			if (rootSessions.length === 0) {
				return {
					rootSessions: [],
					// Type param eksplisit agar union return type tidak merusak inferensi caller
					subagentsByParent: new Map<string, OpenCodeCliSessionRow[]>(),
					toolsBySession: new Map<string, OpenCodeCliToolUsageRow[]>(),
					diffsBySession: new Map<string, FileDiffStat[]>(),
				};
			}

			const rootIds = rootSessions.map((r) => r.id);
			const placeholders = rootIds.map(() => "?").join(",");

			// Batch query subagents
			const subagentSessions = db
				.query<OpenCodeCliSessionRow, string[]>(
					`SELECT id, parent_id, title, directory, agent, model, cost, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, tokens_reasoning, time_created, time_updated FROM session WHERE parent_id IN (${placeholders}) ORDER BY time_created ASC`,
				)
				.all(...rootIds);

			const allSessionIds = [...rootIds, ...subagentSessions.map((s) => s.id)];
			const allPlaceholders = allSessionIds.map(() => "?").join(",");

			// Batch query tools
			interface ToolRow {
				session_id: string;
				tool: string;
				count: number;
			}
			const toolRows = db
				.query<ToolRow, string[]>(
					`SELECT session_id, json_extract(data, '$.tool') AS tool, count(*) AS count FROM part WHERE session_id IN (${allPlaceholders}) AND json_extract(data, '$.type') = 'tool' GROUP BY session_id, tool ORDER BY count DESC`,
				)
				.all(...allSessionIds);

			// Batch query file diffs (oldString, newString, content)
			interface PartEditRow {
				session_id: string;
				tool: string;
				filePath: string | null;
				oldString: string | null;
				newString: string | null;
				content: string | null;
			}
			const editRows = db
				.query<PartEditRow, string[]>(
					`SELECT session_id, json_extract(data, '$.tool') AS tool, json_extract(data, '$.state.input.filePath') AS filePath, json_extract(data, '$.state.input.oldString') AS oldString, json_extract(data, '$.state.input.newString') AS newString, json_extract(data, '$.state.input.content') AS content FROM part WHERE session_id IN (${allPlaceholders}) AND json_extract(data, '$.tool') IN ('edit', 'write') AND json_extract(data, '$.state.input.filePath') IS NOT NULL`,
				)
				.all(...allSessionIds);

			// Assemble in-memory maps
			const subagentsByParent = new Map<string, OpenCodeCliSessionRow[]>();
			for (const sub of subagentSessions) {
				if (!sub.parent_id) continue;
				const list = subagentsByParent.get(sub.parent_id) ?? [];
				list.push(sub);
				subagentsByParent.set(sub.parent_id, list);
			}

			const toolsBySession = new Map<string, OpenCodeCliToolUsageRow[]>();
			for (const tr of toolRows) {
				if (!tr.tool) continue;
				const list = toolsBySession.get(tr.session_id) ?? [];
				list.push({ tool: tr.tool, count: tr.count });
				toolsBySession.set(tr.session_id, list);
			}

			const diffsBySession = new Map<string, FileDiffStat[]>();
			const rawDiffMap = new Map<
				string,
				Map<string, { additions: number; deletions: number }>
			>();

			for (const er of editRows) {
				if (!er.filePath) continue;
				let innerMap = rawDiffMap.get(er.session_id);
				if (!innerMap) {
					innerMap = new Map();
					rawDiffMap.set(er.session_id, innerMap);
				}

				const current = innerMap.get(er.filePath) ?? {
					additions: 0,
					deletions: 0,
				};
				if (er.tool === "edit") {
					current.additions += er.newString
						? er.newString.split("\n").length
						: 0;
					current.deletions += er.oldString
						? er.oldString.split("\n").length
						: 0;
				} else if (er.tool === "write") {
					current.additions += er.content ? er.content.split("\n").length : 0;
				}
				innerMap.set(er.filePath, current);
			}

			for (const [sessId, fileMap] of rawDiffMap.entries()) {
				const stats: FileDiffStat[] = [];
				for (const [filePath, diff] of fileMap.entries()) {
					stats.push({
						filePath,
						additions: diff.additions,
						deletions: diff.deletions,
					});
				}
				diffsBySession.set(sessId, stats);
			}

			return {
				rootSessions,
				subagentsByParent,
				toolsBySession,
				diffsBySession,
			};
		}) ?? {
			rootSessions: [],
			// Type param eksplisit agar union return type tidak merusak inferensi caller
			subagentsByParent: new Map<string, OpenCodeCliSessionRow[]>(),
			toolsBySession: new Map<string, OpenCodeCliToolUsageRow[]>(),
			diffsBySession: new Map<string, FileDiffStat[]>(),
		}
	);
}

export function fetchRootSessions(
	cutoffTs?: number,
	sessionFilter?: string | null,
): OpenCodeCliSessionRow[] {
	return fetchAllSessionData(cutoffTs, sessionFilter).rootSessions;
}

export function fetchSubagentSessions(
	parentIds: string[],
): OpenCodeCliSessionRow[] {
	if (parentIds.length === 0) return [];
	const res = fetchAllSessionData(0, null);
	const out: OpenCodeCliSessionRow[] = [];
	for (const pid of parentIds) {
		const subs = res.subagentsByParent.get(pid);
		if (subs) out.push(...subs);
	}
	return out;
}

export function fetchSessionTools(
	sessionId: string,
): OpenCodeCliToolUsageRow[] {
	const res = fetchAllSessionData(0, sessionId);
	return res.toolsBySession.get(sessionId) ?? [];
}

export function fetchSessionModifiedFiles(sessionId: string): string[] {
	const res = fetchAllSessionData(0, sessionId);
	const diffs = res.diffsBySession.get(sessionId) ?? [];
	return diffs.map((d) => d.filePath);
}

export function fetchSessionFileDiffStats(sessionId: string): FileDiffStat[] {
	const res = fetchAllSessionData(0, sessionId);
	return res.diffsBySession.get(sessionId) ?? [];
}

export function parseModelName(rawModel: string | null): string {
	if (!rawModel) return "unknown";
	try {
		const parsed = JSON.parse(rawModel);
		return parsed.id || parsed.name || "unknown";
	} catch {
		return rawModel;
	}
}
