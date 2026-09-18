import { useState, useEffect, useCallback, useMemo } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { TopHeader } from "./components/layout/TopHeader";
import { DashboardView } from "./components/views/DashboardView";
import { LeaderboardView } from "./components/views/LeaderboardView";
import { AgentsView } from "./components/views/AgentsView";
import { QuotaView } from "./components/views/QuotaView";
import { LiveLogsView } from "./components/views/LiveLogsView";
import { PingView } from "./components/views/PingView";
import { GatewayControlView } from "./components/views/GatewayControlView";
import { ModelsControlView } from "./components/views/ModelsControlView";
import type {
	OverviewData,
	QuotaResponse,
	LogEntry,
	AgentsData,
	ModelsConfigResponse,
	ModelsCatalogsResponse,
} from "./types/dashboard";
import { computeTimeSeriesBuckets } from "./lib/formatters";
import { useGatewayEvents } from "./lib/useGatewayEvents";

const VALID_NAVS = new Set([
	"overview-dashboard",
	"overview-agents",
	"overview-leaderboard",
	"ping",
	"quota",
	"logs",
	"settings-gateway",
	"settings-models",
	"settings-combo",
]);

// Legacy nav keys are transparently mapped onto the consolidated Agents view.
const LEGACY_NAV_ALIASES: Record<string, string> = {
	"overview-opencode": "overview-agents",
	"overview-hermes": "overview-agents",
};

function getStorageItem(key: string, legacyKey?: string): string | null {
	if (typeof window === "undefined") return null;
	try {
		return (
			localStorage.getItem(key) ??
			(legacyKey ? localStorage.getItem(legacyKey) : null)
		);
	} catch {
		return null;
	}
}

function setStorageItem(key: string, value: string): void {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem(key, value);
	} catch {
		// localStorage disabled or full
	}
}

