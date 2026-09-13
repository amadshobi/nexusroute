import { useMemo, useState } from "react";
import { Copy, Check, Bot } from "lucide-react";
import { MiniSparkline } from "@/components/charts/MiniSparkline";
import { formatCompact, computeTimeSeriesBuckets } from "@/lib/formatters";
import { hermesSessionTs } from "./agent-metrics";
import type { HermesAgentData } from "./agent-types";

interface HermesSectionProps {
	hermes?: HermesAgentData;
	visible: boolean;
}

export function HermesSection({ hermes, visible }: HermesSectionProps) {
	const [copiedId, setCopiedId] = useState<string | null>(null);

	const sessions = useMemo(
		() => hermes?.recentSessions || [],
		[hermes?.recentSessions],
	);

	const handleCopy = async (id: string) => {
		try {
			await navigator.clipboard.writeText(id);
			setCopiedId(id);
			setTimeout(() => setCopiedId(null), 2000);
		} catch {
			// Clipboard unavailable
		}
	};

	const sessionsSparkline = useMemo(
		() => computeTimeSeriesBuckets(sessions, hermesSessionTs, () => 1, 8),
		[sessions],
	);

	const messagesSparkline = useMemo(
		() =>
			computeTimeSeriesBuckets(
				sessions,
				hermesSessionTs,
				(s) => (s.actual_cost_usd ? Math.max(1, Math.ceil(s.actual_cost_usd * 20)) : 1),
				8,
			),
		[sessions],
	);

	const tokensSparkline = useMemo(
		() =>
			computeTimeSeriesBuckets(
				sessions,
				hermesSessionTs,
				(s) => (s.actual_cost_usd ? Math.floor(s.actual_cost_usd * 20000) : 500),
				8,
			),
		[sessions],
	);

	return (
		<section className={visible ? "space-y-6" : "hidden"}>
			<div className="flex items-center gap-2">
				<Bot className="h-3.5 w-3.5 text-purple-400" />
				<h3 className="text-sm font-semibold text-white tracking-tight">
					Hermes Agent State &amp; Activity
				</h3>
			</div>

			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
				{/* Agent Status */}
				<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Agent Status</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#00EA88]">
							Daemon
						</span>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-[#00EA88] font-mono">
							ONLINE
						</span>
					</div>
					<MiniSparkline data={[1, 1, 1, 1, 1, 1, 1, 1]} color="#00EA88" />
				</div>

				{/* Conversations */}
				<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Conversations</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-sky-400">
							{sessions.length} Filtered
						</span>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{hermes?.sessionsCount || 0}
						</span>
					</div>
					<MiniSparkline data={sessionsSparkline} color="#38BDF8" />
				</div>

				{/* Messages */}
				<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Messages</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-[#7AA2F7]">
							State
						</span>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{formatCompact(hermes?.messagesCount || 0)}
						</span>
					</div>
					<MiniSparkline data={messagesSparkline} color="#7AA2F7" />
				</div>

				{/* Token */}
				<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 flex flex-col justify-between shadow-sm relative overflow-hidden">
					<div className="flex justify-between items-start">
						<span className="text-xs font-medium text-[#8A94A6]">Token</span>
						<span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-purple-400 font-mono">
							In: {formatCompact(hermes?.tokensInput || 0)}
						</span>
					</div>
					<div className="mt-2 mb-1">
						<span className="text-2xl font-bold tracking-tight text-white font-mono">
							{formatCompact((hermes?.tokensInput || 0) + (hermes?.tokensOutput || 0))}
						</span>
					</div>
					<MiniSparkline data={tokensSparkline} color="#A855F7" />
				</div>
			</div>

			<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-5 shadow-sm space-y-3">
				<div className="flex items-center justify-between pb-2 border-b border-[#1E2433]">
					<h4 className="text-xs font-semibold text-white uppercase tracking-wider">
						Recent Hermes Sessions ({sessions.length})
					</h4>
					<span className="text-[11px] text-[#64748B] font-mono">
						Click row to copy session ID
					</span>
				</div>

				{sessions.length === 0 ? (
					<div className="py-8 text-center text-xs text-[#64748B]">
						No Hermes sessions found for this time range.
					</div>
				) : (
					<div className="divide-y divide-[#1E2433]">
						{sessions.map((s) => (
							<div
								key={s.id}
								onClick={() => void handleCopy(s.id)}
								className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs hover:bg-[#161B26] px-2.5 rounded-lg transition-all cursor-pointer group border border-transparent hover:border-[#1D68FE]/30"
							>
								<div className="space-y-0.5">
									<div className="flex items-center gap-2">
										<Bot className="h-3.5 w-3.5 text-purple-400 shrink-0" />
										<span className="font-semibold text-white group-hover:text-purple-300 transition-colors">
											{s.title || "Hermes Conversation"}
										</span>
									</div>
									<div className="flex items-center gap-2">
										<span className="text-[11px] text-[#64748B] font-mono block">
											{s.id}
										</span>
										{copiedId === s.id && (
											<span className="text-[10px] text-[#00EA88] font-mono font-semibold flex items-center gap-0.5">
												<Check className="h-3 w-3" /> Copied!
											</span>
										)}
									</div>
								</div>
								<div className="flex items-center gap-3 text-[11px] font-mono text-[#8A94A6] shrink-0">
									<span className="text-purple-400 font-semibold">{s.model}</span>
									<span>·</span>
									<span>
										{new Date(
											(s.last_activity_at || s.started_at) * 1000,
										).toLocaleTimeString([], {
											hour: "2-digit",
											minute: "2-digit",
										})}
									</span>
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											void handleCopy(s.id);
										}}
										className="p-1 rounded text-[#64748B] hover:text-white hover:bg-[#1E2433] transition-colors cursor-pointer"
										title="Copy session ID"
									>
										{copiedId === s.id ? (
											<Check className="h-3.5 w-3.5 text-[#00EA88]" />
										) : (
											<Copy className="h-3.5 w-3.5" />
										)}
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</section>
	);
}
