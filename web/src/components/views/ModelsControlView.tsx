import { useMemo, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GatewayIcon } from "@/components/icons/ProviderIcons";
import { ProviderModelDetail } from "@/components/views/models/ProviderModelDetail";
import type {
	ModelsCatalogsResponse,
	ModelsConfigResponse,
} from "@/types/dashboard";

interface ModelsControlViewProps {
	modelsConfig: ModelsConfigResponse | null;
	modelsCatalogs: ModelsCatalogsResponse | null;
	refreshModelsConfig: () => Promise<void> | void;
}

const PROVIDER_LABELS: Record<string, string> = {
	omp: "OMP Gateway",
	vansrouter: "Vans Gateway",
	commandcode: "CommandCode",
	cmc: "CommandCode",
};

function providerDisplayName(name: string): string {
	return (
		PROVIDER_LABELS[name] ??
		(name.charAt(0).toUpperCase() + name.slice(1) || name)
	);
}

export function ModelsControlView({
	modelsConfig,
	modelsCatalogs,
	refreshModelsConfig,
}: ModelsControlViewProps) {
	const [selectedUpstream, setSelectedUpstream] = useState<string | null>(null);

	const catalogs = useMemo(
		() => modelsCatalogs?.catalogs ?? {},
		[modelsCatalogs],
	);
	const whitelistMap = modelsConfig?.modelFilter.whitelist ?? {};

	const providerEntries = useMemo(
		() => Object.entries(catalogs).sort(([a], [b]) => a.localeCompare(b)),
		[catalogs],
	);

	const handleRefresh = () => {
		void refreshModelsConfig();
	};

	if (selectedUpstream !== null) {
		return (
			<ProviderModelDetail
				upstreamName={selectedUpstream}
				displayName={providerDisplayName(selectedUpstream)}
				catalog={catalogs[selectedUpstream] ?? []}
				whitelisted={whitelistMap[selectedUpstream] ?? []}
				onBack={() => setSelectedUpstream(null)}
				onSaved={refreshModelsConfig}
			/>
		);
	}

	return (
		<div className="space-y-5">
			<div className="flex items-start justify-between gap-3">
				<Button
					size="sm"
					onClick={handleRefresh}
					className="bg-[#1D68FE]/20 hover:bg-[#1D68FE]/30 text-[#7AA2F7] border border-[#1D68FE]/30 text-xs h-8 gap-1.5 cursor-pointer"
				>
					<RefreshCw className="h-3 w-3" /> Refresh
				</Button>
			</div>

			{/* Provider cards */}
			{providerEntries.length === 0 ? (
				<div className="rounded-xl border border-white/[0.08] bg-white/[0.06] bevel-inset p-5 text-xs text-[#64748B]">
					No upstream catalogs yet. Click Refresh or verify the gateway is running.
				</div>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					{providerEntries.map(([name, models]) => {
						const total = models.length;
						const configured = whitelistMap[name];
						const passthrough = !configured || configured.length === 0;
						const activeCount = passthrough ? total : configured.length;
						const pct =
							total > 0
								? Math.min(100, Math.round((activeCount / total) * 100))
								: 0;

						return (
							<div
								key={name}
								className="rounded-xl border border-white/[0.08] bg-white/[0.06] bevel-inset p-4 shadow-sm flex flex-col gap-3 hover:border-white/[0.18] transition-colors"
							>
								<div className="flex items-start justify-between gap-2">
									<div className="flex items-center gap-2 min-w-0">
										<GatewayIcon name={name} className="h-5 w-5" />
										<span className="text-sm font-semibold text-white truncate">
											{providerDisplayName(name)}
										</span>
									</div>
									{passthrough ? (
										<span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#7AA2F7]/10 border border-[#7AA2F7]/20 text-[#7AA2F7] whitespace-nowrap">
											All Active (Passthrough)
										</span>
									) : activeCount === 0 ? (
										<span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[#64748B] whitespace-nowrap">
											0 Active
										</span>
									) : (
										<span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#00EA88]/10 border border-[#00EA88]/20 text-[#00EA88] whitespace-nowrap">
											{activeCount} / {total} Active
										</span>
									)}
								</div>

								<div className="space-y-1.5">
									<div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
										<div
											className="h-full rounded-full bg-[#00EA88]"
											style={{ width: `${pct}%` }}
										/>
									</div>
									<div className="flex items-center justify-between text-[10px] text-[#64748B] font-mono">
										<span>{total} models</span>
										<span>
											{passthrough
												? "Passthrough (all allowed)"
												: `${configured.length} whitelisted`}
										</span>
									</div>
								</div>

								<Button
									size="sm"
									onClick={() => setSelectedUpstream(name)}
									className="w-full bg-[#1D68FE]/20 hover:bg-[#1D68FE]/30 text-[#7AA2F7] border border-[#1D68FE]/30 text-xs h-8 gap-1.5 cursor-pointer"
								>
									Manage Models <ArrowRight className="h-3 w-3" />
								</Button>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
