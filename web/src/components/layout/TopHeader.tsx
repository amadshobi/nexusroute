import { useState } from "react";
import { Menu, RefreshCw, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TopHeaderProps {
	activeNav: string;
	setMobileMenuOpen: (open: boolean) => void;
	sidebarCollapsed?: boolean;
	setSidebarCollapsed?: (value: boolean | ((prev: boolean) => boolean)) => void;
	fetchData?: () => Promise<void> | void;
	loading: boolean;
	isOnline: boolean;
}

export function TopHeader({
	activeNav,
	setMobileMenuOpen,
	sidebarCollapsed = false,
	setSidebarCollapsed,
	loading,
	isOnline,
}: TopHeaderProps) {
	const [spinning, setSpinning] = useState(false);

	const handleRefresh = () => {
		if (spinning) return;
		setSpinning(true);
		// Brief spin feedback, then hard-reload the page
		setTimeout(() => {
			window.location.reload();
		}, 180);
	};

	const getHeaderTitle = (nav: string) => {
		switch (nav) {
			case "overview-dashboard":
				return "Dashboard";
			case "overview-agents":
				return "Agents";
			case "overview-leaderboard":
				return "Leaderboard";
			case "settings-gateway":
				return "Gateway Settings";
			case "settings-models":
				return "Model Governance";
			case "settings-combo":
				return "Model Combos";
			case "logs":
				return "Logs";
			case "ping":
				return "Ping";
			case "quota":
				return "Quota";
			default:
				return nav
					.replace("overview-", "")
					.replace("settings-", "")
					.replace("-", " ");
		}
	};

	const isCurrentlySpinning = spinning || loading;

	return (
		<header className="flex h-14 items-center justify-between px-4 sm:px-8 border-b border-white/[0.08] bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-30 bevel-inset-subtle">
			<div className="flex items-center gap-3">
				<button
					onClick={() => setMobileMenuOpen(true)}
					className="p-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] text-[#94A3B8] hover:text-white md:hidden cursor-pointer bevel-inset-subtle"
					title="Open mobile menu"
				>
					<Menu className="h-4 w-4" />
				</button>

				{setSidebarCollapsed && (
					<button
						onClick={() => setSidebarCollapsed((prev) => !prev)}
						className="p-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] text-[#94A3B8] hover:text-white hover:bg-white/[0.08] hidden md:flex items-center justify-center cursor-pointer transition-colors bevel-inset-subtle"
						title={
							sidebarCollapsed
								? "Expand sidebar (Ctrl+B)"
								: "Collapse sidebar (Ctrl+B)"
						}
					>
						<PanelLeft className="h-4 w-4" />
					</button>
				)}

				<h2 className="text-base font-semibold text-white">
					{getHeaderTitle(activeNav)}
				</h2>
			</div>

			<div className="flex items-center gap-2">
				{isOnline ? (
					<div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#00EA88]/10 text-[#00EA88] border border-[#00EA88]/20 text-xs font-mono">
						<span className="h-1.5 w-1.5 rounded-full bg-[#00EA88] animate-pulse" />
						<span>Live</span>
						<span className="text-[10px] text-[#00EA88]/70 font-mono hidden sm:inline">:4010</span>
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
					className="h-8 w-8 p-0 border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] text-[#94A3B8] hover:text-white cursor-pointer active:scale-95 transition-all bevel-inset-subtle"
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
