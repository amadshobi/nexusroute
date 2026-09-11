import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { MiniSparkline } from "../charts/MiniSparkline";
import { TimeFilterBar } from "../common/TimeFilterBar";
import { formatCompact } from "@/lib/formatters";
import type { OverviewData } from "@/types/dashboard";

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

interface DashboardViewProps {
	overview: OverviewData | null;
	timeRange: string;
	setTimeRange: (range: string) => void;
	usdIdrRate?: number;
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
	usdIdrRate = 17000,
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
							Market value
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
					</div>
					<MiniSparkline data={costSparkline} color="#10B981" />
				</div>

				{/* Card 2: Requests */}
				<div className="group rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden transition-all duration-200 animate-card-enter stagger-2">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Requests</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-400">
							<ArrowUpRight className="h-3 w-3" /> 100%
						</span>
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
						<span className="text-xs font-medium text-[#8A94A6]">Token</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#7AA2F7]">
							<ArrowUpRight className="h-3 w-3" /> Total
						</span>
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
							Context Cache
						</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-purple-400">
							Provider
						</span>
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
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-purple-400">
							Provider
						</span>
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
						<span className="text-xs font-medium text-[#8A94A6]">Input</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#7AA2F7]">
							Fresh
						</span>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono transition-opacity duration-200">
							{formatCompact(totalInputFresh)}
						</span>
					</div>
					<MiniSparkline data={inputFreshSparkline} color="#7AA2F7" />
				</div>
			</div>
		</div>
	);
}