function getInitialNav(): string {
	if (typeof window !== "undefined") {
		const hash = window.location.hash.replace(/^#\/?/, "");
		const normalized = LEGACY_NAV_ALIASES[hash] ?? hash;
		if (normalized && VALID_NAVS.has(normalized)) {
			return normalized;
		}
		const saved = getStorageItem("nexus_active_nav", "gn_active_nav");
		const normalizedSaved = saved ? (LEGACY_NAV_ALIASES[saved] ?? saved) : null;
		if (normalizedSaved && VALID_NAVS.has(normalizedSaved)) {
			return normalizedSaved;
		}
	}
	return "overview-dashboard";
}

export default function App() {
	// Navigation & Drawer State (Persistent via Hash & LocalStorage)
	const [activeNav, setActiveNavState] = useState(getInitialNav);
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	const [sidebarOverviewOpen, setSidebarOverviewOpen] = useState(true);
	const [sidebarSettingsOpen, setSidebarSettingsOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(() => {
		const saved = getStorageItem(
			"nexus_sidebar_collapsed",
			"gn_sidebar_collapsed",
		);
		return saved === "true";
	});

	const setSidebarCollapsed = useCallback(
		(value: boolean | ((prev: boolean) => boolean)) => {
			setSidebarCollapsedState((prev) => {
				const next = typeof value === "function" ? value(prev) : value;
				setStorageItem("nexus_sidebar_collapsed", next ? "true" : "false");
				return next;
			});
		},
		[],
	);

	// Global shortcut Ctrl+B / Cmd+B to toggle sidebar collapse
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
				// Don't intercept if user is typing in input or textarea
				const target = e.target as HTMLElement;
				if (
					target?.tagName === "INPUT" ||
					target?.tagName === "TEXTAREA" ||
					target?.isContentEditable
				) {
					return;
				}
				e.preventDefault();
				setSidebarCollapsed((prev) => !prev);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [setSidebarCollapsed]);

	// In-session view snapshots: each view preserves its chosen time range during navigation & reload
	const [viewTimeRanges, setViewTimeRanges] = useState<Record<string, string>>(
		() => {
			const saved = getStorageItem(
				"nexus_view_time_ranges",
				"gn_view_time_ranges",
			);
			if (saved) {
				try {
					return JSON.parse(saved);
				} catch {
					// fallback
				}
			}
			return {
				"overview-dashboard": "all",
				"overview-agents": "all",
				"overview-leaderboard": "all",
			};
		},
	);

	const activeTimeRange = viewTimeRanges[activeNav] || "all";

	const setActiveNav = useCallback((nav: string) => {
		setActiveNavState(nav);
		setStorageItem("nexus_active_nav", nav);
		if (typeof window !== "undefined" && window.location.hash !== `#${nav}`) {
			window.history.replaceState(null, "", `#${nav}`);
		}
	}, []);

	// Listen to browser Back/Forward buttons
	useEffect(() => {
		const handleHashChange = () => {
			const hash = window.location.hash.replace(/^#\/?/, "");
			const normalized = LEGACY_NAV_ALIASES[hash] ?? hash;
			if (normalized && VALID_NAVS.has(normalized)) {
				setActiveNavState(normalized);
			}
		};
		window.addEventListener("hashchange", handleHashChange);
		return () => window.removeEventListener("hashchange", handleHashChange);
	}, []);

	// Remote Data State & Connectivity
	const [usdIdrRate, setUsdIdrRateState] = useState<number>(() => {
		const saved = getStorageItem("nexus_usd_idr_rate", "gn_usd_idr_rate");
		if (saved) {
			const parsed = Number(saved);
			if (parsed > 0) return parsed;
		}
		return 17000;
	});

	const setUsdIdrRate = useCallback((rate: number) => {
		setUsdIdrRateState(rate);
		setStorageItem("nexus_usd_idr_rate", rate.toString());
	}, []);

	const [overview, setOverview] = useState<OverviewData | null>(null);
	const [quota, setQuota] = useState<QuotaResponse>({
		available: false,
		entries: [],
		providers: [],
	});
	const [agents, setAgents] = useState<AgentsData | null>(null);
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [isOnline, setIsOnline] = useState(true);
	const [lastRefreshed, setLastRefreshed] = useState(() => 0);

	// Model Governance State (sourced from backend model filter config)
	const [modelsConfig, setModelsConfig] = useState<ModelsConfigResponse | null>(
		null,
	);
	const [modelsCatalogs, setModelsCatalogs] =
		useState<ModelsCatalogsResponse | null>(null);

	const fetchData = useCallback(
		async (selectedRange?: string) => {
			try {
				const activeRange = selectedRange || viewTimeRanges[activeNav] || "all";
				const rangeQuery = activeRange
					? `?range=${encodeURIComponent(activeRange)}`
					: "";

				const [ovRes, qRes, logRes, agentRes] = await Promise.allSettled([
					fetch(`/api/dashboard/overview${rangeQuery}`),
					fetch("/api/dashboard/quota"),
					fetch(`/api/dashboard/logs${rangeQuery}`),
					fetch(`/api/dashboard/agents${rangeQuery}`),
				]);

				let anySuccess = false;

				if (ovRes.status === "fulfilled" && ovRes.value.ok) {
					setOverview(await ovRes.value.json());
					anySuccess = true;
				}
				if (qRes.status === "fulfilled" && qRes.value.ok) {
					setQuota(await qRes.value.json());
					anySuccess = true;
				}
				if (logRes.status === "fulfilled" && logRes.value.ok) {
					const data = await logRes.value.json();
					setLogs(Array.isArray(data) ? data : data.logs || []);
					anySuccess = true;
				}
				if (agentRes.status === "fulfilled" && agentRes.value.ok) {
					setAgents(await agentRes.value.json());
					anySuccess = true;
				}

				setIsOnline(anySuccess);
				setLastRefreshed(Date.now());
			} catch {
				setIsOnline(false);
			} finally {
				setLoading(false);
			}
		},
		[activeNav, viewTimeRanges],
	);

	const fetchModelsConfig = useCallback(async () => {
		try {
			const [configRes, catalogsRes] = await Promise.allSettled([
				fetch("/api/dashboard/models/config"),
				fetch("/api/dashboard/models/catalogs"),
			]);
			if (configRes.status === "fulfilled" && configRes.value.ok) {
				setModelsConfig(await configRes.value.json());
			}
			if (catalogsRes.status === "fulfilled" && catalogsRes.value.ok) {
				setModelsCatalogs(await catalogsRes.value.json());
			}
		} catch {
			// silent fail
		}
	}, []);

	const handleViewTimeRangeChange = (viewKey: string, newRange: string) => {
		setViewTimeRanges((prev) => {
			const next = { ...prev, [viewKey]: newRange };
			setStorageItem("nexus_view_time_ranges", JSON.stringify(next));
			return next;
		});
		void fetchData(newRange);
	};

	const handleGatewayLogEntry = useCallback((entry: LogEntry) => {
		setLogs((prev) => {
			if (prev.some((p) => p.ts === entry.ts && p.path === entry.path)) {
				return prev;
			}
			return [entry, ...prev.slice(0, 199)];
		});
		setLastRefreshed(Date.now());
		setIsOnline(true);
	}, []);

	const handleGatewayStatsDelta = useCallback(() => {
		setLastRefreshed(Date.now());
		setIsOnline(true);
	}, []);

	// Live gateway events over SSE; the fallback poll only kicks in when the
	// stream is down, replacing the previous aggressive 3s fetch interval.
	useGatewayEvents({
		onLogEntry: handleGatewayLogEntry,
		onStatsDelta: handleGatewayStatsDelta,
		fallbackPoll: () => void fetchData(activeTimeRange),
		fallbackIntervalMs: 30_000,
		// While connected, the relaxed background sync below covers overview/quota.
		fallbackConnectedIntervalMs: 0,
	});

	// Hydrate on mount / navigation / range change, then a relaxed background sync.
	useEffect(() => {
		const targetRange = viewTimeRanges[activeNav] || "all";
		const timer = setTimeout(() => {
			void fetchData(targetRange);
		}, 0);
		const interval = setInterval(() => {
			void fetchData(targetRange);
		}, 40_000);
		return () => {
			clearTimeout(timer);
			clearInterval(interval);
		};
	}, [fetchData, activeNav, viewTimeRanges]);

	// Load model governance config lazily when the models view is opened
	useEffect(() => {
		if (activeNav === "settings-models") {
			const timer = setTimeout(() => {
				void fetchModelsConfig();
			}, 0);
			return () => clearTimeout(timer);
		}
	}, [activeNav, fetchModelsConfig]);

	// Pure Time Range Calculations with useMemo
	const filteredLogs = useMemo(() => {
		// logs from backend /api/dashboard/logs?range=... is already filtered by SQL
		return logs;
	}, [logs]);

	const llmLogs = useMemo(
		() =>
			filteredLogs.filter(
				(l) =>
					l.path.includes("/v1/chat") || l.path.includes("/v1/completions"),
			),
		[filteredLogs],
	);

	const totalTokens =
		overview?.totalTokens !== undefined
			? overview.totalTokens
			: (agents?.opencode?.tokensInput || 0) +
				(agents?.opencode?.tokensOutput || 0);

	const estCloudCost =
		overview?.totalSpendUsd !== undefined
			? overview.totalSpendUsd.toFixed(2)
			: (agents?.opencode?.totalCost || 0).toFixed(2);

	const totalReqCount =
		overview?.totalRequests !== undefined
			? overview.totalRequests
			: filteredLogs.length;

	const totalCacheRead =
		overview?.tokensCacheRead ??
		llmLogs.reduce((acc, l) => acc + (l.tokensCache ?? 0), 0);

	const totalInputFresh =
		overview?.tokensInputFresh ??
		llmLogs.reduce((acc, l) => {
			const inTok =
				l.tokensInput ??
				(l.latencyMs > 0 ? Math.floor(l.latencyMs * 18 * 0.8) : 500);
			const cacheTok = l.tokensCache ?? 0;
			return acc + Math.max(0, inTok - cacheTok);
		}, 0);

	const promptSum = totalInputFresh + totalCacheRead;
	const cacheHitRate =
		overview?.contextCacheRate !== undefined
			? overview.contextCacheRate
			: promptSum > 0
				? Number(((totalCacheRead / promptSum) * 100).toFixed(1))
				: 0;

	// Dynamic time-series sparklines (prefer backend precomputed buckets for true full-window accuracy)
	const serverSparklines = overview?.sparklines;
	const serverReqSparkline = serverSparklines?.req;
	const serverTokenSparkline = serverSparklines?.tokens;
	const serverCacheReadSparkline = serverSparklines?.cacheRead;
	const serverInputFreshSparkline = serverSparklines?.inputFresh;
	const serverCostSparkline = serverSparklines?.cost;

	const reqSparkline = useMemo(() => {
		if (serverReqSparkline && serverReqSparkline.length > 0) {
			return serverReqSparkline;
		}
		return computeTimeSeriesBuckets(
			filteredLogs,
			(l) => l.ts,
			() => 1,
			10,
		);
	}, [filteredLogs, serverReqSparkline]);

	const tokenSparkline = useMemo(() => {
		if (serverTokenSparkline && serverTokenSparkline.length > 0) {
			return serverTokenSparkline;
		}
		return computeTimeSeriesBuckets(
			llmLogs,
			(l) => l.ts,
			(l) =>
				l.tokensTotal !== undefined
					? l.tokensTotal
					: l.tokensInput !== undefined || l.tokensOutput !== undefined
						? (l.tokensInput ?? 0) + (l.tokensOutput ?? 0)
						: l.latencyMs > 0
							? Math.floor(l.latencyMs * 18)
							: 850,
			10,
		);
	}, [llmLogs, serverTokenSparkline]);

	const cacheReadSparkline = useMemo(() => {
		if (serverCacheReadSparkline && serverCacheReadSparkline.length > 0) {
			return serverCacheReadSparkline;
		}
		return computeTimeSeriesBuckets(
			llmLogs,
			(l) => l.ts,
			(l) => l.tokensCache ?? 0,
			10,
		);
	}, [llmLogs, serverCacheReadSparkline]);

	const inputFreshSparkline = useMemo(() => {
		if (serverInputFreshSparkline && serverInputFreshSparkline.length > 0) {
			return serverInputFreshSparkline;
		}
		return computeTimeSeriesBuckets(
			llmLogs,
			(l) => l.ts,
			(l) =>
				l.tokensInput ??
				(l.latencyMs > 0 ? Math.floor(l.latencyMs * 18 * 0.8) : 500),
			10,
		);
	}, [llmLogs, serverInputFreshSparkline]);

	const costSparkline = useMemo(() => {
		if (serverCostSparkline && serverCostSparkline.length > 0) {
			return serverCostSparkline;
		}
		return computeTimeSeriesBuckets(
			llmLogs,
			(l) => l.ts,
			(l) => {
				const tokens =
					l.tokensTotal !== undefined
						? l.tokensTotal
						: l.tokensInput !== undefined || l.tokensOutput !== undefined
							? (l.tokensInput ?? 0) + (l.tokensOutput ?? 0)
							: l.latencyMs > 0
								? Math.floor(l.latencyMs * 18)
								: 850;
				return (tokens / 1_000_000) * 1.8;
			},
			10,
		);
	}, [llmLogs, serverCostSparkline]);

	const restartGateway = async () => {
		if (!confirm("Restart NexusRoute Gateway now?")) return;
		try {
			await fetch("/api/dashboard/control/gateway", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action: "restart" }),
			});
			alert("Restart signal sent. The page will reload automatically.");
			setTimeout(() => window.location.reload(), 2000);
		} catch {
			alert("Failed to send restart signal.");
		}
	};

	return (
		<div className="h-[100dvh] w-screen overflow-hidden bg-[#0a0a0a] text-[#E2E8F0] font-sans antialiased selection:bg-[#6799fe]/30 selection:text-white flex relative">
			{/* Atmospheric Ambient Lighting (DeepSeek / vibedesign static radial glows) */}
			<div className="pointer-events-none fixed inset-0 overflow-hidden z-0 select-none opacity-70">
				<div className="absolute -top-32 left-1/4 w-[600px] h-[350px] rounded-full bg-[#1A3870]/25 blur-[120px]" />
				<div className="absolute top-1/2 -right-24 w-[480px] h-[360px] rounded-full bg-[#2D5F9E]/15 blur-[130px]" />
				<div className="absolute -bottom-24 left-10 w-[450px] h-[250px] rounded-full bg-[#00EA88]/[0.03] blur-[110px]" />
			</div>

			{mobileMenuOpen && (
				<div
					onClick={() => setMobileMenuOpen(false)}
					className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 transition-opacity duration-200 md:hidden"
				/>
			)}

			<Sidebar
				activeNav={activeNav}
				setActiveNav={setActiveNav}
				mobileMenuOpen={mobileMenuOpen}
				setMobileMenuOpen={setMobileMenuOpen}
				sidebarOverviewOpen={sidebarOverviewOpen}
				setSidebarOverviewOpen={setSidebarOverviewOpen}
				sidebarSettingsOpen={sidebarSettingsOpen}
				setSidebarSettingsOpen={setSidebarSettingsOpen}
				collapsed={sidebarCollapsed}
			/>

			<div
				className={`relative z-10 min-w-0 flex-1 h-full flex flex-col overflow-hidden transition-[padding] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] box-border ${
					sidebarCollapsed ? "md:pl-16" : "md:pl-64"
				}`}
			>
				<TopHeader
					activeNav={activeNav}
					setMobileMenuOpen={setMobileMenuOpen}
					sidebarCollapsed={sidebarCollapsed}
					setSidebarCollapsed={setSidebarCollapsed}
					fetchData={() => void fetchData(activeTimeRange)}
					loading={loading}
					isOnline={isOnline}
				/>

				<div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
					<main className="p-4 sm:p-8 pb-20 sm:pb-16 space-y-6 max-w-5xl w-full mx-auto">
						<div
							className={
								activeNav === "overview-dashboard"
									? "animate-page-enter"
									: "hidden"
							}
						>
							<DashboardView
								overview={overview}
								timeRange={viewTimeRanges["overview-dashboard"] || "all"}
								setTimeRange={(r) =>
									handleViewTimeRangeChange("overview-dashboard", r)
								}
								usdIdrRate={usdIdrRate}
								activity={overview?.activity}
								estCloudCost={estCloudCost}
								totalReqCount={totalReqCount}
								totalTokens={totalTokens}
								cacheHitRate={cacheHitRate}
								totalCacheRead={totalCacheRead}
								totalInputFresh={totalInputFresh}
								costSparkline={costSparkline}
								reqSparkline={reqSparkline}
								tokenSparkline={tokenSparkline}
								cacheSparkline={cacheReadSparkline}
								cacheReadSparkline={cacheReadSparkline}
								inputFreshSparkline={inputFreshSparkline}
								onNavigateLeaderboard={() => setActiveNav("overview-leaderboard")}
							/>
						</div>

						<div
							className={
								activeNav === "overview-leaderboard"
									? "animate-page-enter"
									: "hidden"
							}
						>
							<LeaderboardView
								overview={overview}
								timeRange={viewTimeRanges["overview-leaderboard"] || "all"}
								setTimeRange={(r) =>
									handleViewTimeRangeChange("overview-leaderboard", r)
								}
								activity={overview?.activity}
							/>
						</div>

						<div
							className={
								activeNav === "overview-agents"
									? "animate-page-enter"
									: "hidden"
							}
						>
							<AgentsView
								agents={agents}
								timeRange={viewTimeRanges["overview-agents"] || "all"}
								setTimeRange={(r) =>
									handleViewTimeRangeChange("overview-agents", r)
								}
								lastRefreshed={lastRefreshed}
							/>
						</div>

						<div
							className={activeNav === "ping" ? "animate-page-enter" : "hidden"}
						>
							<PingView />
						</div>

						<div
							className={
								activeNav === "quota" ? "animate-page-enter" : "hidden"
							}
						>
							<QuotaView quota={quota} />
						</div>

						<div
							className={activeNav === "logs" ? "animate-page-enter" : "hidden"}
						>
							<LiveLogsView logs={logs} />
						</div>

						<div
							className={
								activeNav === "settings-gateway"
									? "animate-page-enter"
									: "hidden"
							}
						>
							<GatewayControlView
								restartGateway={restartGateway}
								usdIdrRate={usdIdrRate}
								setUsdIdrRate={setUsdIdrRate}
								isOnline={isOnline}
							/>
						</div>

						<div
							className={
								activeNav === "settings-models"
									? "animate-page-enter"
									: "hidden"
							}
						>
							<ModelsControlView
								modelsConfig={modelsConfig}
								modelsCatalogs={modelsCatalogs}
								refreshModelsConfig={fetchModelsConfig}
							/>
						</div>

						<div
							className={
								activeNav === "settings-combo" ? "animate-page-enter" : "hidden"
							}
						>
							<div className="p-4 rounded-xl border border-white/[0.08] bg-white/[0.06] bevel-inset text-sm text-[#8A94A6]">
								Go to Model Governance to configure model combo routing
								cascade.
							</div>
						</div>
					</main>
				</div>
			</div>
		</div>
	);
}
