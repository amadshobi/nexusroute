#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// Goblin Nexus — Shared Types & Interfaces
// Single source of truth untuk semua interface yang dipakai
// oleh commands/, adapters/, dan utils/.
//
// INVARIAN (architect spec section 5.1):
//   1. TIDAK ADA logika di file ini. Hanya type declarations.
//   2. Tidak ada import runtime — murni type-only file.
//   3. Setiap adapter WAJIB mengimplementasikan interface
//      yang didefinisikan di sini agar swappable.
// ─────────────────────────────────────────────────────────────

// ─── Quota / Provider Usage ──────────────────────────────────

/**
 * Status level untuk quota, health check, dan doctor.
 * - "ok":       normal, tidak perlu perhatian
 * - "warn":     perlu perhatian tapi belum kritis
 * - "error":    gagal, perlu intervensi
 * - "critical": mendekati limit, blocking
 */
export type QuotaStatus = "ok" | "warn" | "error" | "critical";

/**
 * Identifier provider AI yang dikenali gn.
 * Pakai string union dengan escape hatch `(string & {})` agar:
 *   - IDE autocomplete menampilkan provider yang dikenal
 *   - Provider baru TIDAK menyebabkan TS error (extensible)
 */
export type QuotaProvider =
	| "google-antigravity"
	| "openai-codex"
	| "anthropic-claude"
	| "github-copilot"
	| "ollama-cloud"
	| (string & {});

/**
 * Snapshot terkini penggunaan kuota dari satu provider + akun.
 * Dikembalikan oleh IQuotaAdapter.getQuotas().
 *
 * Shape adalah mirror yang dinormalisasi dari tabel `usage_history`
 * di ~/.omp/agent/agent.db — adapter harus projection ke shape
 * ini agar command layer tidak peduli schema source.
 */
export interface QuotaEntry {
	/** ID provider, misal "google-antigravity" | "openai-codex" */
	provider: string;
	/** Email akun jika tersedia dari broker */
	email?: string;
	/** Label quota, misal "Usage (Google)" | "30 days" */
	label: string;
	/** Window label, misal "Daily" | "30 days" */
	windowLabel?: string;
	/** Fraksi terpakai 0.0 – 1.0 (dari used_fraction di agent.db) */
	usedFraction: number;
	/** Status level (sudah dihitung adapter berdasarkan threshold) */
	status: QuotaStatus | string;
	/** Unix timestamp ms kapan quota reset */
	resetsAt?: number;
}

// ─── Session / OpenCode Telemetry ────────────────────────────

/**
 * Representasi satu sesi OpenCode.
 * Mirror kolom dari tabel `session` di opencode.db
 * (id, title, model_id, cost, tokens_*, dll).
 */
export interface OpenCodeSession {
	id: string;
	title: string;
	/** Model id lengkap dengan provider prefix, misal "google-antigravity/claude-sonnet-4-6" */
	modelId: string;
	/** Total biaya sesi dalam USD */
	cost: number;
	tokensInput: number;
	tokensOutput: number;
	tokensReasoning: number;
	tokensCacheRead: number;
	tokensCacheWrite: number;
	/** Unix ms; di-best-effort dari event/session.time_updated */
	timeCreated: number;
}

/**
 * Detail lengkap satu sesi (extension dari OpenCodeSession).
 * Dipakai oleh `gn sessions` saat user ingin breakdown
 * per-sesi termasuk metadata tambahan.
 */
export interface SessionDetail extends OpenCodeSession {
	/** Jumlah sub-session jika sesi ini punya parent */
	childCount?: number;
	/** Durasi total sesi dalam ms (jika tersedia) */
	durationMs?: number;
	/** Project directory sesi (jika ada) */
	directory?: string;
	/** Parent session id (jika ini adalah sub-session) */
	parentId?: string;
	/** Per-tool call count breakdown, misal {bash: 5, edit: 3, todowrite: 2} */
	toolCount?: Record<string, number>;
	/** Unique file paths yang di-edit/ditulis selama session */
	modifiedFiles?: string[];
	/** Aggregate todo status count */
	todoProgress?: TodoProgress;
}

/**
 * Ringkasan agregat penggunaan per model untuk window waktu tertentu.
 * Dipakai oleh `gn stats --models`.
 */
export interface ModelUsageSummary {
	/** Combined identifier, misal "google-antigravity/claude-sonnet-4-6" */
	modelId: string;
	/** Provider only, misal "google-antigravity" (opsional — untuk filter/breakdown) */
	provider?: string;
	/** Variant (opsional, misal "default" atau null untuk default) */
	variant?: string | null;
	totalCost: number;
	totalTokensInput: number;
	totalTokensOutput: number;
	/** Total token (input + output, tidak termasuk cache) */
	totalTokens: number;
	sessionCount: number;
}

