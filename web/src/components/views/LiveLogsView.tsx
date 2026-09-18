import { useState, useMemo } from "react";
import {
	Search,
	ArrowRight,
	ShieldAlert,
	Radio,
	X,
	Copy,
	Check,
	Terminal,
	LifeBuoy,
} from "lucide-react";
import type { LogEntry } from "@/types/dashboard";
import { formatTimeHHmm, formatDateWIB, formatCompact } from "@/lib/formatters";

interface LiveLogsViewProps {
	logs: LogEntry[];
}

type LogFilterType = "all" | "success" | "errors" | "cache";

export function LiveLogsView({ logs }: LiveLogsViewProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [filterType, setFilterType] = useState<LogFilterType>("all");
	const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
	const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

	const copyToClipboard = async (text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopyFeedback(label);
			setTimeout(() => setCopyFeedback(null), 2000);
		} catch {
			// Fallback
		}
	};

	const counts = useMemo(() => {
		return {
			all: logs.length,
			success: logs.filter((l) => l.status >= 200 && l.status < 300).length,
			errors: logs.filter((l) => l.status >= 400 || Boolean(l.error)).length,
			cache: logs.filter((l) => l.cache === "HIT").length,
		};
	}, [logs]);

	const filteredLogs = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		return logs
			.filter((entry) => {
				if (
					filterType === "success" &&
					(entry.status < 200 || entry.status >= 300)
				)
					return false;
				if (filterType === "errors" && entry.status < 400 && !entry.error)
					return false;
				if (filterType === "cache" && entry.cache !== "HIT") return false;

				if (!q) return true;
				const model = (
					entry.servedModel ||
					entry.initialModel ||
					""
				).toLowerCase();
				const path = (entry.path || "").toLowerCase();
				const method = (entry.method || "").toLowerCase();
				const err = (entry.error || "").toLowerCase();
				return (
					model.includes(q) ||
					path.includes(q) ||
					method.includes(q) ||
					err.includes(q)
				);
			})
			.sort((a, b) => b.ts - a.ts); // Newest requests on top (descending)
	}, [logs, searchQuery, filterType]);

	const getLatencyColor = (ms: number) => {
		if (ms <= 0) return "text-[#64748B]";
		if (ms < 500) return "text-emerald-400";
		if (ms < 1500) return "text-amber-400";
		return "text-rose-400";
	};

	const generateCurl = (entry: LogEntry) => {
		const host = window.location.host || "localhost:4010";
		const protocol = window.location.protocol || "http:";
		return `curl -X ${entry.method || "POST"} ${protocol}//${host}${entry.path} \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${entry.servedModel || entry.initialModel}"}'`;
	};

	return (
		<div className="rounded-xl border border-white/[0.08] bg-white/[0.06] bevel-inset p-5 shadow-sm space-y-4 relative">
			{/* Header & Title */}
			<div className="flex items-center justify-between pb-3 border-b border-white/[0.08] flex-wrap gap-2">
				<div>
					<h3 className="text-sm font-semibold text-white tracking-tight">
						Realtime Traffic
					</h3>
				</div>
				<span className="text-xs font-mono text-[#64748B] flex items-center gap-1.5">
					<span className="h-2 w-2 rounded-full bg-[#00EA88] animate-ping" />
					Active Session ({logs.length} Logs)
				</span>
			</div>

			{/* Filter and Search Bar */}
			<div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
				{/* Filter Chips */}
				<div className="flex items-center bg-white/[0.04] border border-white/[0.08] bevel-inset-subtle rounded-lg p-0.5 text-xs font-medium overflow-x-auto">
					<button
						onClick={() => setFilterType("all")}
						className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
							filterType === "all"
								? "bg-white/[0.08] bevel-inset-subtle text-[#00EA88] font-semibold"
								: "text-[#8A94A6] hover:text-white"
						}`}
					>
						All ({counts.all})
					</button>
					<button
						onClick={() => setFilterType("success")}
						className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
							filterType === "success"
								? "bg-white/[0.08] bevel-inset-subtle text-emerald-400 font-semibold"
								: "text-[#8A94A6] hover:text-white"
						}`}
					>
						Success ({counts.success})
					</button>
					<button
						onClick={() => setFilterType("errors")}
						className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
							filterType === "errors"
								? "bg-white/[0.08] bevel-inset-subtle text-rose-400 font-semibold"
								: "text-[#8A94A6] hover:text-white"
						}`}
					>
						Errors ({counts.errors})
					</button>
					<button
						onClick={() => setFilterType("cache")}
						className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
							filterType === "cache"
								? "bg-white/[0.08] bevel-inset-subtle text-amber-400 font-semibold"
								: "text-[#8A94A6] hover:text-white"
						}`}
					>
						Cache Hit ({counts.cache})
					</button>
				</div>

				{/* Quick Search */}
				<div className="relative flex-1 max-w-xs">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#64748B]" />
					<input
						type="text"
						placeholder="Search model, path, method..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="w-full bg-white/[0.04] border border-white/[0.08] bevel-inset-subtle rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-[#64748B] focus:outline-none focus:border-[#1D68FE] font-mono"
					/>
					{searchQuery && (
						<button
							onClick={() => setSearchQuery("")}
							className="absolute right-2 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-white cursor-pointer"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
			</div>

			{/* Logs Table / List */}
			{logs.length === 0 ? (
				<div className="py-12 text-center text-xs text-[#64748B]">
					No requests recorded yet.
				</div>
			) : filteredLogs.length === 0 ? (
				<div className="py-10 text-center text-xs text-[#64748B] space-y-1">
					<p>No log entries match your current search or filter.</p>
					<button
						onClick={() => {
							setSearchQuery("");
							setFilterType("all");
						}}
						className="text-[#00EA88] hover:underline cursor-pointer"
					>
						Clear filters
					</button>
				</div>
			) : (
				<div className="divide-y divide-white/[0.06] max-h-[550px] overflow-y-auto">
					{filteredLogs.map((entry, idx) => {
						const hasFallback =
							entry.servedModel &&
							entry.initialModel &&
							entry.servedModel !== entry.initialModel;

						const isSuccess = entry.status >= 200 && entry.status < 300;
						const isClientError = entry.status >= 400 && entry.status < 500;

						const statusClass = isSuccess
							? "bg-[#00EA88]/10 text-[#00EA88] border-[#00EA88]/20"
							: isClientError
								? "bg-amber-500/10 text-amber-400 border-amber-500/20"
								: "bg-rose-500/10 text-rose-400 border-rose-500/20";

						return (
							<div
								key={`${entry.ts}-${idx}`}
								onClick={() => setSelectedLog(entry)}
								className="py-3 px-2.5 flex flex-col gap-1.5 text-xs hover:bg-white/[0.04] hover:border-[#1D68FE]/30 border border-transparent rounded-lg transition-all cursor-pointer group"
							>
								<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
									<div className="flex items-center gap-2 flex-wrap">
										{/* Status Code */}
										<span
											className={`px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold ${statusClass}`}
										>
											{entry.status}
										</span>

										{/* HTTP Method */}
										<span className="px-1.5 py-0.5 rounded bg-white/[0.08] text-[10px] font-mono text-[#94A3B8] uppercase">
											{entry.method || "POST"}
										</span>

										{/* Model or Cascade Routing */}
										<div className="flex items-center gap-1.5 font-mono text-white text-xs group-hover:text-[#7AA2F7] transition-colors">
											{hasFallback ? (
												<span className="flex items-center gap-1 text-amber-300">
													<span className="text-[#8A94A6] line-through text-[11px]">
														{entry.initialModel}
													</span>
													<ArrowRight className="h-3 w-3 text-amber-400 shrink-0" />
													<span className="font-semibold">
														{entry.servedModel}
													</span>
												</span>
											) : (
												<span className="font-semibold">
													{entry.servedModel || entry.initialModel || "direct"}
												</span>
											)}
										</div>

										{/* Cache Tag */}
										{entry.cache === "HIT" && (
											<span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono font-semibold">
												CACHE HIT
											</span>
										)}

										{/* Streaming Indicator */}
										{entry.stream && (
											<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-[#7AA2F7]/10 text-[#7AA2F7] border border-[#7AA2F7]/20 font-mono">
												<Radio className="h-2.5 w-2.5" /> STREAM
											</span>
										)}

										{/* Sensitive Data Shield Tag */}
										{entry.shieldRedacted && entry.shieldRedacted > 0 && (
											<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-rose-500/15 text-rose-300 border border-rose-500/30 font-mono">
												<ShieldAlert className="h-2.5 w-2.5" /> SHIELD (
												{entry.shieldRedacted})
											</span>
										)}

										{/* Stream Salvaged Tag */}
										{entry.salvaged && (
											<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono">
												<LifeBuoy className="h-2.5 w-2.5" /> SALVAGED (
												{entry.salvaged})
											</span>
										)}

										{/* Caller Client App Badge */}
										{entry.client && entry.client !== "unknown" && (
											<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-white/[0.08] bevel-inset-subtle text-[#8A94A6] border border-white/[0.08] font-mono">
												<Terminal className="h-2.5 w-2.5 text-[#7AA2F7]" />
												{entry.client}
											</span>
										)}

										{/* Upstream Transport Badge */}
										{entry.upstream && (
											<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-white/[0.04] text-[#64748B] border border-white/[0.08] font-mono uppercase">
												{entry.upstream === "commandcode" ? "direct" : entry.upstream}
											</span>
										)}
									</div>

									{/* Tokens, Latency & Timestamp */}
									<div className="flex items-center gap-2.5 text-[#8A94A6] font-mono text-[11px] shrink-0">
										{(typeof entry.tokensInput === "number" ||
											typeof entry.tokensOutput === "number") && (
											<span className="text-[10px] text-[#8A94A6] bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.08]">
												<span className="text-[#7AA2F7]">
													{formatCompact(entry.tokensInput ?? 0)}
												</span>
												<span className="text-[#475569] mx-1">in</span>
												<span className="text-emerald-400">
													{formatCompact(entry.tokensOutput ?? 0)}
												</span>
												<span className="text-[#475569] ml-1">out</span>
											</span>
										)}
										<span
											className={`font-semibold ${getLatencyColor(entry.latencyMs)}`}
										>
											{entry.latencyMs > 0 ? `${entry.latencyMs}ms` : "0ms"}
										</span>
										<span>·</span>
										<span className="text-white font-medium">
											{formatTimeHHmm(entry.ts)}
										</span>
									</div>
								</div>

								{/* Path & Optional Error Line */}
								<div className="flex items-center justify-between text-[11px] text-[#64748B] font-mono truncate gap-2">
									<span className="truncate group-hover:text-[#94A3B8] transition-colors">
										{entry.path}
									</span>
									{entry.error ? (
										<span className="text-rose-400 font-semibold truncate max-w-md">
											Err: {entry.error}
										</span>
									) : (
										<span className="text-[10px] text-[#475569] opacity-0 group-hover:opacity-100 transition-opacity">
											Inspect &rarr;
										</span>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}

			{/* Log Details Modal */}
			{selectedLog && (
				<div
					onClick={() => setSelectedLog(null)}
					className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity"
				>
					<div
						onClick={(e) => e.stopPropagation()}
						className="w-full max-w-2xl bg-[#0d0f14] border border-white/[0.12] bevel-inset rounded-xl shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
					>
						{/* Modal Header */}
						<div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
							<div className="flex items-center gap-2.5">
								<Terminal className="h-5 w-5 text-[#00EA88]" />
								<div>
									<h4 className="text-sm font-semibold text-white tracking-tight">
										Request Telemetry Inspector
									</h4>
									<p className="text-xs text-[#8A94A6] font-mono">
										{selectedLog.path}
									</p>
								</div>
							</div>
							<button
								onClick={() => setSelectedLog(null)}
								className="p-1 rounded-md text-[#64748B] hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
							>
								<X className="h-4 w-4" />
							</button>
						</div>

						{/* Quick Metrics Grid */}
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
							<div className="p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] bevel-inset-subtle">
								<span className="text-[10px] text-[#64748B] block uppercase">
									Status
								</span>
								<span
									className={`font-bold ${selectedLog.status < 300 ? "text-[#00EA88]" : "text-rose-400"}`}
								>
									{selectedLog.status} (
									{selectedLog.status === 200 ? "OK" : "ERR"})
								</span>
							</div>
							<div className="p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] bevel-inset-subtle">
								<span className="text-[10px] text-[#64748B] block uppercase">
									Latency
								</span>
								<span
									className={`font-bold ${getLatencyColor(selectedLog.latencyMs)}`}
								>
									{selectedLog.latencyMs}ms
								</span>
							</div>
							<div className="p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] bevel-inset-subtle">
								<span className="text-[10px] text-[#64748B] block uppercase">
									Cache
								</span>
								<span className="text-amber-300 font-bold">
									{selectedLog.cache}
								</span>
							</div>
							<div className="p-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] bevel-inset-subtle">
								<span className="text-[10px] text-[#64748B] block uppercase">
									Speed (TPS)
								</span>
								<span className="text-[#00EA88] font-bold">
									{selectedLog.latencyMs > 0 && selectedLog.tokensOutput
										? `${Math.round((selectedLog.tokensOutput / (selectedLog.latencyMs / 1000)) * 10) / 10} t/s`
										: "-"}
								</span>
							</div>
						</div>

						{/* Token Breakdown Metrics */}
						<div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.08] bevel-inset-subtle space-y-2">
							<div className="flex items-center justify-between">
								<span className="text-[10px] text-[#64748B] uppercase font-mono block">
									Token Usage Breakdown
								</span>
								<span className="text-xs font-mono font-semibold text-[#00EA88]">
									Total:{" "}
									{selectedLog.tokensTotal !== undefined
										? selectedLog.tokensTotal.toLocaleString()
										: selectedLog.tokensInput !== undefined ||
												selectedLog.tokensOutput !== undefined
											? (
													(selectedLog.tokensInput ?? 0) +
													(selectedLog.tokensOutput ?? 0)
												).toLocaleString()
											: "0"}
								</span>
							</div>
							<div className="grid grid-cols-3 gap-2 font-mono text-xs">
								<div className="p-2 rounded bg-black/50 border border-white/[0.08] bevel-inset-subtle">
									<span className="text-[10px] text-[#8A94A6] block">
										Input / Prompt
									</span>
									<span className="font-semibold text-[#7AA2F7]">
										{selectedLog.tokensInput !== undefined
											? selectedLog.tokensInput.toLocaleString()
											: "-"}
									</span>
								</div>
								<div className="p-2 rounded bg-black/50 border border-white/[0.08] bevel-inset-subtle">
									<span className="text-[10px] text-[#8A94A6] block">
										Output / Completion
									</span>
									<span className="font-semibold text-emerald-400">
										{selectedLog.tokensOutput !== undefined
											? selectedLog.tokensOutput.toLocaleString()
											: "-"}
									</span>
								</div>
								<div className="p-2 rounded bg-black/50 border border-white/[0.08] bevel-inset-subtle">
									<span className="text-[10px] text-[#8A94A6] block">
										Cache Read
									</span>
									<span className="font-semibold text-amber-300">
										{selectedLog.tokensCache !== undefined
											? selectedLog.tokensCache.toLocaleString()
											: "-"}
									</span>
								</div>
							</div>
						</div>

						{/* Routing Detail */}
						<div className="p-3 rounded-lg bg-white/[0.04] border border-white/[0.08] bevel-inset-subtle space-y-1 text-xs font-mono">
							<span className="text-[10px] text-[#64748B] uppercase block">
								Model Resolution
							</span>
							<div className="flex items-center gap-2 text-white">
								<span className="text-[#8A94A6]">Requested:</span>
								<span className="font-semibold text-[#7AA2F7]">
									{selectedLog.initialModel || "direct"}
								</span>
								{selectedLog.servedModel &&
									selectedLog.servedModel !== selectedLog.initialModel && (
										<>
											<ArrowRight className="h-3.5 w-3.5 text-amber-400" />
											<span className="text-[#8A94A6]">
												Served via Fallback:
											</span>
											<span className="font-semibold text-emerald-400">
												{selectedLog.servedModel}
											</span>
										</>
									)}
							</div>
						</div>

						{/* Salvaged Notice if any */}
						{selectedLog.salvaged && (
							<div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono space-y-1">
								<span className="text-[10px] font-bold uppercase block text-amber-400">
									Stream Salvaged ({selectedLog.salvaged})
								</span>
								<p>
									This request encountered an in-band upstream fatal error and was gracefully salvaged into a valid completion turn.
								</p>
							</div>
						)}

						{/* Error Message if any */}
						{selectedLog.error && (
							<div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono space-y-1">
								<span className="text-[10px] font-bold uppercase block text-rose-400">
									Error Description
								</span>
								<p>{selectedLog.error}</p>
							</div>
						)}

						{/* Raw JSON viewer */}
						<div className="space-y-1.5">
							<div className="flex items-center justify-between">
								<span className="text-[11px] font-semibold text-[#8A94A6] uppercase tracking-wider">
									Raw Entry Payload
								</span>
								<span className="text-[10px] text-[#64748B] font-mono">
									{formatDateWIB(selectedLog.ts)} (
									{new Date(selectedLog.ts).toISOString()})
								</span>
							</div>
							<pre className="p-3 rounded-lg bg-black/50 border border-white/[0.08] bevel-inset-subtle text-[11px] font-mono text-white/90 overflow-x-auto max-h-48 select-all">
								{JSON.stringify(selectedLog, null, 2)}
							</pre>
						</div>

						{/* Modal Actions */}
						<div className="flex items-center justify-between pt-2 border-t border-white/[0.08] flex-wrap gap-2">
							<div className="flex items-center gap-2">
								<button
									onClick={() =>
										copyToClipboard(generateCurl(selectedLog), "cURL")
									}
									className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-mono text-white flex items-center gap-1.5 transition-colors cursor-pointer"
								>
									{copyFeedback === "cURL" ? (
										<Check className="h-3.5 w-3.5 text-[#00EA88]" />
									) : (
										<Copy className="h-3.5 w-3.5" />
									)}
									{copyFeedback === "cURL" ? "Copied cURL!" : "Copy as cURL"}
								</button>

								<button
									onClick={() =>
										copyToClipboard(
											JSON.stringify(selectedLog, null, 2),
											"JSON",
										)
									}
									className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs font-mono text-white flex items-center gap-1.5 transition-colors cursor-pointer"
								>
									{copyFeedback === "JSON" ? (
										<Check className="h-3.5 w-3.5 text-[#00EA88]" />
									) : (
										<Copy className="h-3.5 w-3.5" />
									)}
									{copyFeedback === "JSON" ? "Copied JSON!" : "Copy JSON"}
								</button>
							</div>

							<button
								onClick={() => setSelectedLog(null)}
								className="px-4 py-1.5 rounded-lg bg-[#1D68FE] hover:bg-[#1D68FE]/80 text-white text-xs font-medium transition-colors cursor-pointer"
							>
								Close
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
