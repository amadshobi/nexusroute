import { useState, useMemo } from "react";
import {
	Cpu,
	Boxes,
	Terminal,
	Clock,
	Layers,
	Filter,
} from "lucide-react";
import { MiniSparkline } from "../charts/MiniSparkline";
import { ActivityStackedBarChart } from "@/components/charts/ActivityStackedBarChart";
import { ProviderIcon } from "../icons/ProviderIcons";
import { TimeFilterBar } from "../common/TimeFilterBar";
import { formatCompact } from "@/lib/formatters";
import type { ActivityBucket, OverviewData } from "@/types/dashboard";

interface LeaderboardViewProps {
	overview: OverviewData | null;
	timeRange: string;
	setTimeRange: (range: string) => void;
	activity?: ActivityBucket[];
}

export function LeaderboardView({
	overview,
	timeRange,
	setTimeRange,
	activity,
}: LeaderboardViewProps) {
	const [modelEngineFilter, setModelEngineFilter] = useState<string>("all");

	const models = overview?.leaderboard?.models ?? [];
	const providers = overview?.leaderboard?.providers ?? [];
	const clients = overview?.leaderboard?.clients ?? [];
	const totalRequests = overview?.totalRequests ?? 0;

	// Filtered models
	const filteredModels = useMemo(() => {
		if (modelEngineFilter === "all") return models;
		return models.filter((m) => {
			const modelName = m.model.toLowerCase();
			if (modelEngineFilter === "antigravity") return modelName.includes("antigravity");
			if (modelEngineFilter === "commandcode") return modelName.startsWith("cmc/") || modelName.includes("commandcode");
			if (modelEngineFilter === "openrouter") return modelName.startsWith("openrouter/");
			if (modelEngineFilter === "ollama") return modelName.startsWith("ollama/");
			if (modelEngineFilter === "deepseek") return modelName.includes("deepseek");
			return true;
		});
	}, [models, modelEngineFilter]);

	// Max values for proportional bars
	const maxModelReqs = useMemo(() => {
		if (filteredModels.length === 0) return 1;
		return Math.max(...filteredModels.map((m) => m.requests), 1);
	}, [filteredModels]);

	const maxProviderReqs = useMemo(() => {
		if (providers.length === 0) return 1;
		return Math.max(...providers.map((p) => p.requests), 1);
	}, [providers]);

	const maxClientReqs = useMemo(() => {
		if (clients.length === 0) return 1;
		return Math.max(...clients.map((c) => c.requests), 1);
	}, [clients]);

	// Segmented top provider share
	const topProvidersDistribution = useMemo(() => {
		if (providers.length === 0 || totalRequests === 0) return [];
		const colors: Record<string, string> = {
			antigravity: "#00EA88",
			commandcode: "#7AA2F7",
			openrouter: "#F59E0B",
			deepseek: "#38BDF8",
			ollama: "#EC4899",
			other: "#64748B",
		};
		return providers.slice(0, 5).map((p) => {
			const pct = Math.max(1, Math.round((p.requests / totalRequests) * 100));
			return {
				name: p.provider,
				upstream: p.upstream,
				requests: p.requests,
				pct,
				color: colors[p.provider.toLowerCase()] || "#A855F7",
			};
		});
	}, [providers, totalRequests]);

	return (
		<div className="space-y-6">
			{/* Time Range Filter Bar */}
			<div className="flex items-center">
				<TimeFilterBar timeRange={timeRange} setTimeRange={setTimeRange} />
			</div>

			{/* Activity Breakdown (Providers / Models / Tokens / Requests) */}
			<ActivityStackedBarChart
				activity={activity}
				modes={["providers", "models", "tokens", "requests"]}
				defaultMode="providers"
				modelFilter={modelEngineFilter}
				title="Activity Breakdown"
			/>

			{/* Macro Header Segmented Bar (OpenRouter / GitHub Language style) */}
			{topProvidersDistribution.length > 0 && (
				<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 sm:p-5 shadow-sm space-y-3">
					<div className="flex items-center justify-between text-xs text-[#8A94A6]">
						<div className="flex items-center gap-2 font-medium text-white">
							<Layers className="h-4 w-4 text-[#7AA2F7]" />
							<span>Provider Traffic Share</span>
						</div>
						<span className="font-mono text-[11px] text-[#64748B]">
							{topProvidersDistribution.length} Providers Active
						</span>
					</div>

					<div className="h-2.5 w-full bg-[#161B26] rounded-full overflow-hidden flex border border-[#1E2433]">
						{topProvidersDistribution.map((item, idx) => (
							<div
								key={idx}
								style={{
									width: `${item.pct}%`,
									backgroundColor: item.color,
								}}
								className="h-full transition-all duration-300"
								title={`${item.name} (${item.upstream}): ${item.pct}%`}
							/>
						))}
					</div>

					<div className="flex flex-wrap gap-2 text-xs font-mono">
						{topProvidersDistribution.map((item, idx) => (
							<div
								key={idx}
								className="flex items-center gap-1.5 text-[#8A94A6] bg-[#161B26] px-2.5 py-1 rounded-md border border-[#1E2433]"
							>
								<span
									className="h-2 w-2 rounded-full shrink-0"
									style={{ backgroundColor: item.color }}
								/>
								<span className="text-white capitalize font-sans">{item.name}</span>
								<span className="text-[#64748B] text-[10px]">
									{item.upstream !== "commandcode" && item.upstream !== "direct"
										? `(${item.upstream})`
										: "(Direct)"}
								</span>
								<span className="text-[#7AA2F7] font-semibold">{item.pct}%</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* 3 DISTINCT INDEPENDENT SECTIONS (OPENROUTER ANALYTICS STYLE) */}

			{/* SECTION 1: TOP MODELS */}
			<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 sm:p-5 shadow-sm space-y-4">
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#1E2433]">
					<div className="flex items-center gap-2">
						<Cpu className="h-4 w-4 text-[#00EA88]" />
						<div>
							<h3 className="text-sm font-semibold text-white tracking-tight">
								Top Models
							</h3>
						</div>
					</div>

					{/* Engine Sub-Filter Pills */}
					<div className="flex items-center gap-1 overflow-x-auto py-0.5 text-[11px] font-medium self-start sm:self-auto">
						<Filter className="h-3 w-3 text-[#7AA2F7] mr-1 shrink-0" />
						{["all", "antigravity", "commandcode", "openrouter", "deepseek", "ollama"].map((p) => (
							<button
								key={p}
								type="button"
								onClick={() => setModelEngineFilter(p)}
								className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer capitalize ${
									modelEngineFilter === p
										? "bg-[#1E2538] text-[#00EA88] border border-[#1E2433] font-semibold"
										: "text-[#64748B] hover:text-white"
								}`}
							>
								{p}
							</button>
						))}
					</div>
				</div>

				{filteredModels.length === 0 ? (
					<div className="p-8 text-center text-xs text-[#64748B] font-mono border border-dashed border-[#1E2433] rounded-lg">
						No model history found for the selected filter.
					</div>
				) : (
					<div className="space-y-2.5">
						{filteredModels.slice(0, 15).map((item, idx) => {
							const pct = Math.max(2, Math.round((item.requests / maxModelReqs) * 100));
							return (
								<div
									key={item.model}
									className="p-3.5 rounded-lg bg-[#161B26] border border-[#1E2433] hover:border-[#2A344A] transition-all space-y-2.5"
								>
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-2.5 min-w-0">
											<span className="text-[11px] font-mono text-[#64748B] w-5 shrink-0">
												#{idx + 1}
											</span>
											<ProviderIcon name={item.model} className="h-4 w-4 shrink-0" />
											<span className="text-xs font-mono font-medium text-white truncate" title={item.model}>
												{item.model}
											</span>
										</div>

										<div className="shrink-0 flex items-center gap-2 sm:gap-3">
											{item.sparkline && (
												<div className="w-16 sm:w-20 h-4 hidden xs:block">
													<MiniSparkline data={item.sparkline} color="#00EA88" />
												</div>
											)}
											<span className="text-xs font-mono font-bold text-white">
												{formatCompact(item.requests)}
												<span className="text-[10px] text-[#64748B] font-normal ml-0.5">reqs</span>
											</span>
										</div>
									</div>

									{/* Sleek Gradient Bar */}
									<div className="h-1.5 w-full bg-[#10141D] rounded-full overflow-hidden">
										<div
											className="h-full bg-gradient-to-r from-[#00EA88] to-[#10B981] rounded-full transition-all duration-300"
											style={{ width: `${pct}%` }}
										/>
									</div>

									{/* Metrics Row */}
									<div className="flex items-center justify-between text-[11px] font-mono text-[#8A94A6] flex-wrap gap-x-3 gap-y-1">
										<div className="flex items-center gap-2.5">
											<span>
												Tokens: <span className="text-[#7AA2F7] font-semibold">{formatCompact(item.tokensTotal)}</span>
											</span>
											{item.cacheRate > 0 && (
												<span className="text-purple-400">
													Cache: {item.cacheRate}%
												</span>
											)}
										</div>
										<div className="flex items-center gap-2.5">
											{item.avgLatencyMs > 0 && (
												<span className="flex items-center gap-1 text-[#64748B]">
													<Clock className="h-3 w-3" />
													{item.avgLatencyMs}ms
												</span>
											)}
											{item.costUsd > 0 && (
												<span className="text-emerald-400 font-semibold">
													${item.costUsd.toFixed(3)}
												</span>
											)}
										</div>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* SECTION 2: TOP PROVIDERS & TRANSPORT GATEWAYS */}
			<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 sm:p-5 shadow-sm space-y-4">
				<div className="flex items-center justify-between pb-3 border-b border-[#1E2433]">
					<div className="flex items-center gap-2">
						<Boxes className="h-4 w-4 text-[#7AA2F7]" />
						<div>
							<h3 className="text-sm font-semibold text-white tracking-tight">
								Top Providers & Gateway
							</h3>
						</div>
					</div>
				</div>

				{providers.length === 0 ? (
					<div className="p-8 text-center text-xs text-[#64748B] font-mono border border-dashed border-[#1E2433] rounded-lg">
						No provider history recorded yet.
					</div>
				) : (
					<div className="space-y-2.5">
						{providers.map((item, idx) => {
							const pct = Math.max(2, Math.round((item.requests / maxProviderReqs) * 100));
							const isDirect = item.upstream === "commandcode" || item.upstream === "direct";

							return (
								<div
									key={`${item.provider}::${item.upstream}`}
									className="p-3.5 rounded-lg bg-[#161B26] border border-[#1E2433] hover:border-[#2A344A] transition-all space-y-2.5"
								>
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-2 min-w-0">
											<span className="text-[11px] font-mono text-[#64748B] w-5 shrink-0">
												#{idx + 1}
											</span>
											<ProviderIcon name={item.provider} className="h-4 w-4 shrink-0" />
											<span className="text-xs font-semibold text-white capitalize">
												{item.provider}
											</span>

											<span
												className={`text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase shrink-0 ${
													isDirect
														? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
														: "bg-[#7AA2F7]/10 text-[#7AA2F7] border-[#7AA2F7]/20"
												}`}
											>
												{isDirect ? "Direct" : `via ${item.upstream}`}
											</span>
										</div>

										<div className="shrink-0 flex items-center gap-2 sm:gap-3">
											{item.sparkline && (
												<div className="w-16 sm:w-20 h-4 hidden xs:block">
													<MiniSparkline data={item.sparkline} color="#7AA2F7" />
												</div>
											)}
											<span className="text-xs font-mono font-bold text-white">
												{formatCompact(item.requests)}
												<span className="text-[10px] text-[#64748B] font-normal ml-0.5">reqs</span>
											</span>
										</div>
									</div>

									<div className="h-1.5 w-full bg-[#10141D] rounded-full overflow-hidden">
										<div
											className="h-full bg-gradient-to-r from-[#7AA2F7] to-[#3B82F6] rounded-full transition-all duration-300"
											style={{ width: `${pct}%` }}
										/>
									</div>

									<div className="flex items-center justify-between text-[11px] font-mono text-[#8A94A6] flex-wrap gap-x-3 gap-y-1">
										<span>
											Tokens: <span className="text-white font-semibold">{formatCompact(item.tokensTotal)}</span>
										</span>
										<div className="flex items-center gap-2.5">
											{item.avgLatencyMs > 0 && (
												<span className="flex items-center gap-1 text-[#64748B]">
													<Clock className="h-3 w-3" />
													{item.avgLatencyMs}ms avg
												</span>
											)}
											{item.costUsd > 0 && (
												<span className="text-emerald-400 font-semibold">
													${item.costUsd.toFixed(3)}
												</span>
											)}
										</div>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* SECTION 3: TOP CLIENT APPS */}
			<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 sm:p-5 shadow-sm space-y-4">
				<div className="flex items-center justify-between pb-3 border-b border-[#1E2433]">
					<div className="flex items-center gap-2">
						<Terminal className="h-4 w-4 text-[#A855F7]" />
						<div>
							<h3 className="text-sm font-semibold text-white tracking-tight">
								Top Client Apps
							</h3>
						</div>
					</div>
				</div>

				{clients.length === 0 ? (
					<div className="p-8 text-center text-xs text-[#64748B] font-mono border border-dashed border-[#1E2433] rounded-lg">
						No client application history in access log.
					</div>
				) : (
					<div className="space-y-2.5">
						{clients.map((item, idx) => {
							const pct = Math.max(2, Math.round((item.requests / maxClientReqs) * 100));
							return (
								<div
									key={item.client}
									className="p-3.5 rounded-lg bg-[#161B26] border border-[#1E2433] hover:border-[#2A344A] transition-all space-y-2.5"
								>
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-2 min-w-0">
											<span className="text-[11px] font-mono text-[#64748B] w-5 shrink-0">
												#{idx + 1}
											</span>
											<Terminal className="h-4 w-4 text-[#A855F7] shrink-0" />
											<span className="text-xs font-semibold text-white capitalize font-mono">
												{item.client}
											</span>
										</div>

										<span className="text-xs font-mono font-bold text-white shrink-0">
											{formatCompact(item.requests)}
											<span className="text-[10px] text-[#64748B] font-normal ml-0.5">reqs</span>
										</span>
									</div>

									<div className="h-1.5 w-full bg-[#10141D] rounded-full overflow-hidden">
										<div
											className="h-full bg-gradient-to-r from-[#A855F7] to-[#8B5CF6] rounded-full transition-all duration-300"
											style={{ width: `${pct}%` }}
										/>
									</div>

									<div className="flex items-center justify-between text-[11px] font-mono text-[#8A94A6]">
										<span>
											Tokens: <span className="text-white font-semibold">{formatCompact(item.tokensTotal)}</span>
										</span>
										{item.costUsd > 0 && (
											<span className="text-emerald-400 font-semibold">
												${item.costUsd.toFixed(3)}
											</span>
										)}
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
