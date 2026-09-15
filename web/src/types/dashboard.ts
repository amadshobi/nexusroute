export interface ActivityBucket {
	timestamp: number;
	requests: number;
	cacheHits: number;
	tokensInputFresh: number;
	tokensCacheRead: number;
	tokensOutput: number;
	tokensTotal: number;
	costUsd: number;
	providers: Record<string, { requests: number; tokens: number; costUsd: number }>;
	models: Record<string, { requests: number; tokens: number; costUsd: number }>;
}

export interface OverviewData {
	status: string;
	version: string;
	uptimeSeconds: number;
	totalRequests: number;
	totalTokens?: number;
	totalSpendUsd?: number;
	grossCostUsd?: number;
	localSpendUsd?: number;
	savingsUsd?: number;
	timeRange?: string;
	tokensCacheRead?: number;
	tokensInputFresh?: number;
	contextCacheRate?: number;
	tokens?: {
		total: number;
		inputFresh: number;
		cacheRead: number;
		output: number;
		contextCacheRate: number;
	};
	cache: {
		enabled: boolean;
		entries: number;
		hits: number;
		misses: number;
	};
	upstreams: Array<{
		name: string;
		url: string;
		host?: string;
		port?: number;
		basePath?: string;
	}>;
	stats?: {
		fallbacksTriggered: number;
		activeStreams: number;
		errorsCount: number;
		mode: string;
	};
	sparklines?: {
		cost: number[];
		req: number[];
		tokens: number[];
		cacheRead: number[];
		inputFresh: number[];
	};
	activity?: ActivityBucket[];
	leaderboard?: {
		models: ModelLeaderboardItem[];
		providers: ProviderLeaderboardItem[];
		clients: ClientLeaderboardItem[];
	};
}

export interface ModelLeaderboardItem {
	model: string;
	requests: number;
	tokensTotal: number;
	tokensInput: number;
	tokensOutput: number;
	tokensCache: number;
	costUsd: number;
	avgLatencyMs: number;
	cacheRate: number;
	sparkline?: number[];
}

export interface ProviderLeaderboardItem {
	provider: string;
	upstream: string;
	requests: number;
	tokensTotal: number;
	costUsd: number;
	avgLatencyMs: number;
	sparkline?: number[];
}

export interface ClientLeaderboardItem {
	client: string;
	requests: number;
	tokensTotal: number;
	costUsd: number;
}

export interface QuotaBucket {
	bucketId: string;
	displayName: string;
	window: string;
	remainingFraction: number;
	resetTime?: string;
	description?: string;
}

export interface QuotaGroup {
	groupName: string;
	displayName: string;
	description?: string;
	buckets: QuotaBucket[];
}

export interface AccountQuota {
	email: string;
	projectId?: string;
	provider: string;
	status: "ok" | "warning" | "critical" | "error";
	error?: string;
	groups: QuotaGroup[];
}

export interface ProviderQuotaResult {
	provider: string;
	displayName: string;
	icon?: string;
	accounts: AccountQuota[];
	updatedAt: number;
}

export interface QuotaResponse {
	available: boolean;
	providers?: ProviderQuotaResult[];
	entries?: QuotaEntry[];
}

export interface QuotaEntry {
	provider: string;
	email: string;
	label: string;
	windowLabel: string;
	usedFraction: number;
	status: string;
	resetsAt: number;
}

export interface LogEntry {
	ts: number;
	method: string;
	path: string;
	initialModel: string;
	servedModel: string;
	status: number;
	latencyMs: number;
	cache: "HIT" | "MISS" | "BYPASS" | "NONE";
	stream: boolean;
	tokensInput?: number;
	tokensOutput?: number;
	tokensCache?: number;
	tokensTotal?: number;
	shieldRedacted?: number;
	upstream?: string;
	provider?: string;
	client?: string;
	error?: string;
}

export interface OpenCodeSession {
	id: string;
	parent_id?: string | null;
	title: string;
	time_created: number;
	time_updated: number;
	model: string;
	agent?: string;
	cost: number;
	tokens_input?: number;
	tokens_output?: number;
	tokens_reasoning?: number;
	tokens_cache_read?: number;
	tokens_cache_write?: number;
	directory?: string;
	project_id?: string;
	project_path?: string;
	project_name?: string | null;
}

export interface HermesSession {
	id: string;
	title: string;
	started_at: number;
	last_activity_at: number;
	model: string;
	actual_cost_usd: number | null;
}

export interface AgentsData {
	opencode?: {
		available: boolean;
		sessionsCount: number;
		messagesCount: number;
		tokensInput: number;
		tokensOutput: number;
		totalCost: number;
		recentSessions: OpenCodeSession[];
	};
	hermes?: {
		available: boolean;
		sessionsCount: number;
		messagesCount: number;
		tokensInput: number;
		tokensOutput: number;
		totalCost: number;
		recentSessions: HermesSession[];
	};
}

/** @deprecated Use ModelFallback instead */
export type ModelCombo = ModelFallback;

export interface ModelFallback {
	name: string;
	primary: string;
	fallback: string;
}

/** Per-upstream whitelist config from backend */
export interface ModelWhitelistConfig {
	[upstreamName: string]: string[];
}

/** Full model filter config from backend */
export interface ModelFilterConfig {
	whitelist: ModelWhitelistConfig;
	blacklist: string[];
}

/** Response from GET /api/dashboard/models/config */
export interface ModelsConfigResponse {
	modelFilter: ModelFilterConfig;
	fallback?: {
		enabled: boolean;
		fallback_models: Record<string, string | string[]>;
		default_fallback: string | string[];
	};
}

/** Response from GET /api/dashboard/models/catalogs */
export interface ModelsCatalogsResponse {
	catalogs: Record<string, string[]>;
}

/** Aggregated provider card data for the main models view */
export interface ModelProviderCard {
	upstreamName: string;
	displayName: string;
	totalCount: number;
	activeCount: number;
}

export interface PingModelNode {
	id: string;
	displayName: string;
}

export interface PingProviderNode {
	name: string;
	displayName: string;
	models: PingModelNode[];
}

export interface PingGatewayNode {
	name: string;
	displayName: string;
	host: string;
	port: number;
	basePath: string;
	providers: PingProviderNode[];
}

export interface PingTreeResponse {
	gateways: PingGatewayNode[];
}

export interface PingProbeRequest {
	type: "gateway" | "provider" | "model";
	gateway: string;
	provider?: string;
	modelId?: string;
}

export interface PingProbeResponse {
	status: "OK" | "FAIL" | "RATELIMIT" | "TIMEOUT";
	statusCode: number;
	latencyMs: number;
	target: string;
	detail?: string;
}
