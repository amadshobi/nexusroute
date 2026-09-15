import { useState } from "react";
import { Copy, Check, Clock, User, ChevronDown } from "lucide-react";
import {
	AntigravityIcon,
	GoogleIcon,
	AnthropicIcon,
	CommandCodeIcon,
} from "@/components/icons/ProviderIcons";
import type {
	QuotaResponse,
	ProviderQuotaResult,
	AccountQuota,
	QuotaGroup,
	QuotaBucket,
} from "@/types/dashboard";

interface QuotaViewProps {
	quota: QuotaResponse;
}

function formatRelativeTime(isoString?: string): string {
	if (!isoString) return "";
	const target = new Date(isoString).getTime();
	const diffMs = target - Date.now();
	if (diffMs <= 0) return "ready";

	const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
	const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

	if (diffHours >= 24) {
		const days = Math.floor(diffHours / 24);
		const remHours = diffHours % 24;
		return `${days}d ${remHours}h`;
	}
	return `${diffHours}h ${diffMins}m`;
}

export function QuotaView({ quota }: QuotaViewProps) {
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	// Persistent accordion state (default: all collapsed per user rule)
	const [expandedProviders, setExpandedProviders] = useState<
		Record<string, boolean>
	>(() => {
		if (typeof window !== "undefined") {
			try {
				const saved =
					localStorage.getItem("nexus_quota_expanded_providers") ||
					localStorage.getItem("gn_quota_expanded_providers");
				if (saved) return JSON.parse(saved);
			} catch {}
		}
		return {};
	});

	const toggleProvider = (providerKey: string) => {
		setExpandedProviders((prev) => {
			const next = { ...prev, [providerKey]: !prev[providerKey] };
			if (typeof window !== "undefined") {
				try {
					localStorage.setItem(
						"nexus_quota_expanded_providers",
						JSON.stringify(next),
					);
				} catch {}
			}
			return next;
		});
	};

	const copyEmail = async (email: string) => {
		try {
			await navigator.clipboard.writeText(email);
			setCopiedKey(email);
			setTimeout(() => setCopiedKey(null), 2000);
		} catch {
			// Fallback
		}
	};

	const providers = quota?.providers || [];
	const hasProviders =
		providers.length > 0 && providers.some((p) => p.accounts.length > 0);

	if (
		!quota?.available ||
		(!hasProviders && (!quota.entries || quota.entries.length === 0))
	) {
		return (
			<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-6 text-center shadow-sm">
				<p className="text-sm text-[#8A94A6]">No active quota metrics.</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{providers.map((provider: ProviderQuotaResult) => {
				const isOpen = Boolean(expandedProviders[provider.provider]);

				return (
					<div
						key={provider.provider}
						className="rounded-xl border border-[#1E2433] bg-[#131722] p-4 shadow-sm transition-all duration-200"
					>
						{/* Provider Card Header (Clickable Accordion Trigger) */}
						<div
							onClick={() => toggleProvider(provider.provider)}
							className="flex items-center justify-between cursor-pointer select-none group pb-1"
						>
							<div className="flex items-center gap-2.5">
								{provider.provider.toLowerCase().includes("antigravity") ? (
									<AntigravityIcon className="h-5 w-5 shrink-0" />
								) : provider.provider.toLowerCase().includes("commandcode") ||
								  provider.displayName.toLowerCase().includes("command") ? (
									<CommandCodeIcon className="h-5 w-5 shrink-0" />
								) : (
									<div className="h-5 w-5 rounded bg-[#7AA2F7]/20 flex items-center justify-center font-bold text-xs text-[#7AA2F7] shrink-0">
										{provider.displayName[0]}
									</div>
								)}
								<h3 className="text-sm font-bold text-white tracking-tight group-hover:text-[#00EA88] transition-colors">
									{provider.displayName}
								</h3>
							</div>

							<div className="flex items-center gap-3">
								<span className="text-xs font-mono text-[#64748B]">
									{provider.accounts.length} Accounts
								</span>
								<ChevronDown
									className={`h-4 w-4 text-[#64748B] group-hover:text-white transition-transform duration-200 ${
										isOpen ? "rotate-180 text-white" : ""
									}`}
								/>
							</div>
						</div>

						{/* Smooth Collapsible Content Container */}
						<div
							className={`grid transition-[grid-template-rows] duration-250 ease-out ${
								isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
							}`}
						>
							<div className="overflow-hidden">
								{/* 2-Column Accounts Grid */}
								<div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 mt-2 border-t border-[#1E2433]">
									{provider.accounts.map(
										(account: AccountQuota, accIdx: number) => {
											const isCopied = copiedKey === account.email;

											return (
												<div
													key={`${account.email}-${accIdx}`}
													className="rounded-lg border border-[#1E2433] bg-[#161B26]/60 p-3 space-y-2.5"
												>
													{/* Account Header */}
													<div className="flex items-center justify-between gap-2 pb-2 border-b border-[#1E2433]/60">
														<div className="flex items-center gap-1.5 min-w-0">
															<User className="h-3 w-3 text-[#7AA2F7] shrink-0" />
															<span className="text-xs font-semibold text-white font-mono truncate">
																{account.email}
															</span>
															<button
																type="button"
																onClick={() => copyEmail(account.email)}
																className="p-0.5 rounded text-[#64748B] hover:text-white hover:bg-[#1E2433] transition-colors cursor-pointer shrink-0"
																title="Copy email"
															>
																{isCopied ? (
																	<Check className="h-3 w-3 text-[#00EA88]" />
																) : (
																	<Copy className="h-3 w-3" />
																)}
															</button>
														</div>

														<span
															className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase font-semibold shrink-0 ${
																account.status === "critical"
																	? "bg-rose-500/15 text-rose-400 border border-rose-500/20"
																	: account.status === "warning"
																		? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
																		: "bg-emerald-500/15 text-[#00EA88] border border-emerald-500/20"
															}`}
														>
															{account.status}
														</span>
													</div>

													{/* Model Groups */}
													<div className="space-y-2">
														{account.groups.map(
															(group: QuotaGroup, grpIdx: number) => {
																const isClaude =
																	group.displayName
																		.toLowerCase()
																		.includes("claude") ||
																	group.displayName
																		.toLowerCase()
																		.includes("gpt");
																const isCmc =
																	provider.provider.includes("commandcode") ||
																	group.displayName
																		.toLowerCase()
																		.includes("window") ||
																	group.displayName
																		.toLowerCase()
																		.includes("balance") ||
																	group.displayName
																		.toLowerCase()
																		.includes("credit");

																return (
																	<div
																		key={`${group.displayName}-${grpIdx}`}
																		className="rounded-md border border-[#1E2433]/70 bg-[#11151F] p-2 space-y-1.5"
																	>
																		{/* Group Title */}
																		<div className="flex items-center gap-1.5">
																			{isClaude ? (
																				<AnthropicIcon className="h-3 w-3" />
																			) : isCmc ? (
																				<CommandCodeIcon className="h-3 w-3" />
																			) : (
																				<GoogleIcon className="h-3 w-3" />
																			)}
																			<span className="text-[10px] font-bold text-white tracking-wide uppercase font-mono">
																				{group.displayName}
																			</span>
																		</div>

																		{/* Buckets */}
																		<div className="space-y-1.5">
																			{group.buckets.map(
																				(bucket: QuotaBucket) => {
																					const fraction = Math.max(
																						0,
																						Math.min(
																							1,
																							bucket.remainingFraction,
																						),
																					);
																					const percent = (
																						fraction * 100
																					).toFixed(1);
																					const isLow = fraction <= 0.2;
																					const isMid = fraction <= 0.5;

																					const barColor = isLow
																						? "bg-rose-500"
																						: isMid
																							? "bg-amber-400"
																							: "bg-[#00EA88]";
																					const textColor = isLow
																						? "text-rose-400"
																						: isMid
																							? "text-amber-400"
																							: "text-[#00EA88]";

																					const relativeReset =
																						formatRelativeTime(
																							bucket.resetTime,
																						);

																					return (
																						<div
																							key={bucket.bucketId}
																							className="space-y-0.5 text-xs"
																						>
																							<div className="flex items-center justify-between text-[10px]">
																								<div className="flex flex-col min-w-0">
																									<span className="text-[#8A94A6] truncate max-w-[130px]">
																										{bucket.displayName.replace(
																											" Limit Remaining",
																											"",
																										)}
																									</span>
																									{bucket.description &&
																										!bucket.description.startsWith(
																											"You have",
																										) && (
																											<span className="text-[9px] font-mono text-[#64748B]">
																												{
																													bucket.description
																												}
																											</span>
																										)}
																								</div>
																								<div className="flex items-center gap-1.5 font-mono shrink-0">
																									<span
																										className={`font-bold ${textColor}`}
																									>
																										{percent}%
																									</span>
																									{relativeReset && (
																										<span className="text-[9px] text-[#64748B] flex items-center gap-0.5">
																											<Clock className="h-2.5 w-2.5" />
																											{relativeReset}
																										</span>
																									)}
																								</div>
																							</div>

																							{/* Progress Bar (Compact 1.5) */}
																							<div className="h-1 w-full bg-[#1A202C] rounded-full overflow-hidden">
																								<div
																									className={`h-full rounded-full transition-all duration-300 ${barColor}`}
																									style={{
																										width: `${percent}%`,
																									}}
																								/>
																							</div>
																						</div>
																					);
																				},
																			)}
																		</div>
																	</div>
																);
															},
														)}
													</div>
												</div>
											);
										},
									)}
								</div>
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}
