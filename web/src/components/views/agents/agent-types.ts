import type { AgentsData, OpenCodeSession } from "@/types/dashboard";

/** A root OpenCode session with its nested subagent sessions. */
export interface SessionTreeNode {
	session: OpenCodeSession;
	children: OpenCodeSession[];
	totalTokens: number;
	totalCost: number;
}

/** OpenCode sessions grouped by project path. */
export interface ProjectGroup {
	projectPath: string;
	displayPath: string;
	latestUpdated: number;
	totalCost: number;
	totalTokens: number;
	treeNodes: SessionTreeNode[];
}

export type OpenCodeAgentData = AgentsData["opencode"];

export type Currency = "USD" | "IDR";
