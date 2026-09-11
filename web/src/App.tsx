import { useState, useEffect, useCallback, useMemo } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { TopHeader } from "./components/layout/TopHeader";
import { DashboardView } from "./components/views/DashboardView";
import { OpenCodeView } from "./components/views/OpenCodeView";
import { HermesView } from "./components/views/HermesView";
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

const VALID_NAVS = new Set([
	"overview-dashboard",
	"overview-opencode",
	"overview-hermes",
	"ping",
	"quota",
	"logs",
	"settings-gateway",
	"settings-models",
	"settings-combo",
]);

function getInitialNav(): string {
	if (typeof window !== "undefined") {
		const hash = window.location.hash.replace(/^#\/?/, "");
		if (hash && VALID_NAVS.has(hash)) {
			return hash;
		}
		const saved = localStorage.getItem("gn_active_nav");
		if (saved && VALID_NAVS.has(saved)) {
			return saved;
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

	// In-session view snapshots: each view preserves its chosen time range during navigation & reload
	const [viewTimeRanges, setViewTimeRanges] = useState<Record<string, string>>(
		() => {
			if (typeof window !== "undefined") {
				try {
					const saved = localStorage.getItem("gn_view_time_ranges");
					if (saved) return JSON.parse(saved);
				} catch {
					// fallback
				}
			}
			return {
				"overview-dashboard": "all",
				"overview-opencode": "all",
				"overview-hermes": "all",
			};
		},
	);

	const activeTimeRange = viewTimeRanges[activeNav] || "all";

	const setActiveNav = useCallback((nav: string) => {
		setActiveNavState(nav);
		if (typeof window !== "undefined") {
			try {
				localStorage.setItem("gn_active_nav", nav);
				if (window.location.hash !== `#${nav}`) {
					window.history.replaceState(null, "", `#${nav}`);
				}
			} catch {
				// localstorage quota/disabled
			}
		}
	}, []);

	// Listen to browser Back/Forward buttons
	useEffect(() => {
		const handleHashChange = () => {
			const hash = window.location.hash.replace(/^#\/?/, "");
			if (hash && VALID_NAVS.has(hash)) {
				setActiveNavState(hash);
			}
		};
		window.addEventListener("hashchange", handleHashChange);
		return () => window.removeEventListener("hashchange", handleHashChange);
	}, []);

	// Remote Data State & Connectivity
	const [usdIdrRate, setUsdIdrRateState] = useState<number>(() => {
		if (typeof window !== "undefined") {
			try {
				const saved = localStorage.getItem("gn_usd_idr_rate");
				if (saved) {
					const parsed = Number(saved);
					if (parsed > 0) return parsed;
				}
			} catch {
				// fallback
			}
		}
		return 17000;
	});

	const setUsdIdrRate = useCallback((rate: number) => {
		setUsdIdrRateState(rate);
		if (typeof window !== "undefined") {
			try {
				localStorage.setItem("gn_usd_idr_rate", rate.toString());
			} catch {
				// fallback
			}
		}
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
			if (typeof window !== "undefined") {
				try {
					localStorage.setItem("gn_view_time_ranges", JSON.stringify(next));
				} catch {
					// fallback
				}
			}
			return next;
		});
		void fetchData(newRange);
	};

	useEffect(() => {
		const targetRange = viewTimeRanges[activeNav] || "all";
		const timer = setTimeout(() => {
			void fetchData(targetRange);
		}, 0);
		const interval = setInterval(() => {
			void fetchData(targetRange);
		}, 3000);
		return () => {
			clearTimeout(timer);
			clearInterval(interval);
		};
	}, [fetchData, activeNav, viewTimeRanges]);

	// Load model governance config lazily when the models view is opened
	useEffect(() => {
		if (activeNav === "settings-models") {
			void fetchModelsConfig();
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
			return acc + inTok;
		}, 0);

	const promptSum = totalInputFresh + totalCacheRead;
	const cacheHitRate =
		overview?.contextCacheRate !== undefined
			? overview.contextCacheRate
			: promptSum > 0
				? Number(((totalCacheRead / promptSum) * 100).toFixed(1))
				: 0;

	// Dynamic time-series sparklines (prefer backend precomputed buckets for true full-window accuracy)
	const reqSparkline = useMemo(() => {
		if (overview?.sparklines?.req && overview.sparklines.req.length > 0) {
			return overview.sparklines.req;
		}
		return computeTimeSeriesBuckets(
			filteredLogs,
			(l) => l.ts,
			() => 1,
			10,
		);
	}, [filteredLogs, overview?.sparklines?.req]);

	const tokenSparkline = useMemo(() => {
		if (overview?.sparklines?.tokens && overview.sparklines.tokens.length > 0) {
			return overview.sparklines.tokens;
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
	}, [llmLogs, overview?.sparklines?.tokens]);

	const cacheReadSparkline = useMemo(() => {
		if (
			overview?.sparklines?.cacheRead &&
			overview.sparklines.cacheRead.length > 0
		) {
			return overview.sparklines.cacheRead;
		}
		return computeTimeSeriesBuckets(
			llmLogs,
			(l) => l.ts,
			(l) => l.tokensCache ?? 0,
			10,
		);
	}, [llmLogs, overview?.sparklines?.cacheRead]);

	const inputFreshSparkline = useMemo(() => {
		if (
			overview?.sparklines?.inputFresh &&
			overview.sparklines.inputFresh.length > 0
		) {
			return overview.sparklines.inputFresh;
		}
		return computeTimeSeriesBuckets(
			llmLogs,
			(l) => l.ts,
			(l) =>
				l.tokensInput ??
				(l.latencyMs > 0 ? Math.floor(l.latencyMs * 18 * 0.8) : 500),
			10,
		);
	}, [llmLogs, overview?.sparklines?.inputFresh]);

	const costSparkline = useMemo(() => {
		if (overview?.sparklines?.cost && overview.sparklines.cost.length > 0) {
			return overview.sparklines.cost;
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
	}, [llmLogs, overview?.sparklines?.cost]);

	const restartGateway = async () => {
		if (!confirm("Restart Goblin Nexus Gateway sekarang?")) return;
		try {
			await fetch("/api/dashboard/control/gateway", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action: "restart" }),
			});
			alert("Sinyal restart dikirim. Halaman akan reload otomatis.");
			setTimeout(() => window.location.reload(), 2000);
		} catch {
			alert("Gagal kirim sinyal restart");
		}
	};

	return (
		<div className="min-h-screen bg-[#0E1117] text-[#E2E8F0] font-sans antialiased selection:bg-[#1D68FE] selection:text-white relative overflow-x-hidden">
			{mobileMenuOpen && (
				<div
					onClick={() => setMobileMenuOpen(false)}
					className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 transition-opacity duration-200 md:hidden"
				/>
			)}

			<div className="flex min-h-screen">
				<Sidebar
					activeNav={activeNav}
					setActiveNav={setActiveNav}
					mobileMenuOpen={mobileMenuOpen}
					setMobileMenuOpen={setMobileMenuOpen}
					sidebarOverviewOpen={sidebarOverviewOpen}
					setSidebarOverviewOpen={setSidebarOverviewOpen}
					sidebarSettingsOpen={sidebarSettingsOpen}
					setSidebarSettingsOpen={setSidebarSettingsOpen}
				/>

				<div className="flex-1 flex flex-col min-w-0 w-full">
					<TopHeader
						activeNav={activeNav}
						setMobileMenuOpen={setMobileMenuOpen}
						fetchData={() => void fetchData(activeTimeRange)}
						loading={loading}
						isOnline={isOnline}
					/>

					<main className="p-4 sm:p-8 space-y-6 max-w-5xl w-full mx-auto">
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
							/>
						</div>

						<div
							className={
								activeNav === "overview-opencode"
									? "animate-page-enter"
									: "hidden"
							}
						>
							<OpenCodeView
								agents={agents}
								timeRange={viewTimeRanges["overview-opencode"] || "all"}
								setTimeRange={(r) =>
									handleViewTimeRangeChange("overview-opencode", r)
								}
								lastRefreshed={lastRefreshed}
							/>
						</div>

						<div
							className={
								activeNav === "overview-hermes"
									? "animate-page-enter"
									: "hidden"
							}
						>
							<HermesView
								agents={agents}
								timeRange={viewTimeRanges["overview-hermes"] || "all"}
								setTimeRange={(r) =>
									handleViewTimeRangeChange("overview-hermes", r)
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
							<div className="p-4 rounded-xl border border-[#1E2433] bg-[#131722] text-sm text-[#8A94A6]">
								Pindah ke Model Governance untuk mengatur rute combo model
								cascade.
							</div>
						</div>
					</main>
				</div>
			</div>
		</div>
	);
}
