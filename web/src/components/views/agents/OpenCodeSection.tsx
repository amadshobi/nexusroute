import { useMemo, useState } from "react";
import {
	ChevronRight,
	Copy,
	Check,
	Bot,
	TrendingUp,
	TrendingDown,
} from "lucide-react";
import { MiniSparkline } from "@/components/charts/MiniSparkline";
import {
	formatCompact,
	formatDateWIB,
	formatIdr,
	formatModelDisplayName,
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
	visible?: boolean;
	onToggleCurrency: () => void;
}

export function OpenCodeSection({
	opencode,
	currency,
	usdIdrRate,
	visible = true,
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

	const freshInputSparkline = useMemo(
		() =>
			computeTimeSeriesBuckets(
				sessions,
				openCodeSessionTs,
				(s) => s.tokens_input || 0,
				10,
			),
		[sessions],
	);

	const renderTrendBadge = (
		delta: number | null | undefined,
		options: { invertColors?: boolean; suffix?: string } = {},
	) => {
		if (delta === null || delta === undefined || isNaN(delta)) {
			return null;
		}

		const isZero = delta === 0;
		const isPositive = delta > 0;
		const formattedDelta = `${isPositive ? "+" : ""}${delta.toFixed(1)}${options.suffix ?? "%"}`;

		let colorClass = "";
		const Icon = isPositive ? TrendingUp : TrendingDown;

		if (isZero) {
			colorClass = "text-[#8A94A6]";
		} else if (options.invertColors) {
			// For spending: increase is amber warning, decrease is green saving
			colorClass = isPositive ? "text-amber-400" : "text-emerald-400";
		} else {
			// For requests, tokens, cache: increase is green, decrease is red
			colorClass = isPositive ? "text-emerald-400" : "text-[#F87171]";
		}

		return (
			<span
				className={`inline-flex items-center gap-0.5 text-[11px] font-mono font-medium ${colorClass}`}
			>
				{!isZero && <Icon className="h-3 w-3 shrink-0" />}
				<span>{formattedDelta}</span>
			</span>
		);
	};

	return (
		<section className={visible ? "space-y-6" : "hidden"}>
			<div className="flex items-center gap-2">
				<Bot className="h-3.5 w-3.5 text-sky-400" />
				<h3 className="text-sm font-semibold text-white tracking-tight">
					OpenCode Telemetry
				</h3>
			</div>

			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 font-sans">
				{/* Card 1: Total Spend */}
				<div className="group rounded-xl border border-white/[0.08] bg-white/[0.06] bevel-inset hover:border-white/[0.18] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-200 animate-card-enter stagger-1">
					<div className="flex justify-between items-center">
						<span className="text-xs font-medium text-[#8A94A6]">Total Spend</span>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onToggleCurrency();
							}}
							className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] bevel-inset-subtle text-[#8A94A6] hover:text-white transition-colors cursor-pointer"
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
						<div className="flex items-center gap-2 mt-0.5 min-h-[16px] flex-wrap">
							{stats.grossCost > stats.cost ? (
								<div className="text-[11px] text-[#64748B] font-mono line-through">
									{currency === "IDR"
										? formatIdr(stats.grossCost, usdIdrRate)
										: `$${stats.grossCost.toFixed(2)}`}
								</div>
							) : null}
							{renderTrendBadge(opencode?.trends?.spendDelta, {
								invertColors: true,
							})}
						</div>
					</div>
					<MiniSparkline data={costSparkline} color="#10B981" />
				</div>

				{/* Card 2: Messages */}
				<div className="group rounded-xl border border-white/[0.08] bg-white/[0.06] bevel-inset hover:border-white/[0.18] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-200 animate-card-enter stagger-2">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Messages</span>
						{renderTrendBadge(opencode?.trends?.messagesDelta)}
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{formatCompact(stats.messagesCount)}
						</span>
					</div>
					<MiniSparkline data={messagesSparkline} color="#00EA88" />
				</div>

				{/* Card 3: Tokens */}
				<div className="group rounded-xl border border-white/[0.08] bg-white/[0.06] bevel-inset hover:border-white/[0.18] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-200 animate-card-enter stagger-3">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Tokens</span>
						{renderTrendBadge(opencode?.trends?.tokensDelta)}
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{formatCompact(stats.totalTokens)}
						</span>
					</div>
					<MiniSparkline data={tokensSparkline} color="#7AA2F7" />
				</div>

				{/* Card 4: Cache Hit */}
				<div className="group rounded-xl border border-white/[0.08] bg-white/[0.06] bevel-inset hover:border-white/[0.18] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-200 animate-card-enter stagger-4">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Cache Hit</span>
						{renderTrendBadge(opencode?.trends?.cacheRateDelta)}
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{stats.cacheHitRate}%
						</span>
					</div>
					<MiniSparkline data={cacheRateSparkline} color="#A855F7" />
				</div>
			</div>

			{/* Second Row: 2 Sparkline Cards for Cache Read & Fresh Input */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 font-sans">
				{/* Card 1: Cache Read */}
				<div className="group rounded-xl border border-white/[0.08] bg-white/[0.06] bevel-inset hover:border-white/[0.18] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-200 animate-card-enter stagger-5">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Cache Read</span>
						{renderTrendBadge(opencode?.trends?.cacheReadDelta)}
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{formatCompact(stats.cache)}
						</span>
					</div>
					<MiniSparkline data={cacheReadSparkline} color="#A855F7" />
				</div>

				{/* Card 2: Fresh Input */}
				<div className="group rounded-xl border border-white/[0.08] bg-white/[0.06] bevel-inset hover:border-white/[0.18] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-200 animate-card-enter stagger-6">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Fresh Input</span>
						{renderTrendBadge(opencode?.trends?.inputFreshDelta)}
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{formatCompact(stats.input)}
						</span>
					</div>
					<MiniSparkline data={freshInputSparkline} color="#7AA2F7" />
				</div>
			</div>

			{/* Project / session tree */}
			<div className="space-y-4">
				{projectGroups.length === 0 ? (
					<div className="rounded-xl border border-white/[0.08] bg-white/[0.06] bevel-inset hover:border-white/[0.18] py-12 text-center text-xs text-[#64748B]">
						No sessions match this time range.
					</div>
				) : (
					projectGroups.map((group) => {
						const open = isProjectOpen(group.projectPath);
						return (
							<div
								key={group.projectPath}
								className="rounded-xl border border-white/[0.08] bg-white/[0.06] bevel-inset hover:border-white/[0.18] overflow-hidden shadow-sm transition-all"
							>
								<div
									onClick={() => toggleProject(group.projectPath)}
									className="flex items-center justify-between px-4 py-3 bg-white/[0.02] hover:bg-white/[0.05] border-b border-white/[0.08] transition-colors cursor-pointer select-none"
								>
									<div className="flex items-center gap-2.5 min-w-0">
										<button
											type="button"
											className="p-1 rounded text-[#8A94A6] hover:text-white bg-[#1A2030] border border-[#232D42] transition-colors shrink-0"
											title={open ? "Collapse project" : "Expand project"}
										>
											<ChevronRight
												className={`h-3.5 w-3.5 text-[#8A94A6] transition-transform duration-200 ${
													open ? "rotate-90 text-[#00EA88]" : "rotate-0"
												}`}
											/>
										</button>
										<span
											className="text-sm font-semibold text-white tracking-tight truncate"
											title={group.projectPath}
										>
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

														<div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 shrink-0 font-mono text-xs overflow-x-auto scrollbar-none py-0.5">
															<div className="flex items-center gap-1.5 shrink-0">
																<ProviderIcon
																	name={root.model}
																	className="h-3.5 w-3.5 shrink-0"
																/>
																<span
																	className="text-white font-medium text-xs whitespace-nowrap"
																	title={root.model}
																>
																	{formatModelDisplayName(root.model)}
																</span>
															</div>

															<div className="text-right min-w-[55px] shrink-0">
																<span className="text-white font-medium">
																	{formatCompact(node.totalTokens)}
																</span>
															</div>

															<div className="text-right min-w-[65px] shrink-0">
																<span className="text-amber-400 font-semibold">
																	{currency === "IDR"
																		? formatIdr(node.totalCost, usdIdrRate)
																		: `$${node.totalCost.toFixed(2)}`}
																</span>
															</div>
														</div>
													</div>

													{hasSubagents && (
														<div className="bg-[#0B0E15] border-t border-white/[0.08]/40 overflow-x-auto scrollbar-none px-3 sm:px-6 py-2">
															<table className="w-full text-xs font-mono border-collapse min-w-[380px] sm:min-w-0">
																<thead>
																	<tr className="text-[10px] uppercase tracking-wider text-[#64748B] border-b border-white/[0.08]/50 select-none">
																		<th className="py-1.5 pl-1 pr-3 text-left font-medium w-24">Role</th>
																		<th className="py-1.5 px-3 text-left font-medium">Model</th>
																		<th className="py-1.5 px-3 text-right font-medium w-20">Tokens</th>
																		<th className="py-1.5 pl-3 pr-1 text-right font-medium w-24">Spend</th>
																	</tr>
																</thead>
																<tbody className="divide-y divide-[#161B26]">
																	{subagents.map((sub) => {
																		const subRole = resolveAgentRole(sub.agent);
																		const subTokens =
																			(sub.tokens_input || 0) +
																			(sub.tokens_output || 0) +
																			(sub.tokens_cache_read || 0) +
																			(sub.tokens_cache_write || 0) +
																			(sub.tokens_reasoning || 0);

																		return (
																			<tr
																				key={sub.id}
																				className="hover:bg-[#121622]/80 transition-colors"
																			>
																				<td className="py-2 pl-1 pr-3 whitespace-nowrap">
																					<span className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded bg-[#161B26] border border-white/[0.08] text-[#7AA2F7]">
																						{subRole.label.toLowerCase()}
																					</span>
																				</td>
																				<td className="py-2 px-3 whitespace-nowrap">
																					<div className="flex items-center gap-1.5 font-sans font-medium text-white">
																						<ProviderIcon
																							name={sub.model}
																							className="h-3.5 w-3.5 shrink-0"
																						/>
																						<span title={sub.model}>
																							{formatModelDisplayName(sub.model)}
																						</span>
																					</div>
																				</td>
																				<td className="py-2 px-3 text-right text-[#8A94A6] whitespace-nowrap">
																					{formatCompact(subTokens)}
																				</td>
																				<td className="py-2 pl-3 pr-1 text-right text-amber-400/90 font-medium whitespace-nowrap">
																					{currency === "IDR"
																						? formatIdr(sub.cost || 0, usdIdrRate)
																						: `$${(sub.cost || 0).toFixed(2)}`}
																				</td>
																			</tr>
																		);
																	})}
																</tbody>
															</table>
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
