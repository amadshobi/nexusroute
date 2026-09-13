import { useMemo, useState } from "react";
import {
	ArrowUpRight,
	ChevronsUpDown,
	ChevronsDownUp,
	Copy,
	Check,
	Bot,
} from "lucide-react";
import { MiniSparkline } from "@/components/charts/MiniSparkline";
import {
	formatCompact,
	formatDateWIB,
	formatIdr,
	extractModelId,
	computeTimeSeriesBuckets,
} from "@/lib/formatters";
import { ProviderIcon } from "@/components/icons/ProviderIcons";
import { resolveAgentRole } from "@/lib/registries/agent-roles";
import { buildProjectGroups, computeOpenCodeStats, openCodeSessionTs } from "./agent-metrics";
import type { Currency, OpenCodeAgentData } from "./agent-types";

interface OpenCodeSectionProps {
	opencode?: OpenCodeAgentData;
	currency: Currency;
	usdIdrRate: number;
	visible: boolean;
	onToggleCurrency: () => void;
}

export function OpenCodeSection({
	opencode,
	currency,
	usdIdrRate,
	visible,
	onToggleCurrency,
}: OpenCodeSectionProps) {
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});

	const sessions = useMemo(
		() => opencode?.recentSessions || [],
		[opencode?.recentSessions],
	);

	const stats = useMemo(
		() => computeOpenCodeStats(sessions, opencode?.messagesCount),
		[sessions, opencode?.messagesCount],
	);

	const projectGroups = useMemo(() => buildProjectGroups(sessions), [sessions]);

	const handleCopy = async (id: string) => {
		try {
			await navigator.clipboard.writeText(id);
			setCopiedId(id);
			setTimeout(() => setCopiedId(null), 2000);
		} catch {
			// Clipboard unavailable
		}
	};

	const toggleProject = (path: string) => {
		setOpenProjects((prev) => ({ ...prev, [path]: !prev[path] }));
	};

	const isProjectOpen = (path: string) => openProjects[path] ?? false;

	const cacheReadSparkline = useMemo(
		() =>
			computeTimeSeriesBuckets(
				sessions,
				openCodeSessionTs,
				(s) => s.tokens_cache_read || 0,
				10,
			),
		[sessions],
	);

	const cacheRateSparkline = useMemo(
		() =>
			computeTimeSeriesBuckets(
				sessions,
				openCodeSessionTs,
				(s) => {
					const inT = s.tokens_input || 0;
					const cT = s.tokens_cache_read || 0;
					return inT + cT > 0 ? (cT / (inT + cT)) * 100 : 0;
				},
				10,
			),
		[sessions],
	);

	const costSparkline = useMemo(
		() =>
			computeTimeSeriesBuckets(sessions, openCodeSessionTs, (s) => s.cost || 0, 10),
		[sessions],
	);

	const messagesSparkline = useMemo(
		() =>
			computeTimeSeriesBuckets(
				sessions,
				openCodeSessionTs,
				(s) => (s.tokens_output ? Math.max(1, Math.ceil(s.tokens_output / 40)) : 1),
				10,
			),
		[sessions],
	);

	const tokensSparkline = useMemo(
		() =>
			computeTimeSeriesBuckets(
				sessions,
				openCodeSessionTs,
				(s) =>
					(s.tokens_input || 0) +
					(s.tokens_output || 0) +
					(s.tokens_cache_read || 0),
				10,
			),
		[sessions],
	);

	return (
		<section className={visible ? "space-y-6" : "hidden"}>
			<div className="flex items-center gap-2">
				<Bot className="h-3.5 w-3.5 text-sky-400" />
				<h3 className="text-sm font-semibold text-white tracking-tight">
					OpenCode Telemetry
				</h3>
			</div>

			<div className="grid grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4 font-sans">
				{/* Market Value */}
				<div className="col-span-2 lg:col-span-2 rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div className="flex justify-between items-center">
						<span className="text-xs font-medium text-[#8A94A6]">Market Value</span>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onToggleCurrency();
							}}
							className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded border border-[#1E2433] bg-[#161B26] hover:bg-[#1E2433] text-[#8A94A6] hover:text-white transition-colors cursor-pointer"
							title="Switch currency USD / IDR"
						>
							{currency}
						</button>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{currency === "IDR"
								? formatIdr(stats.cost, usdIdrRate)
								: `$${stats.cost.toFixed(2)}`}
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

				{/* Token (All) */}
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

				{/* Cache Read */}
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

				{/* Cache Hit Rate */}
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

				{/* Messages */}
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

			{/* Project / session tree */}
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
								<div
									onClick={() => toggleProject(group.projectPath)}
									className="flex items-center justify-between px-4 py-3 bg-[#131722] hover:bg-[#161B26] border-b border-[#1E2433] transition-colors cursor-pointer select-none"
								>
									<div className="flex items-center gap-2.5 min-w-0">
										<button
											type="button"
											className="p-1 rounded text-[#8A94A6] hover:text-white bg-[#1A2030] border border-[#232D42] transition-transform duration-200 shrink-0"
											title={open ? "Collapse folder" : "Expand folder"}
										>
											<div
												className={`transition-transform duration-200 ${
													open ? "rotate-180" : "rotate-0"
												}`}
											>
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
													? Number(
															(
																(rootCacheTokens /
																	(rootInTokens + rootCacheTokens)) *
																100
															).toFixed(1),
														)
													: 0;
											const rootModelClean = extractModelId(root.model);

											return (
												<div key={root.id} className="divide-y divide-[#1A2030]/60">
													<div className="px-4 py-3 hover:bg-[#151A26] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
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
																		void handleCopy(root.id);
																	}}
																	className="p-0.5 text-[#64748B] hover:text-white transition-colors cursor-pointer"
																	title="Copy session ID"
																>
																	{copiedId === root.id ? (
																		<Check className="h-3 w-3 text-[#00EA88]" />
																	) : (
																		<Copy className="h-3 w-3" />
																	)}
																</button>
															</div>
														</div>

														<div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 shrink-0 font-mono text-xs">
															<div className="flex items-center gap-1.5 min-w-[130px]">
																<ProviderIcon
																	name={root.model}
																	className="h-3.5 w-3.5 shrink-0"
																/>
																<span className="text-[#CBD5E1] truncate font-sans text-xs max-w-[90px] sm:max-w-[120px]">
																	{rootModelClean}
																</span>
															</div>

															<div className="text-right min-w-[70px]">
																<div className="text-white font-medium">
																	{formatCompact(node.totalTokens)}
																</div>
																<div className="text-[10px] text-[#64748B]">
																	{formatCompact(rootCacheTokens)} cache
																</div>
															</div>

															<div className="text-right min-w-[75px]">
																<div className="text-amber-400 font-semibold">
																	{currency === "IDR"
																		? formatIdr(node.totalCost, usdIdrRate)
																		: `$${node.totalCost.toFixed(3)}`}
																</div>
															</div>

															<div className="min-w-[85px] text-right">
																<span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] font-medium bg-[#0D261C] border border-[#18573D] text-[#00EA88]">
																	<ArrowUpRight className="h-3 w-3 shrink-0" />
																	{rootCacheRate}%
																</span>
															</div>
														</div>
													</div>

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
		</section>
	);
}
