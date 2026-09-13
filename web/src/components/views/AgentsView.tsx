import { useState } from "react";
import { TimeFilterBar } from "@/components/common/TimeFilterBar";
import { OpenCodeSection } from "./agents/OpenCodeSection";
import { HermesSection } from "./agents/HermesSection";
import type { AgentsData } from "@/types/dashboard";
import type { AgentFilter, Currency } from "./agents/agent-types";

interface AgentsViewProps {
	agents: AgentsData | null;
	timeRange: string;
	setTimeRange: (range: string) => void;
	lastRefreshed?: number;
}

const FILTER_STORAGE_KEY = "nexus_agents_filter";
const LEGACY_FILTER_STORAGE_KEY = "gn_agents_filter";

function readStoredFilter(): AgentFilter {
	if (typeof window === "undefined") return "all";
	try {
		const saved =
			localStorage.getItem(FILTER_STORAGE_KEY) ??
			localStorage.getItem(LEGACY_FILTER_STORAGE_KEY);
		if (saved === "all" || saved === "opencode" || saved === "hermes") {
			return saved;
		}
	} catch {
		// localStorage disabled
	}
	return "all";
}

function readStoredCurrency(): Currency {
	if (typeof window === "undefined") return "USD";
	try {
		const saved = localStorage.getItem("nexus_currency");
		if (saved === "USD" || saved === "IDR") return saved;
	} catch {
		// localStorage disabled
	}
	return "USD";
}

function readUsdIdrRate(): number {
	if (typeof window === "undefined") return 17000;
	try {
		const saved =
			localStorage.getItem("nexus_usd_idr_rate") ||
			localStorage.getItem("gn_usd_idr_rate");
		return saved ? Number(saved) : 17000;
	} catch {
		return 17000;
	}
}

const AGENT_FILTERS: Array<{ key: AgentFilter; label: string }> = [
	{ key: "all", label: "All" },
	{ key: "opencode", label: "OpenCode" },
	{ key: "hermes", label: "Hermes" },
];

export function AgentsView({ agents, timeRange, setTimeRange }: AgentsViewProps) {
	const [agentFilter, setAgentFilter] = useState<AgentFilter>(readStoredFilter);
	const [currency, setCurrency] = useState<Currency>(readStoredCurrency);
	const [usdIdrRate] = useState<number>(readUsdIdrRate);

	const setFilter = (next: AgentFilter) => {
		setAgentFilter(next);
		try {
			localStorage.setItem(FILTER_STORAGE_KEY, next);
		} catch {
			// localStorage disabled
		}
	};

	const toggleCurrency = () => {
		setCurrency((prev) => {
			const next: Currency = prev === "USD" ? "IDR" : "USD";
			try {
				localStorage.setItem("nexus_currency", next);
			} catch {
				// localStorage disabled
			}
			return next;
		});
	};

	const showOpenCode = agentFilter === "all" || agentFilter === "opencode";
	const showHermes = agentFilter === "all" || agentFilter === "hermes";

	return (
		<div className="space-y-6">
			{/* Top bar: time range + agent segmented pill */}
			<div className="flex items-center justify-between flex-wrap gap-2 pb-2">
				<TimeFilterBar timeRange={timeRange} setTimeRange={setTimeRange} />

				<div className="relative flex items-center bg-[#161B26] border border-[#1E2433] rounded-lg p-0.5 text-xs font-medium">
					{AGENT_FILTERS.map((f) => {
						const isActive = agentFilter === f.key;
						return (
							<button
								key={f.key}
								type="button"
								onClick={() => setFilter(f.key)}
								className={`px-3 py-1 rounded-md whitespace-nowrap transition-colors duration-200 cursor-pointer select-none ${
									isActive
										? "bg-[#1E2538] text-[#00EA88] font-semibold border border-[#00EA88]/20"
										: "text-[#8A94A6] hover:text-white"
								}`}
							>
								{f.label}
							</button>
						);
					})}
				</div>
			</div>

			<OpenCodeSection
				opencode={agents?.opencode}
				currency={currency}
				usdIdrRate={usdIdrRate}
				visible={showOpenCode}
				onToggleCurrency={toggleCurrency}
			/>

			<HermesSection hermes={agents?.hermes} visible={showHermes} />
		</div>
	);
}
