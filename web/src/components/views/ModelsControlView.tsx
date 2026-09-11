import { useMemo, useState } from "react";
import { ArrowRight, Plus, RefreshCw, ShieldBan, X } from "lucide-react";
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
	// null = mirror server config; non-null = in-flight optimistic edit.
	const [optimisticBlacklist, setOptimisticBlacklist] = useState<
		string[] | null
	>(null);
	const [newBlacklistInput, setNewBlacklistInput] = useState("");
	const [savingBlacklist, setSavingBlacklist] = useState(false);
	const [blacklistError, setBlacklistError] = useState<string | null>(null);

	const catalogs = useMemo(
		() => modelsCatalogs?.catalogs ?? {},
		[modelsCatalogs],
	);
	const whitelistMap = modelsConfig?.modelFilter.whitelist ?? {};
	const blacklist =
		optimisticBlacklist ?? modelsConfig?.modelFilter.blacklist ?? [];

	const providerEntries = useMemo(
		() => Object.entries(catalogs).sort(([a], [b]) => a.localeCompare(b)),
		[catalogs],
	);

	const persistBlacklist = async (models: string[]) => {
		setSavingBlacklist(true);
		setBlacklistError(null);
		setOptimisticBlacklist(models);
		try {
			const res = await fetch("/api/dashboard/models/blacklist", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ models }),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			await refreshModelsConfig();
			setOptimisticBlacklist(null);
		} catch (e) {
			setBlacklistError(`Gagal menyimpan blacklist: ${(e as Error).message}`);
			setOptimisticBlacklist(null);
		} finally {
			setSavingBlacklist(false);
		}
	};

	const addBlacklist = () => {
		const model = newBlacklistInput.trim();
		if (!model || blacklist.includes(model)) return;
		setNewBlacklistInput("");
		void persistBlacklist([...blacklist, model]);
	};

	const removeBlacklist = (model: string) => {
		void persistBlacklist(blacklist.filter((m) => m !== model));
	};

	const handleRefresh = () => {
		setOptimisticBlacklist(null);
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
				<div>
					<h3 className="text-sm font-semibold text-white">
						Model Governance & Routing
					</h3>
					<p className="text-xs text-[#8A94A6] mt-0.5">
						Kontrol katalog model upstream, whitelist aktif untuk coding agent,
						dan isolasi blacklist
					</p>
				</div>
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
				<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-5 text-xs text-[#64748B]">
					Belum ada katalog upstream. Tekan Refresh atau pastikan gateway aktif.
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
								className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 shadow-sm flex flex-col gap-3 hover:border-[#1E2538] transition-colors"
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
									) : (
										<span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#00EA88]/10 border border-[#00EA88]/20 text-[#00EA88] whitespace-nowrap">
											{activeCount} / {total} Active
										</span>
									)}
								</div>

								<div className="space-y-1.5">
									<div className="h-1.5 w-full rounded-full bg-[#161B26] overflow-hidden">
										<div
											className="h-full rounded-full bg-[#00EA88]"
											style={{ width: `${pct}%` }}
										/>
									</div>
									<div className="flex items-center justify-between text-[10px] text-[#64748B] font-mono">
										<span>{total} models</span>
										<span>
											{passthrough
												? "tanpa whitelist"
												: `${configured.length} whitelisted`}
										</span>
									</div>
								</div>

								<Button
									size="sm"
									onClick={() => setSelectedUpstream(name)}
									className="w-full bg-[#1D68FE]/20 hover:bg-[#1D68FE]/30 text-[#7AA2F7] border border-[#1D68FE]/30 text-xs h-8 gap-1.5 cursor-pointer"
								>
									Kelola Model <ArrowRight className="h-3 w-3" />
								</Button>
							</div>
						);
					})}
				</div>
			)}

			{/* Global blacklist */}
			<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 space-y-3">
				<div>
					<span className="text-xs font-semibold text-white flex items-center gap-1.5">
						<ShieldBan className="h-3.5 w-3.5 text-rose-400" /> Global Blacklist
						(Block & Reject)
					</span>
					<p className="text-[11px] text-[#8A94A6] mt-0.5">
						Model di daftar ini ditolak langsung oleh proxy (HTTP 403) dan
						disembunyikan dari /v1/models
					</p>
				</div>

				<div className="flex gap-2">
					<input
						type="text"
						value={newBlacklistInput}
						onChange={(e) => setNewBlacklistInput(e.target.value)}
						onKeyDown={(e) =>
							e.key === "Enter" && newBlacklistInput.trim() && addBlacklist()
						}
						placeholder="Ketik nama model yang ingin di-block (mis. gpt-4-legacy)..."
						className="flex-1 bg-[#161B26] border border-[#1E2433] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500 font-mono"
					/>
					<Button
						size="sm"
						onClick={addBlacklist}
						disabled={!newBlacklistInput.trim() || savingBlacklist}
						className="bg-rose-500/20 hover:bg-rose-500/30 disabled:opacity-40 disabled:cursor-not-allowed text-rose-400 border border-rose-500/30 text-xs h-9 px-3 gap-1 cursor-pointer"
					>
						<Plus className="h-3 w-3" /> Block
					</Button>
				</div>

				{blacklistError && (
					<div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
						{blacklistError}
					</div>
				)}

				{blacklist.length === 0 ? (
					<span className="block text-xs text-[#64748B] py-2">
						Tidak ada model di blacklist.
					</span>
				) : (
					<div className="flex flex-wrap gap-2">
						{blacklist.map((model) => (
							<span
								key={model}
								className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-mono"
							>
								{model}
								<button
									onClick={() => removeBlacklist(model)}
									disabled={savingBlacklist}
									className="hover:text-rose-200 cursor-pointer disabled:opacity-40"
									title={`Hapus ${model} dari blacklist`}
								>
									<X className="h-3 w-3" />
								</button>
							</span>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
