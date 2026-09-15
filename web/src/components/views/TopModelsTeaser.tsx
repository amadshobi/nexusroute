import { useMemo } from "react";
import { Cpu, ArrowRight } from "lucide-react";
import { MiniSparkline } from "../charts/MiniSparkline";
import { ProviderIcon } from "../icons/ProviderIcons";
import { formatCompact, formatModelDisplayName } from "@/lib/formatters";
import type { ModelLeaderboardItem } from "@/types/dashboard";

interface TopModelsTeaserProps {
	models?: ModelLeaderboardItem[];
	onViewAll?: () => void;
}

export function TopModelsTeaser({
	models = [],
	onViewAll,
}: TopModelsTeaserProps) {
	const topModels = useMemo(() => models.slice(0, 5), [models]);

	return (
		<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 sm:p-5 shadow-sm space-y-2 animate-card-enter">
			<div className="flex items-center justify-between pb-2.5 border-b border-[#1E2433]">
				<div className="flex items-center gap-2">
					<Cpu className="h-4 w-4 text-[#00EA88]" />
					<div>
						<h3 className="text-sm font-semibold text-white tracking-tight">
							Top Models
						</h3>
					</div>
				</div>

				{onViewAll && (
					<button
						type="button"
						onClick={onViewAll}
						className="text-xs font-mono text-[#00EA88] hover:text-[#00EA88]/80 flex items-center gap-1 cursor-pointer transition-colors"
					>
						<span>Leaderboard</span>
						<ArrowRight className="h-3 w-3" />
					</button>
				)}
			</div>

			{topModels.length === 0 ? (
				<div className="p-6 text-center text-xs text-[#64748B] font-mono border border-dashed border-[#1E2433] rounded-lg">
					No model history recorded for this time range.
				</div>
			) : (
				<div className="divide-y divide-[#1E2433]/60">
					{topModels.map((item, idx) => {
						const displayName = formatModelDisplayName(item.model);
						const hasTokens = item.tokensTotal && item.tokensTotal > 0;
						return (
							<div
								key={item.model}
								className="flex items-center justify-between py-2.5 px-1.5 hover:bg-[#161B26]/60 rounded-lg transition-colors group cursor-default"
							>
								{/* Left: Rank, Icon, Clean Model Name */}
								<div className="flex items-center gap-3 min-w-0">
									<span className="text-xs font-mono text-[#64748B] w-4 shrink-0 text-center">
										{idx + 1}
									</span>

									<div className="h-7 w-7 rounded-md bg-[#161B26] border border-[#1E2433] flex items-center justify-center shrink-0 group-hover:border-[#00EA88]/40 transition-colors">
										<ProviderIcon name={item.model} className="h-4 w-4" />
									</div>

									<span
										className="text-xs font-semibold text-white truncate group-hover:text-[#00EA88] transition-colors"
										title={item.model}
									>
										{displayName}
									</span>
								</div>

								{/* Right: Sparkline & Metrics Volume */}
								<div className="flex items-center gap-3 shrink-0 pl-2">
									{item.sparkline && (
										<div className="w-14 h-4 hidden sm:block opacity-60">
											<MiniSparkline data={item.sparkline} color="#00EA88" />
										</div>
									)}
									<div className="text-right font-mono min-w-[55px]">
										<div className="text-xs font-bold text-white">
											{formatCompact(
												hasTokens ? item.tokensTotal : item.requests,
											)}
											<span className="text-[10px] text-[#64748B] font-normal ml-0.5">
												{hasTokens ? "tok" : "reqs"}
											</span>
										</div>
										{hasTokens ? (
											<div className="text-[10px] text-[#64748B]">
												{formatCompact(item.requests)} reqs
											</div>
										) : null}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
