import { useState } from "react";
import { RotateCcw, DollarSign, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GatewayControlViewProps {
	restartGateway: () => void;
	usdIdrRate: number;
	setUsdIdrRate: (rate: number) => void;
	isOnline?: boolean;
}

export function GatewayControlView({
	restartGateway,
	usdIdrRate,
	setUsdIdrRate,
	isOnline = true,
}: GatewayControlViewProps) {
	const [rateInput, setRateInput] = useState(usdIdrRate.toString());
	const [prevRate, setPrevRate] = useState(usdIdrRate);
	const [saved, setSaved] = useState(false);

	// Sync state cleanly when prop changes without cascading render in effect
	if (usdIdrRate !== prevRate) {
		setPrevRate(usdIdrRate);
		setRateInput(usdIdrRate.toString());
	}

	const handleSaveRate = (e: React.FormEvent) => {
		e.preventDefault();
		const num = Number(rateInput.replace(/[^0-9]/g, ""));
		if (num > 0) {
			setUsdIdrRate(num);
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
		}
	};

	return (
		<div className="space-y-4 max-w-2xl">
			{/* Card 1: Daemon Lifecycle */}
			<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-5 shadow-sm space-y-4">
				<div className="pb-3 border-b border-[#1E2433]">
					<h3 className="text-sm font-semibold text-white">
						Gateway Lifecycle Control
					</h3>
					<p className="text-xs text-[#8A94A6] mt-0.5">
						Status runtime daemon, restart, dan shutdown gateway
					</p>
				</div>

				<div className="flex items-center justify-between p-3.5 rounded-lg bg-[#161B26] border border-[#1E2433] text-xs font-mono">
					<div className="space-y-1">
						<span className="text-[#8A94A6] block">Daemon Status</span>
						{isOnline ? (
							<span className="text-[#00EA88] font-bold flex items-center gap-1.5">
								<span className="h-2 w-2 rounded-full bg-[#00EA88] animate-pulse" />{" "}
								RUNNING (PORT :4010)
							</span>
						) : (
							<span className="text-rose-400 font-bold flex items-center gap-1.5">
								<span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />{" "}
								OFFLINE (PORT :4010)
							</span>
						)}
					</div>
					<Button
						size="sm"
						onClick={restartGateway}
						className="bg-[#1D68FE] hover:bg-[#1D68FE]/80 text-white text-xs h-9 px-4 gap-1.5 cursor-pointer"
					>
						<RotateCcw className="h-3.5 w-3.5" /> Restart Gateway
					</Button>
				</div>
			</div>

			{/* Card 2: Currency & Pricing Settings */}
			<div className="rounded-xl border border-[#1E2433] bg-[#131722] p-5 shadow-sm space-y-4">
				<div className="pb-3 border-b border-[#1E2433]">
					<h3 className="text-sm font-semibold text-white">
						Market Value Currency Exchange
					</h3>
					<p className="text-xs text-[#8A94A6] mt-0.5">
						USD to IDR exchange rate for Market Value calculation in Dashboard
					</p>
				</div>

				<form onSubmit={handleSaveRate} className="space-y-3">
					<div className="flex flex-col sm:flex-row sm:items-center gap-3">
						<div className="relative flex-1">
							<span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-[#8A94A6]">
								Rp
							</span>
							<input
								type="text"
								value={rateInput}
								onChange={(e) => setRateInput(e.target.value)}
								placeholder="17000"
								className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#1E2433] bg-[#161B26] text-xs font-mono text-white focus:outline-none focus:border-[#1D68FE] transition-colors"
							/>
						</div>
						<Button
							type="submit"
							size="sm"
							className="bg-[#161B26] hover:bg-[#1E2433] text-white border border-[#1E2433] text-xs h-9 px-4 gap-1.5 cursor-pointer transition-colors"
						>
							{saved ? (
								<>
									<Check className="h-3.5 w-3.5 text-[#00EA88]" />
									<span className="text-[#00EA88]">Saved</span>
								</>
							) : (
								<>
									<DollarSign className="h-3.5 w-3.5 text-[#7AA2F7]" />
									<span>Save Rate</span>
								</>
							)}
						</Button>
					</div>
					<p className="text-[11px] text-[#64748B] font-mono">
						Default: Rp17,000 / USD. Persisted locally in browser storage.
					</p>
				</form>
			</div>
		</div>
	);
}