/**
 * Progress agregat todo untuk satu sesi.
 * Status di-aggregate dari tabel `todo` opencode.db.
 */
export interface TodoProgress {
	total: number;
	pending: number;
	inProgress: number;
	completed: number;
	cancelled: number;
}

/**
 * Ringkasan statistik untuk window waktu tertentu.
 * Dikembalikan oleh ISessionAdapter.getStatsSummary().
 */
export interface StatsSummary {
	/** Label window: "Today" | "7 days" | "30 days" */
	periodLabel: string;
	/** Total biaya dalam USD untuk window ini */
	totalCost: number;
	/** Total input tokens */
	totalTokensInput: number;
	/** Total output tokens */
	totalTokensOutput: number;
	/** Breakdown per model */
	perModel: ModelUsageSummary[];
}

// ─── Health Check (Doctor) ───────────────────────────────────

/**
 * Satu hasil health check untuk `gn doctor`.
 * Urutan check di doctor.ts menentukan urutan tampil.
 */
export interface DoctorCheckResult {
	/** Nama check, misal "omp-broker" | "omp-gateway" | "agent.db" */
	name: string;
	/** Status hasil check */
	status: "ok" | "warn" | "error";
	/** Pesan deskriptif hasil check */
	detail: string;
	/** Goblin Roast Hint jika status error/warn */
	hint?: string;
}

// ─── Ollama Account (Live Stream) ────────────────────────────

/**
 * Metadata akun Ollama Cloud yang di-fetch dari ollama.com.
 *
 * CATATAN: Definisi CANONICAL interface ini ada di sini.
 * File src/ollama-me.ts juga mendeklarasikan interface ini
 * secara lokal — itu adalah INTENTIONAL duplikat untuk
 * memenuhi architect invariant #2 ("ollama-me.ts preserved 100%").
 * TypeScript structural typing memastikan keduanya interchangeable
 * saat dipakai di commands/ollama.ts.
 */
export interface OllamaAccountMeta {
	email: string;
	plan: string;
	id: string;
	suspended: boolean;
	sessionUsagePct: number;
	weeklyUsagePct: number;
	sessionResetsAt?: string;
	hasCookie: boolean;
}

// ─── Native OMP Stats Summary ─────────────────────────────────

/**
 * Ringkasan agregat per provider+model dari tabel `messages`
 * di ~/.omp/stats.db. Dipakai oleh adapter omp-native sebagai
 * fallback ketika opencode adapter kosong.
 *
 * Berbeda dari ModelUsageSummary: schema OMP native sudah
 * pre-aggregated per request dan menyimpan cache tokens
 * secara eksplisit.
 */
export interface OmpNativeMessageSummary {
	provider: string;
	model: string;
	totalRequests: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	totalCacheWriteTokens: number;
	totalCost: number;
}

// ─── Adapter Contracts (architect spec section 5.2) ──────────
//
// CATATAN: Interface IDataAdapter, IQuotaAdapter, ISessionAdapter
// dipindah ke src/adapters/base.ts (Step 2) sesuai architect
// section 5.2. Tipe domain (QuotaEntry, OpenCodeSession, dll)
// tetap di sini.
//
// Adapter contracts dipisah dari tipe domain karena:
//   - contracts = "cara plug-in ke data source layer"
//   - domain types = "shape data yang dipertukarkan"
// Memisahkan keduanya menjaga dependency graph tetap flat
// (commands → types, commands → adapters/<impl>, tapi tidak
//  commands → adapters/base → types).

// ─── OpenCode Config Standard (Milestone 1) ───────────────────

export interface AgentPermission {
	name: string;
	allow: boolean;
	patterns?: string[];
	warning_only?: boolean;
}

export interface AgentConfigItem {
	id: string;
	name: string;
	persona?: string;
	model: string;
	max_tokens?: number;
	temperature?: number;
	permissions?: AgentPermission[];
	tools?: string[];
	system_instructions?: string;
}

export interface MCPServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	disabled?: boolean;
}

export interface CompactionConfig {
	// Optional karena berasal dari parse config eksternal (opencode.jsonc)
	enabled?: boolean;
	trigger_token_count?: number;
	keep_percent?: number;
}

export interface AIModel {
	id: string;
	name: string;
	provider: string;
	input_price_per_m?: number;
	output_price_per_m?: number;
	context_window?: number;
}

export interface ModelCategory {
	default: string;
	fast?: string;
	reasoning?: string;
}

export interface OpenCodeConfig {
	version: string;
	models?: AIModel[];
	model_categories?: ModelCategory;
	agents?: AgentConfigItem[];
	mcp_servers?: Record<string, MCPServerConfig>;
	compaction?: CompactionConfig;
	features?: Record<string, any>;
	[key: string]: any;
}
