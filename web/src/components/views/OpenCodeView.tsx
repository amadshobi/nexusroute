import { useState, useMemo } from "react";
import { MiniSparkline } from "../charts/MiniSparkline";
import { TimeFilterBar } from "../common/TimeFilterBar";
import {
	formatCompact,
	formatCostDual,
	formatDateWIB,
	formatShortPath,
	extractModelId,
	computeTimeSeriesBuckets,
} from "@/lib/formatters";
import { Copy, Check, ChevronDown, ChevronRight } from "lucide-react";
import type { AgentsData, OpenCodeSession } from "@/types/dashboard";

interface OpenCodeViewProps {
	agents: AgentsData | null;
	timeRange: string;
	setTimeRange: (range: string) => void;
	lastRefreshed?: number;
}

interface ProjectGroup {
	projectPath: string;
	displayPath: string;
	latestUpdated: number;
	totalCost: number;
	totalTokens: number;
	sessions: OpenCodeSession[];
}

export function OpenCodeView({
	agents,
	timeRange,
	setTimeRange,
}: OpenCodeViewProps) {
	const opencode = agents?.opencode;
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});

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
		let input = 0;
		let output = 0;
		let cache = 0;
		for (const s of filteredSessions) {
			cost += s.cost || 0;
			input += s.tokens_input || 0;
			output += s.tokens_output || 0;
			cache += s.tokens_cache_read || 0;
		}
		return {
			cost,
			input,
			output,
			totalTokens: input + output + cache,
		};
	}, [filteredSessions]);

	// Group sessions by project path and sort newest-first
	const projectGroups = useMemo(() => {
		const map = new Map<string, ProjectGroup>();

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

		for (const group of map.values()) {
			group.sessions.sort((a, b) => b.time_updated - a.time_updated);
		}

		return Array.from(map.values()).sort(
			(a, b) => b.latestUpdated - a.latestUpdated,
		);
	}, [filteredSessions]);

	const isProjectOpen = (path: string) => {
		return openProjects[path] ?? false;
	};

	// Dynamic, zero-hardcode sparklines from filtered sessions
	const costSparkline = useMemo(() => {
		return computeTimeSeriesBuckets(
			filteredSessions,
			(s) => s.time_updated || s.time_created || 0,
			(s) => s.cost || 0,
			10,
		);
	}, [filteredSessions]);

	const sessionsSparkline = useMemo(() => {
		return computeTimeSeriesBuckets(
			filteredSessions,
			(s) => s.time_updated || s.time_created || 0,
			() => 1,
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
			{/* Header */}
			<div className="flex items-center justify-between flex-wrap gap-2 pb-2">
				<div>
					<h3 className="text-sm font-semibold text-white tracking-tight font-sans">
						OpenCode Telemetry & Projects
					</h3>
					<p className="text-xs text-[#8A94A6] font-sans">
						Hierarki sesi per-project dari ~/.local/share/opencode/opencode.db
					</p>
				</div>

				<TimeFilterBar timeRange={timeRange} setTimeRange={setTimeRange} />
			</div>

			{/* Macro Stat Cards */}
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 font-sans">
				<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">
							Total spend
						</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-400">
							{timeRange === "all" ? "All Time" : "Filtered"}
						</span>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							${stats.cost.toFixed(2)}
						</span>
					</div>
					<MiniSparkline data={costSparkline} color="#F59E0B" />
				</div>

				<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">
							Active Projects
						</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#00EA88]">
							{projectGroups.length} Paths
						</span>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{filteredSessions.length}{" "}
							<span className="text-xs text-[#64748B] font-normal font-sans">
								Sesi
							</span>
						</span>
					</div>
					<MiniSparkline data={sessionsSparkline} color="#00EA88" />
				</div>

				<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Messages</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-sky-400">
							History
						</span>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{formatCompact(opencode?.messagesCount || 0)}
						</span>
					</div>
					<MiniSparkline data={messagesSparkline} color="#38BDF8" />
				</div>

				<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">
							Token volume
						</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-purple-400 font-mono text-[10px]">
							In: {formatCompact(stats.input)}
						</span>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{formatCompact(stats.totalTokens)}
						</span>
					</div>
					<MiniSparkline data={tokensSparkline} color="#A855F7" />
				</div>
			</div>

			{/* Project Tree Section */}
			<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-5 shadow-sm space-y-4">
				{projectGroups.length === 0 ? (
					<div className="py-12 text-center text-xs text-[#64748B]">
						Tidak ada sesi yang cocok dengan rentang waktu ini.
					</div>
				) : (
					<div className="space-y-4">
						{projectGroups.map((group) => {
							const open = isProjectOpen(group.projectPath);

							return (
								<div key={group.projectPath} className="space-y-2">
									{/* Project Accordion Line */}
									<button
										type="button"
										onClick={() => toggleProject(group.projectPath)}
										className="flex items-center gap-2 text-left font-bold text-white hover:text-[#00EA88] transition-colors cursor-pointer w-full select-none"
									>
										{open ? (
											<ChevronDown className="h-4 w-4 text-[#00EA88] shrink-0" />
										) : (
											<ChevronRight className="h-4 w-4 text-[#64748B] shrink-0" />
										)}
										<span className="text-sm">
											{group.displayPath}{" "}
											<span className="text-[#00EA88] font-normal">
												( {group.sessions.length} )
											</span>
										</span>
									</button>

									{/* Sessions Indented Tree */}
									{open && (
										<div className="ml-5 pl-3 border-l border-[#1E2433] space-y-5">
											{group.sessions.map((session) => {
												const allTokens =
													(session.tokens_input || 0) +
													(session.tokens_output || 0) +
													(session.tokens_cache_read || 0) +
													(session.tokens_cache_write || 0) +
													(session.tokens_reasoning || 0);

												const modelClean = extractModelId(session.model);
												const agentName = session.agent || "assistant";

												return (
													<div key={session.id} className="space-y-1 text-xs">
														{/* name */}
														<div className="text-white">
															<span className="text-[#64748B]">name: </span>
															<span className="font-semibold">
																{session.title || "MAIN"}
															</span>
														</div>

														{/* last turn */}
														<div>
															<span className="text-[#64748B]">
																last turn:{" "}
															</span>
															<span className="text-[#E2E8F0]">
																{formatDateWIB(session.time_updated)}
															</span>
														</div>

														{/* agent */}
														<div>
															<span className="text-[#64748B]">agent: </span>
															<span className="text-[#7AA2F7]">
																{agentName}
															</span>{" "}
															<span className="text-[#64748B]">(</span>
															<span className="text-purple-400">
																{modelClean}
															</span>
															<span className="text-[#64748B]">)</span>
														</div>

														{/* Tokens */}
														<div className="space-y-0.5">
															<div>
																<span className="text-[#64748B]">Tokens: </span>
																<span className="text-white font-semibold">
																	{formatCompact(allTokens)}
																</span>
															</div>
															<div className="ml-4 space-y-0.5 text-[11px]">
																<div>
																	<span className="text-[#64748B]">
																		input:{" "}
																	</span>
																	<span className="text-[#CBD5E1]">
																		{formatCompact(session.tokens_input || 0)}
																	</span>
																</div>
																<div>
																	<span className="text-[#64748B]">
																		cache:{" "}
																	</span>
																	<span className="text-amber-300">
																		{formatCompact(
																			session.tokens_cache_read || 0,
																		)}
																	</span>
																</div>
																<div>
																	<span className="text-[#64748B]">
																		output:{" "}
																	</span>
																	<span className="text-emerald-400">
																		{formatCompact(session.tokens_output || 0)}
																	</span>
																</div>
															</div>
														</div>

														{/* cost */}
														<div>
															<span className="text-[#64748B]">cost: </span>
															<span className="text-amber-400 font-semibold">
																{formatCostDual(session.cost || 0)}
															</span>
														</div>

														{/* id */}
														<div className="flex items-center gap-2 pt-0.5">
															<span className="text-[#64748B]">id: </span>
															<span className="text-[#94A3B8] select-all">
																{session.id}
															</span>
															<button
																type="button"
																onClick={() => handleCopy(session.id)}
																className="p-1 rounded text-[#64748B] hover:text-white hover:bg-[#1E2433] transition-colors cursor-pointer inline-flex items-center gap-1"
																title="Salin Session ID"
															>
																{copiedId === session.id ? (
																	<>
																		<Check className="h-3.5 w-3.5 text-[#00EA88]" />
																		<span className="text-[10px] text-[#00EA88]">
																			Disalin!
																		</span>
																	</>
																) : (
																	<Copy className="h-3.5 w-3.5" />
																)}
															</button>
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
				)}
			</div>
		</div>
	);
}
