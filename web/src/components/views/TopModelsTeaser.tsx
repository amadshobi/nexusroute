import { useMemo } from "react";
import { Cpu, ArrowRight } from "lucide-react";
import { MiniSparkline } from "../charts/MiniSparkline";
import { ProviderIcon } from "../icons/ProviderIcons";
import { formatCompact } from "@/lib/formatters";
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
	const maxReqs = useMemo(() => {
		if (topModels.length === 0) return 1;
		return Math.max(...topModels.map((m) => m.requests), 1);
	}, [topModels]);

	return (
		<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 sm:p-5 shadow-sm space-y-3.5 animate-card-enter">
			<div className="flex items-center justify-between pb-3 border-b border-[#1E2433]">
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
				<div className="space-y-2">
					{topModels.map((item, idx) => {
						const pct = Math.max(2, Math.round((item.requests / maxReqs) * 100));
						return (
							<div
								key={item.model}
								className="p-2.5 rounded-lg bg-[#161B26] border border-[#1E2433] space-y-1.5"
							>
								<div className="flex items-center justify-between gap-2">
									<div className="flex items-center gap-2 min-w-0">
										<span className="text-[11px] font-mono text-[#64748B] w-4 shrink-0">
											#{idx + 1}
										</span>
										<ProviderIcon name={item.model} className="h-3.5 w-3.5 shrink-0" />
										<span className="text-xs font-mono text-white truncate" title={item.model}>
											{item.model}
										</span>
									</div>

									<div className="flex items-center gap-2 shrink-0">
										{item.sparkline && (
											<div className="w-12 h-3.5 hidden xs:block">
												<MiniSparkline data={item.sparkline} color="#00EA88" />
											</div>
										)}
										<span className="text-xs font-mono font-bold text-white">
											{formatCompact(item.requests)}
											<span className="text-[10px] text-[#64748B] font-normal ml-0.5">reqs</span>
										</span>
									</div>
								</div>

								{/* Mini sleek progress bar */}
								<div className="h-1 w-full bg-[#10141D] rounded-full overflow-hidden">
									<div
										className="h-full bg-gradient-to-r from-[#00EA88] to-[#10B981] rounded-full transition-all duration-300"
										style={{ width: `${pct}%` }}
									/>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
