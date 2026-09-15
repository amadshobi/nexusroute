import { useState } from "react";
import { TimeFilterBar } from "@/components/common/TimeFilterBar";
import { OpenCodeSection } from "./agents/OpenCodeSection";
import type { AgentsData } from "@/types/dashboard";
import type { Currency } from "./agents/agent-types";

interface AgentsViewProps {
	agents: AgentsData | null;
	timeRange: string;
	setTimeRange: (range: string) => void;
	lastRefreshed?: number;
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

export function AgentsView({ agents, timeRange, setTimeRange }: AgentsViewProps) {
	const [currency, setCurrency] = useState<Currency>(readStoredCurrency);
	const [usdIdrRate] = useState<number>(readUsdIdrRate);

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

	return (
		<div className="space-y-6">
			{/* Top bar: time range filter */}
			<div className="flex items-center pb-2">
				<TimeFilterBar timeRange={timeRange} setTimeRange={setTimeRange} />
			</div>

			<OpenCodeSection
				opencode={agents?.opencode}
				currency={currency}
				usdIdrRate={usdIdrRate}
				onToggleCurrency={toggleCurrency}
			/>
		</div>
	);
}
