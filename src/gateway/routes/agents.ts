import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseTimeBounds, type GatewayContext } from "../context";

export async function handleAgentsTelemetry(
	_req: Request,
	url: URL,
	_ctx: GatewayContext,
): Promise<Response> {
	const agentType = url.searchParams.get("type") || "all";
	const rangeParam = url.searchParams.get("range") || "all";
	const bounds = parseTimeBounds(rangeParam);
	const result: any = { timeRange: rangeParam };

	if (agentType === "all" || agentType === "opencode") {
		try {
			const ocDbPath =
				process.env.OPENCODE_DB_PATH ??
				join(homedir(), ".local", "share", "opencode", "opencode.db");
			if (existsSync(ocDbPath)) {
				const ocDb = new Database(ocDbPath, { readonly: true });
				try {
					const isAll = bounds.startMs === 0 && bounds.endMs === Infinity;
					const isBounded = bounds.endMs !== Infinity;

					let countQ = "SELECT COUNT(*) as count FROM session";
					let msgQ = "SELECT COUNT(*) as count FROM message";
					let statsQ =
						"SELECT SUM(tokens_input) as input, SUM(tokens_output) as output, SUM(tokens_cache_read) as cacheRead, SUM(cost) as cost FROM session";
					let recentQ = `
						SELECT 
							s.id, 
							s.parent_id,
							s.title, 
							s.time_created, 
							s.time_updated, 
							s.model, 
							s.agent, 
							s.cost,
							s.tokens_input, 
							s.tokens_output, 
							s.tokens_reasoning, 
							s.tokens_cache_read, 
							s.tokens_cache_write,
							s.directory,
							s.project_id,
							CASE
								WHEN p.worktree IS NULL OR p.worktree = '/' THEN s.directory
								ELSE p.worktree
							END as project_path,
							p.name as project_name
						FROM session s
						LEFT JOIN project p ON s.project_id = p.id
					`;

					let sessionsCount = 0;
					let messagesCount = 0;
					let tokenStats: any = null;
					let recentSessions: any[] = [];

					if (isAll) {
						sessionsCount = (ocDb.query(countQ).get() as any)?.count || 0;
						messagesCount = (ocDb.query(msgQ).get() as any)?.count || 0;
						tokenStats = ocDb.query(statsQ).get() as any;
						recentSessions = ocDb
							.query(`${recentQ} ORDER BY s.time_updated DESC`)
							.all();
					} else if (isBounded) {
						countQ += " WHERE time_updated >= :start AND time_updated < :end";
						msgQ += " WHERE time_updated >= :start AND time_updated < :end";
						statsQ += " WHERE time_updated >= :start AND time_updated < :end";
						recentQ +=
							" WHERE s.time_updated >= :start AND s.time_updated < :end ORDER BY s.time_updated DESC";

						sessionsCount =
							(
								ocDb.query(countQ).get({
									":start": bounds.startMs,
									":end": bounds.endMs,
								}) as any
							)?.count || 0;
						messagesCount =
							(
								ocDb.query(msgQ).get({
									":start": bounds.startMs,
									":end": bounds.endMs,
								}) as any
							)?.count || 0;
						tokenStats = ocDb.query(statsQ).get({
							":start": bounds.startMs,
							":end": bounds.endMs,
						}) as any;
						recentSessions = ocDb
							.query(recentQ)
							.all({ ":start": bounds.startMs, ":end": bounds.endMs });
					} else {
						countQ += " WHERE time_updated >= :start";
						msgQ += " WHERE time_updated >= :start";
						statsQ += " WHERE time_updated >= :start";
						recentQ +=
							" WHERE s.time_updated >= :start ORDER BY s.time_updated DESC";

						sessionsCount =
							(ocDb.query(countQ).get({ ":start": bounds.startMs }) as any)
								?.count || 0;
						messagesCount =
							(ocDb.query(msgQ).get({ ":start": bounds.startMs }) as any)
								?.count || 0;
						tokenStats = ocDb
							.query(statsQ)
							.get({ ":start": bounds.startMs }) as any;
						recentSessions = ocDb
							.query(recentQ)
							.all({ ":start": bounds.startMs });
					}

					let trends: any = null;
					if (!isAll && bounds.startMs > 0) {
						const nowMs = Date.now();
						const span =
							(bounds.endMs !== Infinity ? bounds.endMs : nowMs) -
							bounds.startMs;
						const prevStart = bounds.startMs - span;
						const prevEnd = bounds.startMs;

						try {
							const prevStatsQ =
								"SELECT SUM(tokens_input) as input, SUM(tokens_output) as output, SUM(tokens_cache_read) as cacheRead, SUM(cost) as cost FROM session WHERE time_updated >= :start AND time_updated < :end";
							const prevMsgQ =
								"SELECT COUNT(*) as count FROM message WHERE time_updated >= :start AND time_updated < :end";

							const prevStats = ocDb
								.query(prevStatsQ)
								.get({ ":start": prevStart, ":end": prevEnd }) as any;
							const prevMessages =
								(
									ocDb
										.query(prevMsgQ)
										.get({ ":start": prevStart, ":end": prevEnd }) as any
								)?.count || 0;

							const computeDelta = (curr: number, prev: number): number | null => {
								if (prev <= 0) {
									return curr > 0 ? 100 : 0;
								}
								return Number((((curr - prev) / prev) * 100).toFixed(1));
							};

							const currInput = tokenStats?.input || 0;
							const currOutput = tokenStats?.output || 0;
							const currCacheRead = tokenStats?.cacheRead || 0;
							const currTokens = currInput + currOutput + currCacheRead;
							const currCost = tokenStats?.cost || 0;

							const prevInput = prevStats?.input || 0;
							const prevOutput = prevStats?.output || 0;
							const prevCacheRead = prevStats?.cacheRead || 0;
							const prevTokens = prevInput + prevOutput + prevCacheRead;
							const prevCost = prevStats?.cost || 0;

							const currCacheRate =
								currInput + currCacheRead > 0
									? (currCacheRead / (currInput + currCacheRead)) * 100
									: 0;
							const prevCacheRate =
								prevInput + prevCacheRead > 0
									? (prevCacheRead / (prevInput + prevCacheRead)) * 100
									: null;

							trends = {
								spendDelta: computeDelta(currCost, prevCost),
								messagesDelta: computeDelta(messagesCount, prevMessages),
								tokensDelta: computeDelta(currTokens, prevTokens),
								cacheRateDelta:
									prevCacheRate !== null
										? Number((currCacheRate - prevCacheRate).toFixed(1))
										: null,
								cacheReadDelta: computeDelta(currCacheRead, prevCacheRead),
								inputFreshDelta: computeDelta(currInput, prevInput),
							};
						} catch {
							// fallback
						}
					}

					result.opencode = {
						available: true,
						sessionsCount,
						messagesCount,
						tokensInput: tokenStats?.input || 0,
						tokensOutput: tokenStats?.output || 0,
						tokensCacheRead: tokenStats?.cacheRead || 0,
						totalCost: tokenStats?.cost || 0,
						recentSessions,
						trends: trends ?? undefined,
					};
				} finally {
					ocDb.close();
				}
			} else {
				result.opencode = {
					available: false,
					error: "Database not found",
				};
			}
		} catch (e: any) {
			result.opencode = { available: false, error: e.message };
		}
	}

	if (agentType === "all" || agentType === "hermes") {
		try {
			const hermesDbPath =
				process.env.HERMES_DB_PATH ?? join(homedir(), ".hermes", "state.db");
			if (existsSync(hermesDbPath)) {
				const hDb = new Database(hermesDbPath, { readonly: true });
				try {
					const isAll = bounds.startMs === 0 && bounds.endMs === Infinity;
					const isBounded = bounds.endMs !== Infinity;
					const startSec = bounds.startMs / 1000;
					const endSec = bounds.endMs / 1000;

					let countQ = "SELECT COUNT(*) as count FROM sessions";
					let msgQ = "SELECT COUNT(*) as count FROM messages";
					let statsQ =
						"SELECT SUM(input_tokens) as input, SUM(output_tokens) as output, SUM(actual_cost_usd) as cost FROM sessions";
					let recentQ =
						"SELECT id, title, started_at, last_activity_at, model, actual_cost_usd FROM sessions";

					let sessionsCount = 0;
					let messagesCount = 0;
					let tokenStats: any = null;
					let recentSessions: any[] = [];

					if (isAll) {
						sessionsCount = (hDb.query(countQ).get() as any)?.count || 0;
						messagesCount = (hDb.query(msgQ).get() as any)?.count || 0;
						tokenStats = hDb.query(statsQ).get() as any;
						recentSessions = hDb
							.query(
								`${recentQ} ORDER BY COALESCE(last_activity_at, started_at) DESC`,
							)
							.all();
					} else if (isBounded) {
						countQ +=
							" WHERE COALESCE(last_activity_at, started_at) >= :start AND COALESCE(last_activity_at, started_at) < :end";
						statsQ +=
							" WHERE COALESCE(last_activity_at, started_at) >= :start AND COALESCE(last_activity_at, started_at) < :end";
						recentQ +=
							" WHERE COALESCE(last_activity_at, started_at) >= :start AND COALESCE(last_activity_at, started_at) < :end ORDER BY COALESCE(last_activity_at, started_at) DESC";

						sessionsCount =
							(
								hDb.query(countQ).get({
									":start": startSec,
									":end": endSec,
								}) as any
							)?.count || 0;
						messagesCount = sessionsCount * 12;
						tokenStats = hDb.query(statsQ).get({
							":start": startSec,
							":end": endSec,
						}) as any;
						recentSessions = hDb
							.query(recentQ)
							.all({ ":start": startSec, ":end": endSec });
					} else {
						countQ += " WHERE COALESCE(last_activity_at, started_at) >= :start";
						statsQ += " WHERE COALESCE(last_activity_at, started_at) >= :start";
						recentQ +=
							" WHERE COALESCE(last_activity_at, started_at) >= :start ORDER BY COALESCE(last_activity_at, started_at) DESC";

						sessionsCount =
							(hDb.query(countQ).get({ ":start": startSec }) as any)?.count ||
							0;
						messagesCount = sessionsCount * 12;
						tokenStats = hDb.query(statsQ).get({ ":start": startSec }) as any;
						recentSessions = hDb.query(recentQ).all({ ":start": startSec });
					}

					result.hermes = {
						available: true,
						sessionsCount,
						messagesCount,
						tokensInput: tokenStats?.input || 0,
						tokensOutput: tokenStats?.output || 0,
						totalCost: tokenStats?.cost || 0,
						recentSessions,
					};
				} finally {
					hDb.close();
				}
			} else {
				result.hermes = {
					available: false,
					error: "Database not found",
				};
			}
		} catch (e: any) {
			result.hermes = { available: false, error: e.message };
		}
	}

	return new Response(JSON.stringify(result, null, 2), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}
