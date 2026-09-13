import { useState, useEffect } from "react";
import {
	FlaskConical,
	Cpu,
	X,
	Loader2,
	ChevronRight,
	ChevronDown,
	RefreshCw,
	Search,
} from "lucide-react";
import { GatewayIcon, ProviderIcon } from "@/components/icons/ProviderIcons";
import type {
	PingTreeResponse,
	PingGatewayNode,
	PingProbeResponse,
} from "@/types/dashboard";

interface LogEntryItem {
	statusCode: number;
	latencyMs: number;
	target: string;
	status: "OK" | "FAIL" | "RATELIMIT" | "TIMEOUT";
	detail?: string;
}

export function PingView() {
	const [tree, setTree] = useState<PingTreeResponse | null>(null);
	const [loadingTree, setLoadingTree] = useState(true);
	const [expandedGateways, setExpandedGateways] = useState<
		Record<string, boolean>
	>({
		omp: true,
		vansrouter: true,
		commandcode: true,
	});
	const [expandedProviders, setExpandedProviders] = useState<
		Record<string, boolean>
	>({});
	const [searchQuery, setSearchQuery] = useState("");

	// Model cache snapshot: modelId -> { statusCode, latencyMs }
	const [modelSnapshots, setModelSnapshots] = useState<
		Record<string, { statusCode: number; latencyMs: number }>
	>(() => {
		if (typeof window !== "undefined") {
			try {
				const saved =
					localStorage.getItem("nexus_model_ping_snapshots") ??
					localStorage.getItem("gn_model_ping_snapshots");
				if (saved) return JSON.parse(saved);
			} catch {
				// storage fallback
			}
		}
		return {};
	});

	// Track which target is currently probing: key -> boolean
	const [probingTargets, setProbingTargets] = useState<Record<string, boolean>>(
		{},
	);

	// Top header banner state: single ping result only
	const [currentResult, setCurrentResult] = useState<LogEntryItem | null>(null);

	const fetchTree = async () => {
		setLoadingTree(true);
		try {
			const res = await fetch("/api/dashboard/ping/tree");
			if (res.ok) {
				const data = (await res.json()) as PingTreeResponse;
				setTree(data);
			}
		} catch {
			// fallback
		} finally {
			setLoadingTree(false);
		}
	};

	useEffect(() => {
		let isMounted = true;
		const timer = setTimeout(async () => {
			try {
				const res = await fetch("/api/dashboard/ping/tree");
				if (res.ok && isMounted) {
					const data = (await res.json()) as PingTreeResponse;
					setTree(data);
				}
			} catch {
				// fallback
			} finally {
				if (isMounted) setLoadingTree(false);
			}
		}, 0);
		return () => {
			isMounted = false;
			clearTimeout(timer);
		};
	}, []);

	const toggleGateway = (gwName: string) => {
		setExpandedGateways((prev) => ({
			...prev,
			[gwName]: !prev[gwName],
		}));
	};

	const toggleProvider = (provKey: string) => {
		setExpandedProviders((prev) => ({
			...prev,
			[provKey]: !prev[provKey],
		}));
	};

	const updateModelSnapshot = (
		modelId: string,
		statusCode: number,
		latencyMs: number,
	) => {
		setModelSnapshots((prev) => {
			const updated = {
				...prev,
				[modelId]: { statusCode, latencyMs },
			};
			try {
				localStorage.setItem(
					"nexus_model_ping_snapshots",
					JSON.stringify(updated),
				);
				localStorage.setItem(
					"gn_model_ping_snapshots",
					JSON.stringify(updated),
				);
			} catch {}
			return updated;
		});
	};

	const runProviderProbe = async (
		gateway: string,
		prov: { name: string; models: Array<{ id: string; displayName: string }> },
	) => {
		const provKey = `${gateway}:${prov.name}`;
		const targetKey = `pr:${gateway}:${prov.name}`;
		if (probingTargets[targetKey]) return;

		// 1. Auto-expand accordion so user sees all model spinners
		setExpandedProviders((prev) => ({ ...prev, [provKey]: true }));

		// 2. Mark provider and ALL its models as actively probing
		setProbingTargets((prev) => {
			const next = { ...prev, [targetKey]: true };
			for (const m of prov.models) {
				next[`md:${gateway}:${m.id}`] = true;
			}
			return next;
		});

		const results: Array<{
			modelId: string;
			statusCode: number;
			latencyMs: number;
		}> = [];
		const queue = [...prov.models];
		const concurrency = Math.min(3, Math.max(1, queue.length));

		const worker = async () => {
			while (queue.length > 0) {
				const m = queue.shift();
				if (!m) break;
				const modelTargetKey = `md:${gateway}:${m.id}`;

				try {
					const res = await fetch("/api/dashboard/ping/probe", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							type: "model",
							gateway,
							modelId: m.id,
						}),
					});

					if (res.ok) {
						const data = (await res.json()) as PingProbeResponse;
						updateModelSnapshot(m.id, data.statusCode, data.latencyMs);
						results.push({
							modelId: m.id,
							statusCode: data.statusCode,
							latencyMs: data.latencyMs,
						});
					} else {
						updateModelSnapshot(m.id, res.status, -1);
						results.push({
							modelId: m.id,
							statusCode: res.status,
							latencyMs: -1,
						});
					}
				} catch {
					updateModelSnapshot(m.id, 500, -1);
					results.push({
						modelId: m.id,
						statusCode: 500,
						latencyMs: -1,
					});
				} finally {
					setProbingTargets((prev) => {
						const next = { ...prev };
						delete next[modelTargetKey];
						return next;
					});
				}
			}
		};

		try {
			await Promise.all(Array.from({ length: concurrency }, () => worker()));
		} finally {
			setProbingTargets((prev) => {
				const next = { ...prev };
				delete next[targetKey];
				return next;
			});
		}

		const successCount = results.filter((r) => r.statusCode === 200).length;
		const validLatencies = results
			.filter((r) => r.latencyMs > 0)
			.map((r) => r.latencyMs);
		const avgLatency =
			validLatencies.length > 0
				? Math.round(
						validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length,
					)
				: -1;

		setCurrentResult({
			statusCode:
				successCount === results.length ? 200 : successCount > 0 ? 207 : 500,
			latencyMs: avgLatency,
			target: `${prov.name} (${successCount}/${results.length} OK)`,
			status: successCount === results.length ? "OK" : "FAIL",
			detail: `${successCount} online, ${results.length - successCount} offline`,
		});
	};

	const runProbe = async (
		type: "gateway" | "model",
		gateway: string,
		_provider?: string,
		modelId?: string,
	) => {
		const targetKey =
			type === "gateway" ? `gw:${gateway}` : `md:${gateway}:${modelId}`;

		if (probingTargets[targetKey]) return;

		setProbingTargets((prev) => ({ ...prev, [targetKey]: true }));

		try {
			const res = await fetch("/api/dashboard/ping/probe", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ type, gateway, modelId }),
			});

			if (res.ok) {
				const data = (await res.json()) as PingProbeResponse;
				const resultItem: LogEntryItem = {
					statusCode: data.statusCode,
					latencyMs: data.latencyMs,
					target: data.target,
					status: data.status,
					detail: data.detail,
				};

				if (type === "model" && modelId) {
					updateModelSnapshot(modelId, data.statusCode, data.latencyMs);
				}

				setCurrentResult(resultItem);
			} else {
				const resultItem: LogEntryItem = {
					statusCode: res.status,
					latencyMs: -1,
					target: modelId || gateway,
					status: "FAIL",
					detail: `HTTP ${res.status}`,
				};

				if (type === "model" && modelId) {
					updateModelSnapshot(modelId, res.status, -1);
				}

				setCurrentResult(resultItem);
			}
		} catch (err: any) {
			const resultItem: LogEntryItem = {
				statusCode: 500,
				latencyMs: -1,
				target: modelId || gateway,
				status: "FAIL",
				detail: err.message || "Connection Error",
			};

			if (type === "model" && modelId) {
				updateModelSnapshot(modelId, 500, -1);
			}

			setCurrentResult(resultItem);
		} finally {
			setProbingTargets((prev) => {
				const next = { ...prev };
				delete next[targetKey];
				return next;
			});
		}
	};

	const filterQuery = searchQuery.trim().toLowerCase();

	return (
		<div className="space-y-6 font-sans relative pb-8">
			{/* Top Header Probe Result: Compact, centered horizontally, non-blocking */}
			{currentResult && (
				<div className="sticky top-16 z-30 -mt-2 -mb-2 flex justify-center w-full pointer-events-none animate-page-enter">
					<div className="pointer-events-auto flex items-center gap-2 px-3 py-1 rounded-full bg-[#131722]/95 backdrop-blur-md border border-[#1E2433] shadow-xl text-[11px] font-mono text-white max-w-full overflow-x-auto scrollbar-none">
						<span
							className={`${currentResult.statusCode === 200 ? "text-[#00EA88]" : "text-rose-400"} font-bold`}
						>
							•
						</span>
						<span
							className={`${currentResult.statusCode === 200 ? "text-[#00EA88]" : "text-rose-400"} font-semibold shrink-0`}
						>
							{currentResult.statusCode}
						</span>
						<span className="text-[#64748B]">-</span>
						<span className="text-[#8A94A6] shrink-0 font-mono">
							{currentResult.latencyMs >= 0
								? `${currentResult.latencyMs}ms`
								: "-"}
						</span>
						<span className="text-[#64748B]">-</span>
						<span className="text-white font-mono whitespace-nowrap">
							{currentResult.target}
						</span>
						<button
							type="button"
							onClick={() => setCurrentResult(null)}
							className="ml-1 p-0.5 text-[#8A94A6] hover:text-white rounded-full hover:bg-[#1E2433] transition-colors cursor-pointer"
							title="Close"
						>
							<X className="h-3 w-3" />
						</button>
					</div>
				</div>
			)}

			{/* Header */}
			<div className="flex items-center justify-between flex-wrap gap-3 pb-2 border-b border-[#1E2433]">

				<div className="flex items-center gap-2">
					<div className="relative">
						<Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#64748B]" />
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Filter model..."
							className="pl-8 pr-3 py-1 text-xs rounded-lg border border-[#1E2433] bg-[#161B26] text-white placeholder-[#64748B] focus:outline-none focus:border-[#00EA88]/40 transition-colors w-44 font-mono"
						/>
					</div>

					<button
						type="button"
						onClick={fetchTree}
						disabled={loadingTree}
						className="p-1.5 rounded-lg border border-[#1E2433] bg-[#161B26] text-[#8A94A6] hover:text-white hover:border-[#00EA88]/40 transition-colors cursor-pointer"
						title="Reload Tree Catalog"
					>
						<RefreshCw
							className={`h-3.5 w-3.5 ${loadingTree ? "animate-spin text-[#00EA88]" : ""}`}
						/>
					</button>
				</div>
			</div>

			{/* Tree Hierarchy */}
			{loadingTree && !tree ? (
				<div className="py-12 flex items-center justify-center text-xs text-[#8A94A6] gap-2">
					<Loader2 className="h-4 w-4 animate-spin text-[#00EA88]" />
					<span>Discovering gateways and models catalog...</span>
				</div>
			) : !tree || tree.gateways.length === 0 ? (
				<div className="py-12 text-center text-xs text-[#8A94A6]">
					No upstream gateways available.
				</div>
			) : (
				<div className="space-y-4">
					{tree.gateways.map((gw: PingGatewayNode) => {
						const isGwExpanded = expandedGateways[gw.name] ?? true;
						const isGwProbing = probingTargets[`gw:${gw.name}`] ?? false;

						// Filter providers & models
						const filteredProviders = gw.providers
							.map((prov) => {
								if (!filterQuery) return prov;
								const matchesProv = prov.name
									.toLowerCase()
									.includes(filterQuery);
								const matchingModels = prov.models.filter((m) =>
									m.id.toLowerCase().includes(filterQuery),
								);
								if (matchesProv) return prov;
								if (matchingModels.length > 0) {
									return { ...prov, models: matchingModels };
								}
								return null;
							})
							.filter(Boolean) as typeof gw.providers;

						return (
							<div
								key={gw.name}
								className="rounded-xl border border-[#1E2433] bg-[#131722] overflow-hidden transition-all duration-200"
							>
								{/* Gateway Level: No badge, pure icon button */}
								<div className="flex items-center justify-between px-4 py-3 bg-[#161B26]/80 border-b border-[#1E2433]/70 select-none">
									<button
										type="button"
										onClick={() => toggleGateway(gw.name)}
										className="flex items-center gap-2.5 text-left cursor-pointer group flex-1 min-w-0"
									>
										{isGwExpanded ? (
											<ChevronDown className="h-4 w-4 text-[#64748B] group-hover:text-white transition-colors" />
										) : (
											<ChevronRight className="h-4 w-4 text-[#64748B] group-hover:text-white transition-colors" />
										)}
										<GatewayIcon name={gw.name} className="h-4 w-4 shrink-0" />
										<div className="flex items-center gap-2 flex-wrap">
											<span className="text-xs font-semibold text-white font-mono tracking-tight">
												{gw.displayName}
											</span>
											<span className="text-[10px] text-[#64748B] font-mono">
												{gw.host}:{gw.port}
											</span>
										</div>
									</button>

									{/* Gateway Ping Button: Pure Icon, Transparent */}
									<button
										type="button"
										onClick={() => runProbe("gateway", gw.name)}
										disabled={isGwProbing}
										className="p-1 rounded border border-[#1E2433] hover:border-[#00EA88]/40 text-[#8A94A6] hover:text-[#00EA88] bg-transparent transition-colors cursor-pointer shrink-0 disabled:opacity-50"
										title={`Ping ${gw.displayName}`}
									>
										{isGwProbing ? (
											<Loader2 className="h-3.5 w-3.5 animate-spin text-[#00EA88]" />
										) : (
											<FlaskConical className="h-3.5 w-3.5" />
										)}
									</button>
								</div>

								{/* Providers List */}
								{isGwExpanded && (
									<div className="p-3 space-y-2">
										{filteredProviders.length === 0 ? (
											<div className="py-2 px-4 text-xs text-[#64748B]">
												No matching providers for this filter.
											</div>
										) : (
											filteredProviders.map((prov) => {
												const provKey = `${gw.name}:${prov.name}`;
												const isProvExpanded =
													expandedProviders[provKey] ?? filterQuery.length > 0;
												const isProvProbing =
													probingTargets[`pr:${gw.name}:${prov.name}`] ?? false;

												return (
													<div
														key={prov.name}
														className="rounded-lg border border-[#1E2433]/60 bg-[#0E1117]/50 overflow-hidden"
													>
														{/* Provider Level: No badge, pure icon button */}
														<div className="flex items-center justify-between px-3 py-2 bg-[#161B26]/40 border-b border-[#1E2433]/40 select-none">
															<button
																type="button"
																onClick={() => toggleProvider(provKey)}
																className="flex items-center gap-2 text-left cursor-pointer group flex-1 min-w-0"
															>
																{isProvExpanded ? (
																	<ChevronDown className="h-3.5 w-3.5 text-[#64748B] group-hover:text-white transition-colors" />
																) : (
																	<ChevronRight className="h-3.5 w-3.5 text-[#64748B] group-hover:text-white transition-colors" />
																)}
																<ProviderIcon
																	name={prov.name}
																	className="h-3.5 w-3.5 shrink-0"
																/>
																<span className="text-xs font-medium text-[#94A3B8] font-mono">
																	{prov.name}
																</span>
																<span className="text-[10px] text-[#64748B] font-mono">
																	({prov.models.length})
																</span>
															</button>

															{/* Provider Ping Button: Pure Icon, Transparent */}
															<button
																type="button"
																onClick={() => runProviderProbe(gw.name, prov)}
																disabled={isProvProbing}
																className="p-1 rounded border border-[#1E2433] hover:border-[#00EA88]/40 text-[#8A94A6] hover:text-[#00EA88] bg-transparent transition-colors cursor-pointer shrink-0 disabled:opacity-50"
																title={`Ping all models in ${prov.name}`}
															>
																{isProvProbing ? (
																	<Loader2 className="h-3 w-3 animate-spin text-[#00EA88]" />
																) : (
																	<FlaskConical className="h-3 w-3" />
																)}
															</button>
														</div>

														{/* Models List: Model ID with Snapshot Badge */}
														{isProvExpanded && (
															<div className="divide-y divide-[#1E2433]/30 pl-6 pr-3 py-1">
																{prov.models.map((model) => {
																	const isModelProbing =
																		probingTargets[
																			`md:${gw.name}:${model.id}`
																		] ?? false;
																	const snapshot = modelSnapshots[model.id];

																	return (
																		<div
																			key={model.id}
																			className="flex items-center justify-between py-1.5 text-xs hover:bg-[#161B26]/30 px-2 rounded transition-colors"
																		>
																			<div className="flex items-center gap-2 min-w-0 flex-1">
																				<Cpu className="h-3 w-3 text-[#64748B] shrink-0" />
																				<span className="font-mono text-[11px] text-[#8A94A6] truncate">
																					{model.id}
																				</span>

																				{/* Model Snapshot Badge (Only on model rows) */}
																				{snapshot && (
																					<span
																						className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${
																							snapshot.statusCode === 200
																								? "bg-[#00EA88]/10 text-[#00EA88] border-[#00EA88]/30"
																								: "bg-rose-500/10 text-rose-400 border-rose-500/30"
																						}`}
																					>
																						{snapshot.statusCode}
																						{snapshot.latencyMs >= 0
																							? ` · ${snapshot.latencyMs}ms`
																							: ""}
																					</span>
																				)}
																			</div>

																			{/* Model Ping Button: Pure Icon, Transparent */}
																			<button
																				type="button"
																				onClick={() =>
																					runProbe(
																						"model",
																						gw.name,
																						prov.name,
																						model.id,
																					)
																				}
																				disabled={isModelProbing}
																				className="p-1 rounded border border-[#1E2433] hover:border-[#00EA88]/40 text-[#8A94A6] hover:text-[#00EA88] bg-transparent transition-colors cursor-pointer shrink-0 ml-2 disabled:opacity-50"
																				title={`Ping Model ${model.id}`}
																			>
																				{isModelProbing ? (
																					<Loader2 className="h-3 w-3 animate-spin text-[#00EA88]" />
																				) : (
																					<FlaskConical className="h-3 w-3" />
																				)}
																			</button>
																		</div>
																	);
																})}
															</div>
														)}
													</div>
												);
											})
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}

			{/* INFORMASI STATUS FOOTER (Permanent at bottom of page) */}
			<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 text-xs space-y-2 mt-8">
				<div className="font-semibold text-white uppercase tracking-wider text-[10px] font-sans">
					Informasi Status
				</div>
				<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-[11px] font-mono text-[#8A94A6]">
					<div>
						<span className="text-[#00EA88] font-bold">200</span>: Model
						operational
					</div>
					<div>
						<span className="text-rose-400 font-bold">400</span>: Bad request
					</div>
					<div>
						<span className="text-rose-400 font-bold">401</span>: Unauthorized
					</div>
					<div>
						<span className="text-rose-400 font-bold">403</span>: Forbidden
					</div>
					<div>
						<span className="text-rose-400 font-bold">404</span>: Not found
					</div>
					<div>
						<span className="text-amber-400 font-bold">429</span>: Rate limited
					</div>
					<div>
						<span className="text-rose-400 font-bold">500</span>: Internal error
					</div>
					<div>
						<span className="text-rose-400 font-bold">504</span>: Timeout
					</div>
				</div>
			</div>
		</div>
	);
}
