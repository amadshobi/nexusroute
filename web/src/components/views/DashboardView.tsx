import { useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { MiniSparkline } from "../charts/MiniSparkline";
import { ActivityStackedBarChart } from "@/components/charts/ActivityStackedBarChart";
import { TimeFilterBar } from "../common/TimeFilterBar";
import { TopModelsTeaser } from "./TopModelsTeaser";
import { formatCompact, formatIdr } from "@/lib/formatters";
import type { ActivityBucket, OverviewData } from "@/types/dashboard";

interface DashboardViewProps {
	overview: OverviewData | null;
	timeRange: string;
	setTimeRange: (range: string) => void;
	onNavigateLeaderboard?: () => void;
	usdIdrRate?: number;
	activity?: ActivityBucket[];
	estCloudCost: string;
	totalReqCount: number;
	totalTokens: number;
	cacheHitRate: number;
	totalCacheRead: number;
	totalInputFresh: number;
	costSparkline: number[];
	reqSparkline: number[];
	tokenSparkline: number[];
	cacheSparkline: number[];
	cacheReadSparkline: number[];
	inputFreshSparkline: number[];
}

export function DashboardView({
	overview,
	timeRange,
	setTimeRange,
	onNavigateLeaderboard,
	usdIdrRate = 17000,
	activity,
	estCloudCost,
	totalReqCount,
	totalTokens,
	cacheHitRate,
	totalCacheRead,
	totalInputFresh,
	costSparkline,
	reqSparkline,
	tokenSparkline,
	cacheSparkline,
	cacheReadSparkline,
	inputFreshSparkline,
}: DashboardViewProps) {
	const [currency, setCurrency] = useState<"USD" | "IDR">("USD");

	const rawCost =
		overview?.totalSpendUsd !== undefined
			? overview.totalSpendUsd
			: parseFloat(estCloudCost) || 0;

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
		<div className="space-y-6">
			{/* Time Range Filter Bar */}
			<div className="flex items-center">
				<TimeFilterBar timeRange={timeRange} setTimeRange={setTimeRange} />
			</div>

			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
				{/* Card 1: Total spend (True Market Value) */}
				<div className="group rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-200 animate-card-enter stagger-1">
					<div className="flex justify-between items-center">
						<span className="text-xs font-medium text-[#8A94A6]">
							Total Spend
						</span>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setCurrency((prev) => (prev === "USD" ? "IDR" : "USD"));
							}}
							className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded border border-[#1E2433] bg-[#161B26] hover:bg-[#1E2433] text-[#8A94A6] hover:text-white transition-colors cursor-pointer"
							title="Switch Currency USD / IDR"
						>
							{currency}
						</button>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono transition-opacity duration-200">
							{currency === "IDR"
								? formatIdr(rawCost, usdIdrRate)
								: `$${estCloudCost}`}
						</span>
						<div className="flex items-center gap-2 mt-0.5 min-h-[16px] flex-wrap">
							{overview?.grossCostUsd && overview.grossCostUsd > rawCost ? (
								<div className="text-[11px] text-[#64748B] font-mono line-through">
									{currency === "IDR"
										? formatIdr(overview.grossCostUsd, usdIdrRate)
										: `$${overview.grossCostUsd.toFixed(2)}`}
								</div>
							) : null}
							{renderTrendBadge(overview?.trends?.spendDelta, {
								invertColors: true,
							})}
						</div>
					</div>
					<MiniSparkline data={costSparkline} color="#10B981" />
				</div>

				{/* Card 2: Requests */}
				<div className="group rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-200 animate-card-enter stagger-2">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Requests</span>
						{renderTrendBadge(overview?.trends?.requestsDelta)}
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono transition-opacity duration-200">
							{formatCompact(totalReqCount)}
						</span>
					</div>
					<MiniSparkline data={reqSparkline} color="#00EA88" />
				</div>

				{/* Card 3: Token */}
				<div className="group rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-200 animate-card-enter stagger-3">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Tokens</span>
						{renderTrendBadge(overview?.trends?.tokensDelta)}
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono transition-opacity duration-200">
							{formatCompact(totalTokens)}
						</span>
					</div>
					<MiniSparkline data={tokenSparkline} color="#7AA2F7" />
				</div>

				{/* Card 4: Context Cache Rate */}
				<div className="group rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-200 animate-card-enter stagger-4">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">
							Cache Hit
						</span>
						{renderTrendBadge(overview?.trends?.cacheRateDelta)}
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono transition-opacity duration-200">
							{cacheHitRate}%
						</span>
					</div>
					<MiniSparkline data={cacheSparkline} color="#A855F7" />
				</div>
			</div>

			{/* Second Row: 2 Sparkline Cards for Cache Read & Input */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
				{/* Card 1: Cache Read */}
				<div className="group rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-200 animate-card-enter stagger-5">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">
							Cache Read
						</span>
						{renderTrendBadge(overview?.trends?.cacheReadDelta)}
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono transition-opacity duration-200">
							{formatCompact(totalCacheRead)}
						</span>
					</div>
					<MiniSparkline data={cacheReadSparkline} color="#A855F7" />
				</div>

				{/* Card 2: Input */}
				<div className="group rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-200 animate-card-enter stagger-6">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Fresh Input</span>
						{renderTrendBadge(overview?.trends?.inputFreshDelta)}
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono transition-opacity duration-200">
							{formatCompact(totalInputFresh)}
						</span>
					</div>
					<MiniSparkline data={inputFreshSparkline} color="#7AA2F7" />
				</div>
			</div>

			{/* Third Row: Activity Timeline */}
			<ActivityStackedBarChart
				activity={activity}
				currency={currency}
				usdIdrRate={usdIdrRate}
				modes={["tokens", "cost", "requests"]}
				defaultMode="tokens"
				title="Activity"
			/>

			{/* Fourth Row: Top Models Teaser */}
			<TopModelsTeaser
				models={overview?.leaderboard?.models}
				onViewAll={onNavigateLeaderboard}
			/>
		</div>
	);
}
