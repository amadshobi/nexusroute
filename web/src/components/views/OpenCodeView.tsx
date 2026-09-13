import { useState, useMemo } from "react";
import {
	ArrowUpRight,
	ChevronsUpDown,
	ChevronsDownUp,
	Copy,
	Check,
} from "lucide-react";
import { MiniSparkline } from "../charts/MiniSparkline";
import { TimeFilterBar } from "../common/TimeFilterBar";
import {
	formatCompact,
	formatDateWIB,
	formatShortPath,
	extractModelId,
	computeTimeSeriesBuckets,
} from "@/lib/formatters";
import { ProviderIcon } from "../icons/ProviderIcons";
import { resolveAgentRole } from "@/lib/registries/agent-roles";
import type { AgentsData, OpenCodeSession } from "@/types/dashboard";

function formatIdr(usd: number, rate: number = 17000): string {
	const idr = usd * rate;
	if (idr >= 1_000_000_000_000) {
		return `Rp${(idr / 1_000_000_000_000).toFixed(2)}T`;
	}
	if (idr >= 1_000_000_000) {
		return `Rp${(idr / 1_000_000_000).toFixed(2)}M`;
	}
	if (idr >= 1_000_000) {
		return `Rp${(idr / 1_000_000).toFixed(2)}jt`;
	}
	if (idr >= 1_000) {
		return `Rp${(idr / 1_000).toFixed(1)}rb`;
	}
	return `Rp${Math.round(idr).toLocaleString("id-ID")}`;
}

interface OpenCodeViewProps {
	agents: AgentsData | null;
	timeRange: string;
	setTimeRange: (range: string) => void;
	lastRefreshed?: number;
}

interface SessionTreeNode {
	session: OpenCodeSession;
	children: OpenCodeSession[];
	totalTokens: number;
	totalCost: number;
}

interface ProjectGroup {
	projectPath: string;
	displayPath: string;
	latestUpdated: number;
	totalCost: number;
	totalTokens: number;
	treeNodes: SessionTreeNode[];
}

