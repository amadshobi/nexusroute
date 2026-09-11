/**
 * ─────────────────────────────────────────────────────────────
 * Goblin Nexus — Gateway Deterministic Prompt Caching Engine
 * ─────────────────────────────────────────────────────────────
 */

import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CacheEntryMetadata } from "./types";

const DEFAULT_CACHE_DIR = join(homedir(), ".cache", "gn", "gateway", "cache");
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Single-flight in-flight map
const inFlightRequests = new Map<string, Promise<void>>();

export interface CacheKeyInput {
	model?: string;
	messages?: any[];
	temperature?: number;
	top_p?: number;
	system_prompt?: string;
	seed?: number;
	tools?: any[];
}

/**
 * Compute deterministic SHA-256 hash for LLM request body.
 */
export function computePromptHash(bodyObj: any): string {
	if (!bodyObj || typeof bodyObj !== "object") {
		return createHash("sha256")
			.update(String(bodyObj || ""))
			.digest("hex");
	}

	// Canonical tuple structure
	// v2: menyertakan sampling/output params agar request yang hanya beda
	// di max_tokens/stop/response_format tidak salah dilayani respons cache lama
	const canonical = {
		v: 2,
		model: bodyObj.model ?? "",
		messages: bodyObj.messages ?? [],
		temperature: bodyObj.temperature ?? null,
		top_p: bodyObj.top_p ?? null,
		system_prompt: bodyObj.system ?? bodyObj.system_prompt ?? null,
		seed: bodyObj.seed ?? null,
		tools: bodyObj.tools ?? null,
		max_tokens: bodyObj.max_tokens ?? bodyObj.maxOutputTokens ?? null,
		stop: bodyObj.stop ?? bodyObj.stop_sequences ?? null,
		response_format: bodyObj.response_format ?? null,
		presence_penalty: bodyObj.presence_penalty ?? null,
		frequency_penalty: bodyObj.frequency_penalty ?? null,
		n: bodyObj.n ?? null,
	};

	const serialized = JSON.stringify(canonical);
	return createHash("sha256").update(serialized).digest("hex");
}

export class PromptCacheManager {
	private cacheDir: string;
	private defaultTtlMs: number;

	constructor(
		cacheDir: string = DEFAULT_CACHE_DIR,
		defaultTtlMs: number = DEFAULT_TTL_MS,
	) {
		this.cacheDir = cacheDir;
		this.defaultTtlMs = defaultTtlMs;
		this.ensureDir();
	}

