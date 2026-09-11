import { useState } from "react";
import { Menu, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TopHeaderProps {
	activeNav: string;
	setMobileMenuOpen: (open: boolean) => void;
	fetchData?: () => Promise<void> | void;
	loading: boolean;
	isOnline: boolean;
}

export function TopHeader({
	activeNav,
	setMobileMenuOpen,
	loading,
	isOnline,
}: TopHeaderProps) {
	const [spinning, setSpinning] = useState(false);

	const handleRefresh = () => {
		if (spinning) return;
		setSpinning(true);
		// Kasih feedback animasi muter sebentar lalu hard-reload halaman
		setTimeout(() => {
			window.location.reload();
		}, 180);
	};

	const getHeaderTitle = (nav: string) => {
		switch (nav) {
			case "overview-dashboard":
				return "Dashboard";
			case "overview-opencode":
				return "OpenCode";
			case "overview-hermes":
				return "Hermes";
			case "settings-gateway":
				return "Gateway Settings";
			case "settings-models":
				return "Model Governance";
			case "settings-combo":
				return "Model Combos";
			case "logs":
				return "Live Logs";
			case "ping":
				return "Ping Monitor";
			case "quota":
				return "Quota Monitor";
			default:
				return nav
					.replace("overview-", "")
					.replace("settings-", "")
					.replace("-", " ");
		}
	};

	const isCurrentlySpinning = spinning || loading;

	return (
		<header className="flex h-14 items-center justify-between px-4 sm:px-8 border-b border-[#1E2433] bg-[#0E1117]/90 backdrop-blur sticky top-0 z-30">
			<div className="flex items-center gap-3">
				<button
					onClick={() => setMobileMenuOpen(true)}
					className="p-1.5 rounded-lg border border-[#1E2433] bg-[#161B26] text-[#94A3B8] hover:text-white md:hidden cursor-pointer"
				>
					<Menu className="h-4 w-4" />
				</button>

				<h2 className="text-base font-semibold text-white">
					{getHeaderTitle(activeNav)}
				</h2>
			</div>

			<div className="flex items-center gap-2">
				{isOnline ? (
					<div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#00EA88]/10 text-[#00EA88] border border-[#00EA88]/20 text-xs font-mono">
						<span className="h-1.5 w-1.5 rounded-full bg-[#00EA88] animate-pulse" />
						<span>Live</span>
					</div>
				) : (
					<div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-mono">
						<span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
						<span>Offline</span>
					</div>
				)}

				<Button
					variant="outline"
					size="sm"
					onClick={handleRefresh}
					disabled={spinning}
					className="h-8 w-8 p-0 border-[#1E2433] bg-[#161B26] hover:bg-[#1E2433] text-[#94A3B8] hover:text-white cursor-pointer active:scale-95 transition-all"
					title="Refresh Data Now"
				>
					<RefreshCw
						className={`h-3.5 w-3.5 transition-colors ${
							isCurrentlySpinning ? "animate-spin text-[#00EA88]" : ""
						}`}
					/>
				</Button>
			</div>
		</header>
	);
}