export function OpenCodeView({
	agents,
	timeRange,
	setTimeRange,
}: OpenCodeViewProps) {
	const opencode = agents?.opencode;
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});

	// Currency switcher state (matches DashboardView standard)
	const [currency, setCurrency] = useState<"USD" | "IDR">(() => {
		return (localStorage.getItem("nexus_currency") as "USD" | "IDR") || "USD";
	});
	const [usdIdrRate] = useState<number>(() => {
		const saved = localStorage.getItem("nexus_usd_idr_rate") || localStorage.getItem("gn_usd_idr_rate");
		return saved ? Number(saved) : 17000;
	});

	const handleCopy = async (id: string) => {
		try {
			await navigator.clipboard.writeText(id);
			setCopiedId(id);
			setTimeout(() => setCopiedId(null), 2000);
		} catch {
			// Fallback
		}
	};

	const toggleProject = (path: string) => {
		setOpenProjects((prev) => ({
			...prev,
			[path]: !prev[path],
		}));
	};

	// Filter sessions by time range
	// Backend query already filtered recentSessions via SQL `?range=...`
	// Use recentSessions directly to prevent timezone mismatch & double-filtering bugs.
	const filteredSessions = useMemo(() => {
		return opencode?.recentSessions || [];
	}, [opencode?.recentSessions]);

	// Dynamic stats for selected time range
	const stats = useMemo(() => {
		let cost = 0;
		let grossCost = 0;
		let input = 0;
		let output = 0;
		let cache = 0;
		let messages = 0;
		for (const s of filteredSessions) {
			cost += s.cost || 0;
			const inT = s.tokens_input || 0;
			const outT = s.tokens_output || 0;
			const cT = s.tokens_cache_read || 0;
			input += inT;
			output += outT;
			cache += cT;
			messages += outT ? Math.max(1, Math.ceil(outT / 40)) : 1;
			// Estimate gross cost without cache discount
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
			messagesCount: opencode?.messagesCount || messages,
		};
	}, [filteredSessions, opencode?.messagesCount]);

	// Group sessions into Parent -> Subagents tree per project path
	const projectGroups = useMemo(() => {
		const map = new Map<string, {
			projectPath: string;
			displayPath: string;
			latestUpdated: number;
			totalCost: number;
			totalTokens: number;
			sessions: OpenCodeSession[];
		}>();

		for (const session of filteredSessions) {
			const rawPath = session.project_path || session.directory || "/";
			const group = map.get(rawPath) || {
				projectPath: rawPath,
				displayPath: formatShortPath(rawPath),
				latestUpdated: 0,
				totalCost: 0,
				totalTokens: 0,
				sessions: [],
			};

			const sessionTokens =
				(session.tokens_input || 0) +
				(session.tokens_output || 0) +
				(session.tokens_cache_read || 0) +
				(session.tokens_cache_write || 0) +
				(session.tokens_reasoning || 0);

			group.sessions.push(session);
			group.totalCost += session.cost || 0;
			group.totalTokens += sessionTokens;
			if (session.time_updated > group.latestUpdated) {
				group.latestUpdated = session.time_updated;
			}

			map.set(rawPath, group);
		}

		// Convert sessions into Parent -> Subagents treeNodes
		const result: ProjectGroup[] = [];

		for (const rawGroup of map.values()) {
			const sessionById = new Map<string, OpenCodeSession>();
			for (const s of rawGroup.sessions) {
				sessionById.set(s.id, s);
			}

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

			// Sort roots newest-first
			rootSessions.sort((a, b) => b.time_updated - a.time_updated);

			const treeNodes: SessionTreeNode[] = rootSessions.map((root) => {
				const kids = childrenByParent.get(root.id) || [];
				kids.sort((a, b) => a.time_created - b.time_created); // chronological subagent steps

				let nodeTokens =
					(root.tokens_input || 0) +
					(root.tokens_output || 0) +
					(root.tokens_cache_read || 0) +
					(root.tokens_cache_write || 0) +
					(root.tokens_reasoning || 0);
				let nodeCost = root.cost || 0;

				for (const k of kids) {
					nodeTokens +=
						(k.tokens_input || 0) +
						(k.tokens_output || 0) +
						(k.tokens_cache_read || 0) +
						(k.tokens_cache_write || 0) +
						(k.tokens_reasoning || 0);
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
	}, [filteredSessions]);

	const isProjectOpen = (path: string) => {
		return openProjects[path] ?? false;
	};

	// Dynamic, zero-hardcode sparklines from filtered sessions
	const cacheReadSparkline = useMemo(() => {
		return computeTimeSeriesBuckets(
			filteredSessions,
			(s) => s.time_updated || s.time_created || 0,
			(s) => s.tokens_cache_read || 0,
			10,
		);
	}, [filteredSessions]);

	const cacheRateSparkline = useMemo(() => {
		return computeTimeSeriesBuckets(
			filteredSessions,
			(s) => s.time_updated || s.time_created || 0,
			(s) => {
				const inT = s.tokens_input || 0;
				const cT = s.tokens_cache_read || 0;
				return inT + cT > 0 ? (cT / (inT + cT)) * 100 : 0;
			},
			10,
		);
	}, [filteredSessions]);

	const costSparkline = useMemo(() => {
		return computeTimeSeriesBuckets(
			filteredSessions,
			(s) => s.time_updated || s.time_created || 0,
			(s) => s.cost || 0,
			10,
		);
	}, [filteredSessions]);

	const messagesSparkline = useMemo(() => {
		return computeTimeSeriesBuckets(
			filteredSessions,
			(s) => s.time_updated || s.time_created || 0,
			(s) =>
				s.tokens_output ? Math.max(1, Math.ceil(s.tokens_output / 40)) : 1,
			10,
		);
	}, [filteredSessions]);

	const tokensSparkline = useMemo(() => {
		return computeTimeSeriesBuckets(
			filteredSessions,
			(s) => s.time_updated || s.time_created || 0,
			(s) =>
				(s.tokens_input || 0) +
				(s.tokens_output || 0) +
				(s.tokens_cache_read || 0),
			10,
		);
	}, [filteredSessions]);

	return (
		<div className="space-y-6 font-mono text-xs">
			{/* Header: Time Filter Bar (Left aligned, matches DashboardView standard) */}
			<div className="flex items-center pb-2">
				<TimeFilterBar timeRange={timeRange} setTimeRange={setTimeRange} />
			</div>

			{/* Macro Stat Cards: 5 Observability Pillars */}
			<div className="grid grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4 font-sans">
				{/* 1. Market Value */}
				<div className="col-span-2 lg:col-span-2 rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div className="flex justify-between items-center">
						<span className="text-xs font-medium text-[#8A94A6]">Market Value</span>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setCurrency((prev) => {
									const next = prev === "USD" ? "IDR" : "USD";
									localStorage.setItem("nexus_currency", next);
									return next;
								});
							}}
							className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded border border-[#1E2433] bg-[#161B26] hover:bg-[#1E2433] text-[#8A94A6] hover:text-white transition-colors cursor-pointer"
							title="Switch Currency USD / IDR"
						>
							{currency}
						</button>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{currency === "IDR" ? formatIdr(stats.cost, usdIdrRate) : `$${stats.cost.toFixed(2)}`}
						</span>
						{stats.grossCost > stats.cost ? (
							<div className="text-[11px] text-[#64748B] font-mono line-through mt-0.5">
								{currency === "IDR"
									? formatIdr(stats.grossCost, usdIdrRate)
									: `$${stats.grossCost.toFixed(2)}`}
							</div>
						) : null}
					</div>
					<MiniSparkline data={costSparkline} color="#F59E0B" />
				</div>

				{/* 2. Token (All) */}
				<div className="col-span-2 lg:col-span-2 rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Token (All)</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#7AA2F7]">
							<ArrowUpRight className="h-3 w-3" />
						</span>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{formatCompact(stats.totalTokens)}
						</span>
					</div>
					<MiniSparkline data={tokensSparkline} color="#7AA2F7" />
				</div>

				{/* 3. Cache Read */}
				<div className="col-span-2 lg:col-span-2 rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Cache Read</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-purple-400 font-mono">
							<ArrowUpRight className="h-3 w-3" /> {stats.cacheHitRate}%
						</span>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{formatCompact(stats.cache)}
						</span>
					</div>
					<MiniSparkline data={cacheReadSparkline} color="#A855F7" />
				</div>

				{/* 4. Cache Hit Rate */}
				<div className="col-span-1 lg:col-span-3 rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Cache Hit Rate</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#00EA88]">
							<ArrowUpRight className="h-3 w-3" />
						</span>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-[#00EA88] font-mono">
							{stats.cacheHitRate}%
						</span>
					</div>
					<MiniSparkline data={cacheRateSparkline} color="#00EA88" />
				</div>

				{/* 5. Messages */}
				<div className="col-span-1 lg:col-span-3 rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Messages</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-sky-400">
							<ArrowUpRight className="h-3 w-3" />
						</span>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{formatCompact(stats.messagesCount)}
						</span>
					</div>
					<MiniSparkline data={messagesSparkline} color="#38BDF8" />
				</div>
			</div>

			{/* Project Tree Section — Finbro Asset Rows & Inverted Fold/Unfold */}
			<div className="space-y-4">
				{projectGroups.length === 0 ? (
					<div className="rounded-xl border border-[#1E2433] bg-[#131722] py-12 text-center text-xs text-[#64748B]">
						No sessions match this time range.
					</div>
				) : (
					projectGroups.map((group) => {
						const open = isProjectOpen(group.projectPath);

						return (
							<div
								key={group.projectPath}
								className="rounded-xl border border-[#1E2433] bg-[#131722] overflow-hidden shadow-sm transition-all"
							>
								{/* Project Bar Header (Accordion Toggle <> kebalik) */}
								<div
									onClick={() => toggleProject(group.projectPath)}
									className="flex items-center justify-between px-4 py-3 bg-[#131722] hover:bg-[#161B26] border-b border-[#1E2433] transition-colors cursor-pointer select-none"
								>
									<div className="flex items-center gap-2.5 min-w-0">
										<button
											type="button"
											className="p-1 rounded text-[#8A94A6] hover:text-white bg-[#1A2030] border border-[#232D42] transition-transform duration-200 shrink-0"
											title={open ? "Tutup Folder" : "Buka Folder"}
										>
											<div className={`transition-transform duration-200 ${open ? "rotate-180" : "rotate-0"}`}>
												{open ? (
													<ChevronsDownUp className="h-3.5 w-3.5 text-[#00EA88]" />
												) : (
													<ChevronsUpDown className="h-3.5 w-3.5 text-[#8A94A6]" />
												)}
											</div>
										</button>
										<span className="text-sm font-semibold text-white tracking-tight truncate">
											{group.displayPath}
										</span>
										<span className="text-xs font-mono text-[#00EA88] shrink-0">
											({group.treeNodes.length})
										</span>
									</div>

									<div className="flex items-center gap-4 text-xs font-mono shrink-0">
										<span className="text-[#8A94A6] hidden sm:inline">
											{formatCompact(group.totalTokens)} tok
										</span>
										<span className="text-amber-400 font-semibold">
											{currency === "IDR"
												? formatIdr(group.totalCost, usdIdrRate)
												: `$${group.totalCost.toFixed(2)}`}
										</span>
									</div>
								</div>

								{/* Finbro Asset Rows inside Project */}
								<div
									className={`grid transition-[grid-template-rows] duration-200 ease-out ${
										open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
									}`}
								>
									<div className="overflow-hidden divide-y divide-[#1A2030]">
										{group.treeNodes.map((node) => {
											const root = node.session;
											const subagents = node.children;
											const hasSubagents = subagents.length > 0;

											const rootInTokens = root.tokens_input || 0;
											const rootCacheTokens = root.tokens_cache_read || 0;
											const rootCacheRate =
												rootInTokens + rootCacheTokens > 0
													? Number(((rootCacheTokens / (rootInTokens + rootCacheTokens)) * 100).toFixed(1))
													: 0;

											const rootModelClean = extractModelId(root.model);

											return (
												<div key={root.id} className="divide-y divide-[#1A2030]/60">
													{/* Parent Session Row */}
													<div className="px-4 py-3 hover:bg-[#151A26] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
														{/* Asset / Task Info */}
														<div className="space-y-1 min-w-0 flex-1">
															<div className="flex items-center gap-2">
																<span className="font-semibold text-white truncate text-sm">
																	{root.title || "MAIN"}
																</span>
																{hasSubagents && (
																	<span className="px-1.5 py-0.2 text-[10px] font-mono rounded bg-[#1A2030] text-[#00EA88] border border-[#232D42] shrink-0">
																		{subagents.length} subagents
																	</span>
																)}
															</div>

															<div className="flex items-center gap-2 flex-wrap text-[11px] font-mono text-[#64748B]">
																<span>{formatDateWIB(root.time_updated)}</span>
																<span>•</span>
																<span className="text-[#94A3B8] select-all truncate max-w-[140px] sm:max-w-[200px]">
																	{root.id}
																</span>
																<button
																	type="button"
																	onClick={(e) => {
																		e.stopPropagation();
																		handleCopy(root.id);
																	}}
																	className="p-0.5 text-[#64748B] hover:text-white transition-colors"
																	title="Copy ID"
																>
																	{copiedId === root.id ? (
																		<Check className="h-3 w-3 text-[#00EA88]" />
																	) : (
																		<Copy className="h-3 w-3" />
																	)}
																</button>
															</div>
														</div>

														{/* Finbro Metrics: Model, Token, Cost, Efficiency */}
														<div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 shrink-0 font-mono text-xs">
															{/* Model & Provider Icon */}
															<div className="flex items-center gap-1.5 min-w-[130px]">
																<ProviderIcon
																	name={root.model}
																	className="h-3.5 w-3.5 shrink-0"
																/>
																<span className="text-[#CBD5E1] truncate font-sans text-xs max-w-[90px] sm:max-w-[120px]">
																	{rootModelClean}
																</span>
															</div>

															{/* Tokens */}
															<div className="text-right min-w-[70px]">
																<div className="text-white font-medium">
																	{formatCompact(node.totalTokens)}
																</div>
																<div className="text-[10px] text-[#64748B]">
																	{formatCompact(rootCacheTokens)} cache
																</div>
															</div>

															{/* Cost */}
															<div className="text-right min-w-[75px]">
																<div className="text-amber-400 font-semibold">
																	{currency === "IDR"
																		? formatIdr(node.totalCost, usdIdrRate)
																		: `$${node.totalCost.toFixed(3)}`}
																</div>
															</div>

															{/* Efficiency Return % */}
															<div className="min-w-[85px] text-right">
																<span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] font-medium bg-[#0D261C] border border-[#18573D] text-[#00EA88]">
																	<ArrowUpRight className="h-3 w-3 shrink-0" />
																	{rootCacheRate}%
																</span>
															</div>
														</div>
													</div>

													{/* Subagent Child Rows (Naming + Model + Tokens + Cost) */}
													{hasSubagents && (
														<div className="bg-[#0E121B] divide-y divide-[#171D2A] pl-4 sm:pl-8">
															{subagents.map((sub) => {
																const subRole = resolveAgentRole(sub.agent);
																const SubRoleIcon = subRole.icon;
																const subModelClean = extractModelId(sub.model);

																const subTokens =
																	(sub.tokens_input || 0) +
																	(sub.tokens_output || 0) +
																	(sub.tokens_cache_read || 0) +
																	(sub.tokens_cache_write || 0) +
																	(sub.tokens_reasoning || 0);

																return (
																	<div
																		key={sub.id}
																		className="px-4 py-2 hover:bg-[#131722] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
																	>
																		{/* Subagent Name: Icon with color, Name plain neutral (no color per user rule) */}
																		<div className="flex items-center gap-2 min-w-0">
																			<span className="text-[#64748B] font-mono">↳</span>
																			<SubRoleIcon
																				className="h-3.5 w-3.5 shrink-0"
																				style={{ color: subRole.color }}
																			/>
																			<span className="font-medium text-[#E2E8F0] font-mono text-xs">
																				{subRole.label}
																			</span>
																		</div>

																		{/* Subagent Right Metrics: Model, Token, Cost */}
																		<div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 shrink-0 font-mono text-xs">
																			<div className="flex items-center gap-1.5 min-w-[130px]">
																				<ProviderIcon
																					name={sub.model}
																					className="h-3 w-3 shrink-0"
																				/>
																				<span className="text-[#8A94A6] truncate font-sans text-[11px] max-w-[90px] sm:max-w-[120px]">
																					{subModelClean}
																				</span>
																			</div>

																			<div className="text-right min-w-[70px] text-[#8A94A6]">
																				{formatCompact(subTokens)}
																			</div>

																			<div className="text-right min-w-[75px] text-amber-400/90 font-medium">
																				{currency === "IDR"
																					? formatIdr(sub.cost || 0, usdIdrRate)
																					: `$${(sub.cost || 0).toFixed(3)}`}
																			</div>

																			<div className="min-w-[85px]" />
																		</div>
																	</div>
																);
															})}
														</div>
													)}
												</div>
											);
										})}
									</div>
								</div>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