	private ensureDir(): void {
		if (!existsSync(this.cacheDir)) {
			mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 });
		}
	}

	/**
	 * Get cached response if valid and not expired.
	 */
	public get(hash: string): {
		meta: CacheEntryMetadata;
		chunks: string[];
		isStream: boolean;
		body?: string;
	} | null {
		const metaPath = join(this.cacheDir, `${hash}.meta.json`);
		const dataPath = join(this.cacheDir, `${hash}.data`);

		if (!existsSync(metaPath) || !existsSync(dataPath)) {
			return null;
		}

		try {
			const metaRaw = readFileSync(metaPath, "utf-8");
			const meta = JSON.parse(metaRaw) as CacheEntryMetadata;

			// Check TTL
			if (Date.now() > meta.expiresAt) {
				this.delete(hash);
				return null;
			}

			const dataRaw = readFileSync(dataPath, "utf-8");
			if (meta.isStream) {
				const chunks = dataRaw.split("\n---GN-CHUNK---\n").filter(Boolean);
				return { meta, chunks, isStream: true };
			} else {
				return { meta, chunks: [], isStream: false, body: dataRaw };
			}
		} catch {
			return null;
		}
	}

	/**
	 * Save response to disk atomically with 0600 permissions.
	 */
	public set(
		hash: string,
		meta: Omit<CacheEntryMetadata, "hash" | "createdAt" | "expiresAt">,
		data: string | string[],
		ttlMs: number = this.defaultTtlMs,
	): void {
		try {
			this.ensureDir();
			const now = Date.now();
			const fullMeta: CacheEntryMetadata = {
				...meta,
				hash,
				createdAt: now,
				expiresAt: now + ttlMs,
			};

			const metaPath = join(this.cacheDir, `${hash}.meta.json`);
			const dataPath = join(this.cacheDir, `${hash}.data`);
			const tmpMetaPath = `${metaPath}.${Date.now()}.tmp`;
			const tmpDataPath = `${dataPath}.${Date.now()}.tmp`;

			const dataContent = Array.isArray(data)
				? data.join("\n---GN-CHUNK---\n")
				: data;

			// Atomic write meta
			writeFileSync(tmpMetaPath, JSON.stringify(fullMeta, null, 2), {
				mode: 0o600,
			});
			writeFileSync(tmpDataPath, dataContent, { mode: 0o600 });

			// Move into place
			renameSync(tmpMetaPath, metaPath);
			renameSync(tmpDataPath, dataPath);
		} catch (err) {
			process.stderr.write(
				`⚠️  [GN Gateway Cache] Failed to write cache for ${hash}: ${(err as Error).message}\n`,
			);
		}
	}

	/**
	 * Delete cache entry for given hash.
	 */
	public delete(hash: string): void {
		try {
			const metaPath = join(this.cacheDir, `${hash}.meta.json`);
			const dataPath = join(this.cacheDir, `${hash}.data`);
			if (existsSync(metaPath)) unlinkSync(metaPath);
			if (existsSync(dataPath)) unlinkSync(dataPath);
		} catch {
			// Ignore deletion errors
		}
	}

	/**
	 * Clean expired entries.
	 */
	public prune(): number {
		let pruned = 0;
		try {
			const files = readdirSync(this.cacheDir);
			const now = Date.now();

			for (const file of files) {
				if (file.endsWith(".meta.json")) {
					const hash = file.replace(".meta.json", "");
					const metaPath = join(this.cacheDir, file);
					try {
						const raw = readFileSync(metaPath, "utf-8");
						const meta = JSON.parse(raw) as CacheEntryMetadata;
						if (now > meta.expiresAt) {
							this.delete(hash);
							pruned++;
						}
					} catch {
						this.delete(hash);
						pruned++;
					}
				}
			}
		} catch {
			// Ignore prune errors
		}
		return pruned;
	}

	/**
	 * Hitung jumlah entri cache yang masih valid (belum expired).
	 * Dipakai endpoint dashboard untuk laporan statistik cache.
	 */
	public count(): number {
		let count = 0;
		try {
			const files = readdirSync(this.cacheDir);
			const now = Date.now();
			for (const file of files) {
				if (!file.endsWith(".meta.json")) continue;
				try {
					const raw = readFileSync(join(this.cacheDir, file), "utf-8");
					const meta = JSON.parse(raw) as CacheEntryMetadata;
					if (now <= meta.expiresAt) count++;
				} catch {
					// Abaikan meta yang korup
				}
			}
		} catch {
			// Abaikan error baca direktori
		}
		return count;
	}

	/**
	 * Single-flight execution wrapper.
	 */
	public async singleFlight<T>(hash: string, fn: () => Promise<T>): Promise<T> {
		const existing = inFlightRequests.get(hash);
		if (existing) {
			await existing;
			return await fn();
		}

		let resolvePromise: () => void = () => {};
		const inflightPromise = new Promise<void>((resolve) => {
			resolvePromise = resolve;
		});
		inFlightRequests.set(hash, inflightPromise);

		try {
			const result = await fn();
			return result;
		} finally {
			inFlightRequests.delete(hash);
			resolvePromise();
		}
	}
}

/**
 * Replay chunks with updated UUID and timestamps to satisfy stream consumers.
 */
export function formatCachedStreamChunks(
	chunks: string[],
): ReadableStream<Uint8Array> {
	const newId = `chatcmpl-${crypto.randomUUID()}`;
	const newCreated = Math.floor(Date.now() / 1000);
	const encoder = new TextEncoder();

	return new ReadableStream({
		start(controller) {
			for (const rawChunk of chunks) {
				let chunkText = rawChunk;

				// Transform data: {...} JSON if possible
				if (chunkText.startsWith("data: ") && !chunkText.includes("[DONE]")) {
					try {
						const jsonPart = chunkText.slice(6).trim();
						const parsed = JSON.parse(jsonPart);
						parsed.id = newId;
						parsed.created = newCreated;
						chunkText = `data: ${JSON.stringify(parsed)}\n\n`;
					} catch {
						// Leave unchanged if not parseable JSON
					}
				}

				controller.enqueue(encoder.encode(chunkText));
			}
			controller.close();
		},
	});
}
