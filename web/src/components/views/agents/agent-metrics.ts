import { formatShortPath } from "@/lib/formatters";
import type {
	HermesSession,
	OpenCodeSession,
} from "@/types/dashboard";
import type { ProjectGroup, SessionTreeNode } from "./agent-types";

export interface OpenCodeStats {
	cost: number;
	grossCost: number;
	input: number;
	output: number;
	cache: number;
	totalTokens: number;
	cacheHitRate: number;
	messagesCount: number;
}

/** Aggregate cost / token / cache metrics across OpenCode sessions. */
export function computeOpenCodeStats(
	sessions: OpenCodeSession[],
	messagesCountFallback?: number,
): OpenCodeStats {
	let cost = 0;
	let grossCost = 0;
	let input = 0;
	let output = 0;
	let cache = 0;
	let messages = 0;

	for (const s of sessions) {
		cost += s.cost || 0;
		const inT = s.tokens_input || 0;
		const outT = s.tokens_output || 0;
		const cT = s.tokens_cache_read || 0;
		input += inT;
		output += outT;
		cache += cT;
		messages += outT ? Math.max(1, Math.ceil(outT / 40)) : 1;
		grossCost += (s.cost || 0) + (cT / 1_000_000) * 0.675;
	}

	const totalTokens = input + output + cache;
	const cacheHitRate = input + cache > 0 ? (cache / (input + cache)) * 100 : 0;

	return {
		cost,
		grossCost,
		input,
		output,
		cache,
		totalTokens,
		cacheHitRate: Number(cacheHitRate.toFixed(1)),
		messagesCount: messagesCountFallback || messages,
	};
}

function sessionTokens(session: OpenCodeSession): number {
	return (
		(session.tokens_input || 0) +
		(session.tokens_output || 0) +
		(session.tokens_cache_read || 0) +
		(session.tokens_cache_write || 0) +
		(session.tokens_reasoning || 0)
	);
}

/** Group sessions by project path into a parent -> subagent tree. */
export function buildProjectGroups(
	sessions: OpenCodeSession[],
): ProjectGroup[] {
	const map = new Map<
		string,
		{
			projectPath: string;
			displayPath: string;
			latestUpdated: number;
			totalCost: number;
			totalTokens: number;
			sessions: OpenCodeSession[];
		}
	>();

	for (const session of sessions) {
		const rawPath = session.project_path || session.directory || "/";
		const group = map.get(rawPath) || {
			projectPath: rawPath,
			displayPath: formatShortPath(rawPath),
			latestUpdated: 0,
			totalCost: 0,
			totalTokens: 0,
			sessions: [],
		};

		group.sessions.push(session);
		group.totalCost += session.cost || 0;
		group.totalTokens += sessionTokens(session);
		if (session.time_updated > group.latestUpdated) {
			group.latestUpdated = session.time_updated;
		}
		map.set(rawPath, group);
	}

	const result: ProjectGroup[] = [];

	for (const rawGroup of map.values()) {
		const sessionById = new Map<string, OpenCodeSession>();
		for (const s of rawGroup.sessions) sessionById.set(s.id, s);

		const childrenByParent = new Map<string, OpenCodeSession[]>();
		const rootSessions: OpenCodeSession[] = [];

		for (const s of rawGroup.sessions) {
			if (s.parent_id && sessionById.has(s.parent_id)) {
				const list = childrenByParent.get(s.parent_id) || [];
				list.push(s);
				childrenByParent.set(s.parent_id, list);
			} else {
				rootSessions.push(s);
			}
		}

		rootSessions.sort((a, b) => b.time_updated - a.time_updated);

		const treeNodes: SessionTreeNode[] = rootSessions.map((root) => {
			const kids = childrenByParent.get(root.id) || [];
			kids.sort((a, b) => a.time_created - b.time_created);

			let nodeTokens = sessionTokens(root);
			let nodeCost = root.cost || 0;

			for (const k of kids) {
				nodeTokens += sessionTokens(k);
				nodeCost += k.cost || 0;
			}

			return {
				session: root,
				children: kids,
				totalTokens: nodeTokens,
				totalCost: nodeCost,
			};
		});

		result.push({
			projectPath: rawGroup.projectPath,
			displayPath: rawGroup.displayPath,
			latestUpdated: rawGroup.latestUpdated,
			totalCost: rawGroup.totalCost,
			totalTokens: rawGroup.totalTokens,
			treeNodes,
		});
	}

	return result.sort((a, b) => b.latestUpdated - a.latestUpdated);
}

/** Stable timestamp accessor for OpenCode sessions. */
export function openCodeSessionTs(s: OpenCodeSession): number {
	return s.time_updated || s.time_created || 0;
}

/** Stable timestamp accessor for Hermes sessions (seconds -> ms). */
export function hermesSessionTs(s: HermesSession): number {
	return s.last_activity_at ? s.last_activity_at * 1000 : s.started_at * 1000;
}
