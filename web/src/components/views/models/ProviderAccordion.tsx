import { ChevronDown, ChevronRight, Cpu, Minus, Plus, X } from "lucide-react";
import { ProviderIcon } from "@/components/icons/ProviderIcons";
import {
	providerDisplayName,
	shortModelName,
} from "@/components/views/models/model-utils";

interface ProviderAccordionProps {
	provider: string;
	total: number;
	activeModels: string[];
	poolModels: string[];
	activeCount: number;
	allActive?: boolean;
	open: boolean;
	onToggle: () => void;
	onActivateAll: () => void;
	onDeactivateAll: () => void;
	onAdd: (model: string) => void;
	onRemove: (model: string) => void;
}

/** One provider group card: Gateway -> Provider -> Model. */
export function ProviderAccordion({
	provider,
	total,
	activeModels,
	poolModels,
	activeCount,
	open,
	onToggle,
	onActivateAll,
	onDeactivateAll,
	onAdd,
	onRemove,
}: ProviderAccordionProps) {
	const label = providerDisplayName(provider);

	return (
		<div className="rounded-xl border border-[#1E2433] bg-[#131722] overflow-hidden">
			<div className="flex items-center justify-between gap-3 p-3 hover:bg-[#161B26] transition-colors">
				<button
					onClick={onToggle}
					className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
				>
					{open ? (
						<ChevronDown className="h-3.5 w-3.5 text-[#8A94A6] shrink-0" />
					) : (
						<ChevronRight className="h-3.5 w-3.5 text-[#8A94A6] shrink-0" />
					)}
					<ProviderIcon name={provider} className="h-4 w-4 shrink-0" />
					<span className="text-xs font-semibold text-white truncate">
						{label}
					</span>
					<span className="text-[10px] text-[#64748B] font-mono shrink-0">
						({total})
					</span>
				</button>
				<div className="flex items-center gap-2 shrink-0">
					{/* Badge status: Aktif jika >= 1 model aktif, Nonaktif abu-abu jika 0 */}
					<span
						className={`text-[10px] font-mono px-2 py-0.5 rounded-md border whitespace-nowrap ${
							activeCount > 0
								? "bg-[#00EA88]/10 border-[#00EA88]/30 text-[#00EA88]"
								: "bg-[#161B26] border-[#1E2433] text-[#64748B]"
						}`}
					>
						{activeCount > 0 ? "Aktif" : "Nonaktif"}
					</span>
					<button
						onClick={onActivateAll}
						title={`Aktifkan semua model ${label}`}
						className="inline-flex items-center justify-center h-6 w-6 rounded bg-[#161B26] hover:bg-[#1E2433] border border-[#1E2433] text-[#00EA88] hover:text-[#00EA88]/80 cursor-pointer transition-colors"
					>
						<Plus className="h-3 w-3" />
					</button>
					<button
						onClick={onDeactivateAll}
						title={`Nonaktifkan semua model ${label}`}
						className="inline-flex items-center justify-center h-6 w-6 rounded bg-[#161B26] hover:bg-[#1E2433] border border-[#1E2433] text-[#8A94A6] hover:text-rose-400 cursor-pointer transition-colors"
					>
						<Minus className="h-3 w-3" />
					</button>
				</div>
			</div>

			{open && (
				<div className="border-t border-[#1E2433] p-3 space-y-3">
					<div className="space-y-2">
						<span className="text-[10px] uppercase tracking-wider text-[#64748B] font-mono block">
							Active ({activeModels.length})
						</span>
						{activeModels.length === 0 ? (
							<span className="block text-[11px] text-[#64748B]">
								Tidak ada model aktif.
							</span>
						) : (
							<div className="grid grid-cols-2 gap-1.5 sm:gap-2">
								{activeModels.map((model) => (
									<div
										key={model}
										className="flex items-center justify-between gap-1.5 rounded-lg bg-[#161B26] border border-[#1E2433] px-2.5 py-1.5 hover:border-[#1E2538] transition-colors min-w-0"
									>
										<span className="flex items-center gap-1.5 min-w-0 flex-1">
											<Cpu className="h-3 w-3 text-[#00EA88] shrink-0" />
											<span className="text-[11px] sm:text-xs text-white font-mono truncate" title={model}>
												{shortModelName(model)}
											</span>
										</span>
										<button
											onClick={() => onRemove(model)}
											title={`Nonaktifkan ${model}`}
											className="text-[#64748B] hover:text-rose-400 cursor-pointer shrink-0 p-0.5"
										>
											<X className="h-3 w-3" />
										</button>
									</div>
								))}
							</div>
						)}
					</div>

					<div className="space-y-2">
						<span className="text-[10px] uppercase tracking-wider text-[#64748B] font-mono block">
							Available in Catalog ({poolModels.length})
						</span>
						{poolModels.length === 0 ? (
							<span className="block text-[11px] text-[#64748B]">
								Semua model provider ini sudah aktif.
							</span>
						) : (
							<div className="flex flex-wrap gap-2">
								{poolModels.map((model) => (
									<button
										key={model}
										onClick={() => onAdd(model)}
										className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#1E2433] bg-[#161B26] px-3 py-1 text-[11px] font-mono text-[#8A94A6] hover:border-[#1D68FE] hover:text-[#7AA2F7] transition-colors cursor-pointer"
									>
										<Plus className="h-3 w-3" /> {shortModelName(model)}
									</button>
								))}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
