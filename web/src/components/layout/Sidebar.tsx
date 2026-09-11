import {
	LayoutDashboard,
	Terminal,
	Database,
	Sliders,
	X,
	Zap,
	ChevronDown,
	ChevronRight,
	Layers,
	Server,
	Code2,
	Bot,
	FlaskConical,
} from "lucide-react";

interface SidebarProps {
	activeNav: string;
	setActiveNav: (nav: string) => void;
	mobileMenuOpen: boolean;
	setMobileMenuOpen: (open: boolean) => void;
	sidebarOverviewOpen: boolean;
	setSidebarOverviewOpen: (open: boolean) => void;
	sidebarSettingsOpen: boolean;
	setSidebarSettingsOpen: (open: boolean) => void;
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
}: SidebarProps) {
	const handleNavClick = (nav: string) => {
		setActiveNav(nav);
		setMobileMenuOpen(false);
	};

	return (
		<aside
			className={`fixed md:sticky top-0 h-screen flex flex-col border-r border-[#1E2433] bg-[#121622] transition-transform duration-200 z-50 w-64 ${
				mobileMenuOpen
					? "translate-x-0 shadow-2xl"
					: "-translate-x-full md:translate-x-0"
			} shrink-0`}
		>
			{/* Brand Header */}
			<div className="flex h-14 items-center justify-between px-4 border-b border-[#1E2433]">
				<button
					onClick={() => handleNavClick("overview-dashboard")}
					className="flex items-center gap-3 text-left group cursor-pointer focus:outline-none"
				>
					<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#00EA88] group-hover:scale-105 transition-transform text-black shadow-md shadow-[#00EA88]/20 shrink-0">
						<Zap className="h-4 w-4 fill-black" />
					</div>
					<div className="overflow-hidden whitespace-nowrap">
						<span className="font-semibold text-sm tracking-tight text-white group-hover:text-[#00EA88] transition-colors block">
							Goblin Nexus
						</span>
						<span className="text-[10px] text-[#64748B] block font-mono">
							Gateway Console
						</span>
					</div>
				</button>

				<button
					onClick={() => setMobileMenuOpen(false)}
					className="p-1 rounded-md text-[#64748B] hover:text-white md:hidden"
				>
					<X className="h-5 w-5" />
				</button>
			</div>

			{/* Navigation */}
			<nav className="flex-1 space-y-4 p-3 overflow-y-auto">
				{/* ACCORDION 1: OVERVIEW */}
				<div className="space-y-1">
					<button
						onClick={() => setSidebarOverviewOpen(!sidebarOverviewOpen)}
						className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-[#8A94A6] hover:text-white hover:bg-[#1A2030] transition-colors"
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
						className={`grid transition-all duration-300 ease-in-out ${
							sidebarOverviewOpen
								? "grid-rows-[1fr] opacity-100 mt-1"
								: "grid-rows-[0fr] opacity-0 mt-0"
						}`}
					>
						<div className="overflow-hidden ml-4 pl-3 border-l border-[#1E2433] space-y-1">
							<button
								onClick={() => handleNavClick("overview-dashboard")}
								className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-all duration-200 ${
									activeNav === "overview-dashboard"
										? "bg-[#1E2538] text-[#00EA88] font-semibold translate-x-1"
										: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
								}`}
							>
								<LayoutDashboard className="h-3.5 w-3.5 shrink-0" />
								<span>Dashboard</span>
							</button>

							<button
								onClick={() => handleNavClick("overview-opencode")}
								className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-all duration-200 ${
									activeNav === "overview-opencode"
										? "bg-[#1E2538] text-[#00EA88] font-semibold translate-x-1"
										: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
								}`}
							>
								<Code2 className="h-3.5 w-3.5 text-sky-400 shrink-0" />
								<span>OpenCode</span>
							</button>

							<button
								onClick={() => handleNavClick("overview-hermes")}
								className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-all duration-200 ${
									activeNav === "overview-hermes"
										? "bg-[#1E2538] text-[#00EA88] font-semibold translate-x-1"
										: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
								}`}
							>
								<Bot className="h-3.5 w-3.5 text-purple-400 shrink-0" />
								<span>Hermes</span>
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
						className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
							activeNav === "logs"
								? "bg-[#1E2538] text-[#00EA88] shadow-sm font-semibold"
								: "text-[#94A3B8] hover:bg-[#1A2030] hover:text-white"
						}`}
					>
						<Terminal className="h-4 w-4 shrink-0" />
						<span>Live Logs</span>
					</button>

					<button
						onClick={() => handleNavClick("ping")}
						className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
							activeNav === "ping"
								? "bg-[#1E2538] text-[#00EA88] shadow-sm font-semibold"
								: "text-[#94A3B8] hover:bg-[#1A2030] hover:text-white"
						}`}
					>
						<FlaskConical className="h-4 w-4 shrink-0" />
						<span>Ping Monitor</span>
					</button>

					<button
						onClick={() => handleNavClick("quota")}
						className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
							activeNav === "quota"
								? "bg-[#1E2538] text-[#00EA88] shadow-sm font-semibold"
								: "text-[#94A3B8] hover:bg-[#1A2030] hover:text-white"
						}`}
					>
						<Database className="h-4 w-4 shrink-0" />
						<span>Quota Monitor</span>
					</button>
				</div>

				{/* CONTROL PLANE / SETTINGS ACCORDION */}
				<div className="space-y-1 pt-2 border-t border-[#1E2433]">
					<span className="px-3 text-[10px] font-semibold tracking-wider text-[#64748B] uppercase block">
						Control Plane
					</span>

					<button
						onClick={() => setSidebarSettingsOpen(!sidebarSettingsOpen)}
						className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-[#94A3B8] hover:text-white hover:bg-[#1A2030] transition-colors"
					>
						<div className="flex items-center gap-3">
							<Sliders className="h-4 w-4 shrink-0" />
							<span>Settings</span>
						</div>
						{sidebarSettingsOpen ? (
							<ChevronDown className="h-3.5 w-3.5 text-[#64748B]" />
						) : (
							<ChevronRight className="h-3.5 w-3.5 text-[#64748B]" />
						)}
					</button>

					<div
						className={`grid transition-all duration-300 ease-in-out ${
							sidebarSettingsOpen
								? "grid-rows-[1fr] opacity-100 mt-1"
								: "grid-rows-[0fr] opacity-0 mt-0"
						}`}
					>
						<div className="overflow-hidden ml-4 pl-3 border-l border-[#1E2433] space-y-1">
							<button
								onClick={() => handleNavClick("settings-gateway")}
								className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-all duration-200 ${
									activeNav === "settings-gateway"
										? "bg-[#1E2538] text-[#00EA88] font-semibold translate-x-1"
										: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
								}`}
							>
								<Server className="h-3.5 w-3.5 shrink-0" />
								<span>Gateway</span>
							</button>

							<button
								onClick={() => handleNavClick("settings-models")}
								className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition-all duration-200 ${
									activeNav === "settings-models"
										? "bg-[#1E2538] text-[#00EA88] font-semibold translate-x-1"
										: "text-[#94A3B8] hover:text-white hover:bg-[#161B26]"
								}`}
							>
								<Layers className="h-3.5 w-3.5 shrink-0" />
								<span>Models</span>
							</button>
						</div>
					</div>
				</div>
			</nav>

			<div className="p-3 border-t border-[#1E2433] text-[11px] text-[#64748B] font-mono flex items-center justify-between">
				<span>PORT :4010</span>
				<span className="text-[#00EA88] font-semibold">ONLINE</span>
			</div>
		</aside>
	);
}
