import {
	LayoutDashboard,
	Terminal,
	Database,
	Sliders,
	X,
	ChevronDown,
	ChevronRight,
	Layers,
	Server,
	Bot,
	Trophy,
	FlaskConical,
} from "lucide-react";
import { NexusIcon } from "@/components/icons/ProviderIcons";

interface SidebarProps {
	activeNav: string;
	setActiveNav: (nav: string) => void;
	mobileMenuOpen: boolean;
	setMobileMenuOpen: (open: boolean) => void;
	sidebarOverviewOpen: boolean;
	setSidebarOverviewOpen: (open: boolean) => void;
	sidebarSettingsOpen: boolean;
	setSidebarSettingsOpen: (open: boolean) => void;
	collapsed?: boolean;
}

export function Sidebar({
	activeNav,
	setActiveNav,
	mobileMenuOpen,
	setMobileMenuOpen,
	sidebarOverviewOpen,
	setSidebarOverviewOpen,
	sidebarSettingsOpen,
	setSidebarSettingsOpen,
	collapsed = false,
}: SidebarProps) {
	const handleNavClick = (nav: string) => {
		setActiveNav(nav);
		setMobileMenuOpen(false);
	};

	return (
		<aside
			className={`fixed inset-y-0 left-0 h-screen flex flex-col border-r border-[#1E2433] bg-[#121622] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] z-40 ${
				mobileMenuOpen
					? "translate-x-0 shadow-2xl w-64"
					: "-translate-x-full md:translate-x-0"
			} ${collapsed ? "md:w-16" : "md:w-64"} shrink-0 select-none`}
		>
			{/* Brand Header */}
			<div className="flex h-14 items-center justify-between px-3 border-b border-[#1E2433] shrink-0 overflow-hidden">
				<button
					onClick={() => handleNavClick("overview-dashboard")}
					className="flex items-center gap-3 text-left group cursor-pointer focus:outline-none min-w-0 flex-1"
					title="NexusRoute Gateway Console"
				>
					<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#00EA88]/10 border border-[#00EA88]/25 group-hover:border-[#00EA88]/50 group-hover:bg-[#00EA88]/20 group-hover:scale-105 transition-all shadow-sm shadow-[#00EA88]/10 shrink-0">
						<NexusIcon className="h-4.5 w-4.5" />
					</div>
					<div
						className={`overflow-hidden whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
							collapsed
								? "max-w-0 opacity-0 -translate-x-2"
								: "max-w-xs opacity-100 translate-x-0"
						}`}
					>
						<span className="font-semibold text-sm tracking-tight text-white group-hover:text-[#00EA88] transition-colors block">
							NexusRoute
						</span>
						<span className="text-[10px] text-[#64748B] block font-mono">
							Gateway Console
						</span>
					</div>
				</button>

				<button
					onClick={() => setMobileMenuOpen(false)}
					className="p-1 rounded-md text-[#64748B] hover:text-white hover:bg-[#1A2030] md:hidden shrink-0"
					title="Close mobile menu"
				>
					<X className="h-5 w-5" />
				</button>
			</div>

			{/* Navigation with smooth cross-fade between Expanded & Collapsed Rail */}
			<nav className="flex-1 p-2.5 overflow-y-auto scrollbar-none relative">
				{/* 1. COLLAPSED ICON-ONLY RAIL */}
				<div
					className={`flex flex-col items-center space-y-1.5 py-1 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
						collapsed
							? "opacity-100 translate-x-0 pointer-events-auto"
							: "opacity-0 -translate-x-4 pointer-events-none absolute inset-x-2.5 top-3.5"
					}`}
				>
					{/* Overview Group */}
					<button
						onClick={() => handleNavClick("overview-dashboard")}
						className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
							activeNav === "overview-dashboard"
								? "bg-[#1E2538] text-[#00EA88] border border-[#00EA88]/30 shadow-sm shadow-[#00EA88]/10"
								: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
						}`}
						title="Dashboard"
					>
						<LayoutDashboard className="h-4 w-4 text-blue-400" />
					</button>

					<button
						onClick={() => handleNavClick("overview-agents")}
						className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
							activeNav === "overview-agents"
								? "bg-[#1E2538] text-[#00EA88] border border-[#00EA88]/30 shadow-sm shadow-[#00EA88]/10"
								: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
						}`}
						title="Agents Telemetry"
					>
						<Bot className="h-4 w-4 text-sky-400" />
					</button>

					<button
						onClick={() => handleNavClick("overview-leaderboard")}
						className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
							activeNav === "overview-leaderboard"
								? "bg-[#1E2538] text-[#00EA88] border border-[#00EA88]/30 shadow-sm shadow-[#00EA88]/10"
								: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
						}`}
						title="Leaderboard & Intelligence"
					>
						<Trophy className="h-4 w-4 text-amber-400" />
					</button>

					{/* Divider */}
					<div className="w-8 border-t border-[#1E2433] my-1" />

					{/* Monitor Group */}
					<button
						onClick={() => handleNavClick("logs")}
						className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
							activeNav === "logs"
								? "bg-[#1E2538] text-[#00EA88] border border-[#00EA88]/30 shadow-sm shadow-[#00EA88]/10"
								: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
						}`}
						title="Logs"
					>
						<Terminal className="h-4 w-4" />
					</button>

					<button
						onClick={() => handleNavClick("ping")}
						className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
							activeNav === "ping"
								? "bg-[#1E2538] text-[#00EA88] border border-[#00EA88]/30 shadow-sm shadow-[#00EA88]/10"
								: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
						}`}
						title="Ping"
					>
						<FlaskConical className="h-4 w-4" />
					</button>

					<button
						onClick={() => handleNavClick("quota")}
						className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
							activeNav === "quota"
								? "bg-[#1E2538] text-[#00EA88] border border-[#00EA88]/30 shadow-sm shadow-[#00EA88]/10"
								: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
						}`}
						title="Quota"
					>
						<Database className="h-4 w-4" />
					</button>

					{/* Divider */}
					<div className="w-8 border-t border-[#1E2433] my-1" />

					{/* Control Plane Group */}
					<button
						onClick={() => handleNavClick("settings-gateway")}
						className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
							activeNav === "settings-gateway"
								? "bg-[#1E2538] text-[#00EA88] border border-[#00EA88]/30 shadow-sm shadow-[#00EA88]/10"
								: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
						}`}
						title="Gateway Settings"
					>
						<Server className="h-4 w-4 text-emerald-400" />
					</button>

					<button
						onClick={() => handleNavClick("settings-models")}
						className={`h-9 w-9 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
							activeNav === "settings-models"
								? "bg-[#1E2538] text-[#00EA88] border border-[#00EA88]/30 shadow-sm shadow-[#00EA88]/10"
								: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
						}`}
						title="Model Governance"
					>
						<Layers className="h-4 w-4 text-amber-400" />
					</button>
				</div>

				{/* 2. EXPANDED FULL ACCORDION VIEW */}
				<div
					className={`space-y-4 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
						collapsed
							? "opacity-0 translate-x-4 pointer-events-none absolute inset-x-2.5 top-3.5"
							: "opacity-100 translate-x-0 pointer-events-auto"
					}`}
				>
					{/* ACCORDION 1: OVERVIEW */}
					<div className="space-y-1">
						<button
							onClick={() => setSidebarOverviewOpen(!sidebarOverviewOpen)}
							className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
								!sidebarOverviewOpen && activeNav.startsWith("overview-")
									? "text-white bg-[#1A2030]/60"
									: "text-[#8A94A6] hover:text-white hover:bg-[#1A2030]"
							}`}
						>
							<div className="flex items-center gap-3">
								<LayoutDashboard className="h-4 w-4 shrink-0 text-[#7AA2F7]" />
								<span>Overview</span>
							</div>
							{sidebarOverviewOpen ? (
								<ChevronDown className="h-3.5 w-3.5 text-[#64748B]" />
							) : (
								<ChevronRight className="h-3.5 w-3.5 text-[#64748B]" />
							)}
						</button>

						<div
							className={`grid transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
								sidebarOverviewOpen
									? "grid-rows-[1fr] opacity-100"
									: "grid-rows-[0fr] opacity-0 pointer-events-none"
							}`}
						>
							<div className="overflow-hidden min-h-0 ml-4 pl-3 border-l border-[#1E2433] space-y-1 py-1">
								<button
									onClick={() => handleNavClick("overview-dashboard")}
									className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-all duration-200 cursor-pointer ${
										activeNav === "overview-dashboard"
											? "bg-[#1E2538] text-[#00EA88] font-semibold translate-x-1"
											: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
									}`}
								>
									<LayoutDashboard className="h-3.5 w-3.5 text-blue-400 shrink-0" />
									<span>Dashboard</span>
								</button>

								<button
									onClick={() => handleNavClick("overview-agents")}
									className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-all duration-200 cursor-pointer ${
										activeNav === "overview-agents"
											? "bg-[#1E2538] text-[#00EA88] font-semibold translate-x-1"
											: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
									}`}
								>
									<Bot className="h-3.5 w-3.5 text-sky-400 shrink-0" />
									<span>Agents</span>
								</button>

								<button
									onClick={() => handleNavClick("overview-leaderboard")}
									className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-all duration-200 cursor-pointer ${
										activeNav === "overview-leaderboard"
											? "bg-[#1E2538] text-[#00EA88] font-semibold translate-x-1"
											: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
									}`}
								>
									<Trophy className="h-3.5 w-3.5 text-amber-400 shrink-0" />
									<span>Leaderboard</span>
								</button>
							</div>
						</div>
					</div>

					{/* MONITOR */}
					<div className="space-y-1 pt-2 border-t border-[#1E2433]">
						<span className="px-3 text-[10px] font-semibold tracking-wider text-[#64748B] uppercase block">
							Monitor
						</span>

						<button
							onClick={() => handleNavClick("logs")}
							className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
								activeNav === "logs"
									? "bg-[#1E2538] text-[#00EA88] shadow-sm font-semibold"
									: "text-[#94A3B8] hover:bg-[#1A2030] hover:text-white"
							}`}
						>
							<Terminal className="h-4 w-4 shrink-0" />
							<span>Logs</span>
						</button>

						<button
							onClick={() => handleNavClick("ping")}
							className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
								activeNav === "ping"
									? "bg-[#1E2538] text-[#00EA88] shadow-sm font-semibold"
									: "text-[#94A3B8] hover:bg-[#1A2030] hover:text-white"
							}`}
						>
							<FlaskConical className="h-4 w-4 shrink-0" />
							<span>Ping</span>
						</button>

						<button
							onClick={() => handleNavClick("quota")}
							className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
								activeNav === "quota"
									? "bg-[#1E2538] text-[#00EA88] shadow-sm font-semibold"
									: "text-[#94A3B8] hover:bg-[#1A2030] hover:text-white"
							}`}
						>
							<Database className="h-4 w-4 shrink-0" />
							<span>Quota</span>
						</button>
					</div>

					{/* CONTROL PLANE / SETTINGS ACCORDION */}
					<div className="space-y-1 pt-2 border-t border-[#1E2433]">
						<span className="px-3 text-[10px] font-semibold tracking-wider text-[#64748B] uppercase block">
							Control Plane
						</span>

						<button
							onClick={() => setSidebarSettingsOpen(!sidebarSettingsOpen)}
							className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
								!sidebarSettingsOpen && activeNav.startsWith("settings-")
									? "text-white bg-[#1A2030]/60"
									: "text-[#8A94A6] hover:text-white hover:bg-[#1A2030]"
							}`}
						>
							<div className="flex items-center gap-3">
								<Sliders className="h-4 w-4 shrink-0 text-[#A855F7]" />
								<span>Settings</span>
							</div>
							{sidebarSettingsOpen ? (
								<ChevronDown className="h-3.5 w-3.5 text-[#64748B]" />
							) : (
								<ChevronRight className="h-3.5 w-3.5 text-[#64748B]" />
							)}
						</button>

						<div
							className={`grid transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
								sidebarSettingsOpen
									? "grid-rows-[1fr] opacity-100"
									: "grid-rows-[0fr] opacity-0 pointer-events-none"
							}`}
						>
							<div className="overflow-hidden min-h-0 ml-4 pl-3 border-l border-[#1E2433] space-y-1 py-1">
								<button
									onClick={() => handleNavClick("settings-gateway")}
									className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-all duration-200 cursor-pointer ${
										activeNav === "settings-gateway"
											? "bg-[#1E2538] text-[#00EA88] font-semibold translate-x-1"
											: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
									}`}
								>
									<Server className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
									<span>Gateway</span>
								</button>

								<button
									onClick={() => handleNavClick("settings-models")}
									className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-all duration-200 cursor-pointer ${
										activeNav === "settings-models"
											? "bg-[#1E2538] text-[#00EA88] font-semibold translate-x-1"
											: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
									}`}
								>
									<Layers className="h-3.5 w-3.5 text-amber-400 shrink-0" />
									<span>Models</span>
								</button>
							</div>
						</div>
					</div>
				</div>
			</nav>
		</aside>
	);
}
