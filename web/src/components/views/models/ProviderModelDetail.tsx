import { useCallback, useMemo, useRef, useState } from "react";
import {
	Activity,
	ArrowLeft,
	Check,
	ChevronDown,
	ChevronRight,
	Loader2,
	Search,
	SlidersHorizontal,
	TriangleAlert,
	X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toast, type ToastMessage } from "@/components/views/models/Toast";
import { ProviderAccordion } from "@/components/views/models/ProviderAccordion";
import {
	getProviderFromModel,
	providerDisplayName,
} from "@/components/views/models/model-utils";

interface ProviderModelDetailProps {
	upstreamName: string;
	displayName: string;
	catalog: string[];
	whitelisted: string[];
	onBack: () => void;
	onSaved: () => Promise<void> | void;
}

interface ProviderGroup {
	provider: string;
	total: number;
	active: string[];
	pool: string[];
}

function uniqueSorted(values: string[]): string[] {
	return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

/**
 * Per-upstream whitelist editor with instant auto-save, grouped by provider.
 *
 * Baseline: when the upstream has no explicit whitelist it is in Passthrough,
 * so the working set is seeded with the FULL catalog. Removing a model in that
 * state persists `allModels - target`, which materializes an explicit whitelist
 * and truly excludes the model.
 *
 * Backend semantics (gateway/server.ts `isModelWhitelisted`): an empty whitelist
 * means "all models pass". "Disable All" therefore saves `[]`, which the backend
 * treats as Passthrough — surfaced via an explicit warning banner.
 */
export function ProviderModelDetail({
	upstreamName,
	displayName,
	catalog,
	whitelisted,
	onBack,
	onSaved,
}: ProviderModelDetailProps) {
	const allModels = useMemo(
		() => uniqueSorted([...catalog, ...whitelisted]),
		[catalog, whitelisted],
	);

	const baseline = useMemo(
		() => uniqueSorted(whitelisted.length > 0 ? whitelisted : allModels),
		[whitelisted, allModels],
	);

	const [activeSet, setActiveSet] = useState<Set<string>>(
		() => new Set(baseline),
	);
	const [search, setSearch] = useState("");
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	const [saving, setSaving] = useState(false);
	const [toast, setToast] = useState<ToastMessage | null>(null);

	const [pingSnapshots] = useState<
		Record<string, { statusCode: number; latencyMs: number }>
	>(() => {
		try {
			const raw =
				localStorage.getItem("nexus_model_ping_snapshots") ||
				localStorage.getItem("gn_model_ping_snapshots");
			return raw ? JSON.parse(raw) : {};
		} catch {
			return {};
		}
	});

	const toastIdRef = useRef(0);
	const pendingRef = useRef(0);
	const persistQueue = useRef<Promise<void>>(Promise.resolve());

	const dismissToast = useCallback(() => setToast(null), []);

	const showToast = (
		message: string,
		tone: "success" | "error" = "success",
	) => {
		toastIdRef.current += 1;
		setToast({ id: toastIdRef.current, message, tone });
	};

	// Serialize writes so rapid clicks cannot land out of order on the backend.
	const persist = (next: Set<string>, message: string) => {
		setActiveSet(next);
		pendingRef.current += 1;
		setSaving(true);
		const models = Array.from(next).sort();

		persistQueue.current = persistQueue.current.then(async () => {
			try {
				const res = await fetch("/api/dashboard/models/whitelist", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ upstream: upstreamName, models }),
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				showToast(message);
				await onSaved();
			} catch (e) {
				showToast(`Failed to save: ${(e as Error).message}`, "error");
			} finally {
				pendingRef.current -= 1;
				if (pendingRef.current <= 0) {
					pendingRef.current = 0;
					setSaving(false);
				}
			}
		});
	};

	const addModel = (model: string) => {
		const next = new Set(activeSet);
		next.add(model);
		persist(next, `${model} enabled to whitelist`);
	};

	const removeModel = (model: string) => {
		const next = new Set(activeSet);
		next.delete(model);
		persist(next, `${model} disabled`);
	};

	const setProviderActive = (group: ProviderGroup, active: boolean) => {
		const next = new Set(activeSet);
		for (const model of [...group.active, ...group.pool]) {
			if (active) next.add(model);
			else next.delete(model);
		}
		const label = providerDisplayName(group.provider);
		persist(
			next,
			active
				? `All ${label} models enabled`
				: `All ${label} models disabled`,
		);
	};

	const syncWithPingResults = () => {
		const tested = allModels.filter((m) => pingSnapshots[m] !== undefined);
		if (tested.length === 0) {
			showToast(
				"No ping history yet. Run a test in the Ping menu first.",
				"error",
			);
			return;
		}

		const next = new Set<string>();
		let okCount = 0;
		let failCount = 0;

		for (const model of allModels) {
			const snap = pingSnapshots[model];
			if (snap) {
				if (snap.statusCode === 200) {
					next.add(model);
					okCount += 1;
				} else {
					failCount += 1;
				}
			} else {
				// Model belum pernah di-ping: pertahankan status aktif saat ini
				if (activeSet.has(model)) {
					next.add(model);
				}
			}
		}

		persist(
			next,
			`Ping Sync: ${okCount} models active (200 OK), ${failCount} disabled`,
		);
	};

	const query = search.trim().toLowerCase();

	const providerGroups = useMemo<ProviderGroup[]>(() => {
		const map = new Map<string, { active: string[]; pool: string[] }>();
		for (const model of allModels) {
			const provider = getProviderFromModel(model);
			const entry = map.get(provider) ?? { active: [], pool: [] };
			if (activeSet.has(model)) entry.active.push(model);
			else entry.pool.push(model);
			map.set(provider, entry);
		}
		return Array.from(map.entries())
			.map(([provider, { active, pool }]) => ({
				provider,
				active,
				pool,
				total: active.length + pool.length,
			}))
			.sort((a, b) => a.provider.localeCompare(b.provider));
	}, [allModels, activeSet]);

	const withQuery = (models: string[]) =>
		query === ""
			? models
			: models.filter((m) => m.toLowerCase().includes(query));

	const visibleGroups = query
		? providerGroups.filter(
				(g) =>
					g.active.some((m) => m.toLowerCase().includes(query)) ||
					g.pool.some((m) => m.toLowerCase().includes(query)) ||
					g.provider.toLowerCase().includes(query),
			)
		: providerGroups;

	// Searching force-expands providers so matches are always visible.
	const isOpen = (provider: string) => (query ? true : !collapsed[provider]);
	const toggleProvider = (provider: string) =>
		setCollapsed((prev) => ({ ...prev, [provider]: !prev[provider] }));
	// Single dynamic toggle for Expand / Collapse all groups
	const isAllCollapsed = useMemo(() => {
		if (providerGroups.length === 0) return false;
		return providerGroups.every((g) => collapsed[g.provider]);
	}, [providerGroups, collapsed]);

	const toggleAllExpandCollapse = () => {
		if (isAllCollapsed) {
			// Sekarang semua ketutup -> expand all
			setCollapsed({});
		} else {
			// Sekarang ada yang kebuka -> collapse all
			const next: Record<string, boolean> = {};
			for (const group of providerGroups) next[group.provider] = true;
			setCollapsed(next);
		}
	};

	const activeCount = allModels.filter((m) => activeSet.has(m)).length;

	return (
		<div className="space-y-4">
			<Toast
				key={toast?.id ?? "empty"}
				toast={toast}
				onDismiss={dismissToast}
			/>

			{/* Clean Minimal Header */}
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={onBack}
						className="text-[#8A94A6] hover:text-white hover:bg-[#161B26] h-8 px-2 gap-1.5 text-xs cursor-pointer"
					>
						<ArrowLeft className="h-3.5 w-3.5" /> Kembali
					</Button>
					<h3 className="text-base font-semibold text-white font-mono">
						{displayName}
					</h3>
				</div>
				<div className="flex items-center gap-1.5 text-[10px] font-mono text-[#64748B]">
					{saving ? (
						<>
							<Loader2 className="h-3 w-3 animate-spin text-[#7AA2F7] alert" />
							<span>Saving...</span>
						</>
					) : (
						<>
							<Check className="h-3 w-3 text-[#00EA88]" />
							<span className="hidden sm:inline">Auto-saved</span>
						</>
					)}
				</div>
			</div>

			{/* Search & Actions Bar */}
			<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
				<div className="relative flex-1">
					<Search className="h-3.5 w-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
					<input
						type="text"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search models or providers..."
						className="w-full bg-[#161B26] border border-[#1E2433] rounded-lg pl-9 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#1D68FE] font-mono"
					/>
				</div>
				<div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
					{/* Single Expand / Collapse Button */}
					<Button
						size="sm"
						onClick={toggleAllExpandCollapse}
						className="bg-[#161B26] hover:bg-[#1E2433] text-[#8A94A6] border border-[#1E2433] text-xs h-8 px-2.5 gap-1.5 cursor-pointer whitespace-nowrap"
					>
						{isAllCollapsed ? (
							<>
								<ChevronDown className="h-3 w-3" /> Expand
							</>
						) : (
							<>
								<ChevronRight className="h-3 w-3" /> Collapse
							</>
						)}
					</Button>
					<Button
						size="sm"
						onClick={syncWithPingResults}
						className="bg-[#00EA88]/15 hover:bg-[#00EA88]/25 text-[#00EA88] border border-[#00EA88]/30 text-xs h-8 px-2.5 gap-1.5 cursor-pointer whitespace-nowrap"
						title="Automatically enable 200 OK models and disable FAIL models based on Ping test results"
					>
						<Activity className="h-3 w-3" /> Sync with Ping
					</Button>
					<Button
						size="sm"
						onClick={() =>
							persist(new Set(allModels), "All models enabled")
						}
						className="bg-[#161B26] hover:bg-[#1E2433] text-[#8A94A6] border border-[#1E2433] text-xs h-8 px-2.5 gap-1.5 cursor-pointer whitespace-nowrap"
					>
						<SlidersHorizontal className="h-3 w-3" /> Active All
					</Button>
					<Button
						size="sm"
						onClick={() => persist(new Set(), "All models disabled")}
						className="bg-[#161B26] hover:bg-[#1E2433] text-[#8A94A6] border border-[#1E2433] text-xs h-8 px-2.5 gap-1.5 cursor-pointer whitespace-nowrap"
					>
						<X className="h-3 w-3" /> Disable All
					</Button>
				</div>
			</div>

			{activeCount === 0 && (
				<div className="rounded-lg border border-amber-500/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300 flex items-start gap-2">
					<TriangleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
					<span>
						Empty whitelist is treated as Passthrough by the backend (all models remain active).
					</span>
				</div>
			)}

			{/* Provider accordions: Gateway -> Provider -> Model */}
			{visibleGroups.length === 0 ? (
				<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-5 text-xs text-[#64748B]">
					No models match your search query.
				</div>
			) : (
				<div className="space-y-3">
					{visibleGroups.map((group) => (
						<ProviderAccordion
							key={group.provider}
							provider={group.provider}
							total={group.total}
							activeModels={withQuery(group.active)}
							poolModels={withQuery(group.pool)}
							activeCount={group.active.length}
							allActive={group.pool.length === 0 && group.total > 0}
							open={isOpen(group.provider)}
							pingSnapshots={pingSnapshots}
							onToggle={() => toggleProvider(group.provider)}
							onActivateAll={() => setProviderActive(group, true)}
							onDeactivateAll={() => setProviderActive(group, false)}
							onAdd={addModel}
							onRemove={removeModel}
						/>
					))}
				</div>
			)}
		</div>
	);
}
