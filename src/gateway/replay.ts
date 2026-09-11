/**
 * ─────────────────────────────────────────────────────────────
 * Goblin Nexus — Gateway Fixture Recording & Mock Replay Engine
 * ─────────────────────────────────────────────────────────────
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { computePromptHash, formatCachedStreamChunks } from "./cache";

export const DEFAULT_FIXTURES_DIR = join(
	homedir(),
	".config",
	"gn",
	"fixtures",
);

export interface FixtureRecord {
	id: string;
	timestamp: number;
	hash: string;
	request: {
		url: string;
		method: string;
		model?: string;
		body: any;
	};
	response: {
		status: number;
		headers: Record<string, string>;
		isStream: boolean;
		chunks?: string[];
		body?: string;
	};
}

export class FixtureManager {
	private fixturesDir: string;

	constructor(fixturesDir: string = DEFAULT_FIXTURES_DIR) {
		this.fixturesDir = fixturesDir;
		this.ensureDir();
	}

	private ensureDir(): void {
		if (!existsSync(this.fixturesDir)) {
			mkdirSync(this.fixturesDir, { recursive: true, mode: 0o700 });
		}
	}

	/**
	 * Save request-response interaction to a JSONL fixture file.
	 */
	public record(
		fileName: string,
		req: { url: string; method: string; model?: string; body: any },
		resp: {
			status: number;
			headers: Record<string, string>;
			isStream: boolean;
			chunks?: string[];
			body?: string;
		},
	): void {
		try {
			this.ensureDir();
			const targetFile = fileName.endsWith(".jsonl")
				? fileName
				: `${fileName}.jsonl`;
			const fullPath = join(this.fixturesDir, targetFile);

			const hash = computePromptHash(req.body);
			const record: FixtureRecord = {
				id: `fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				timestamp: Date.now(),
				hash,
				request: req,
				response: resp,
			};

			const line = JSON.stringify(record) + "\n";
			appendFileSync(fullPath, line, { mode: 0o600 });
		} catch (err) {
			process.stderr.write(
				`⚠️  [GN Gateway Replay] Failed to record fixture: ${(err as Error).message}\n`,
			);
		}
	}

	/**
	 * Find and mock response from fixture file for given incoming request body.
	 */
	public mock(fileName: string, reqBody: any): Response | null {
		try {
			const targetFile = fileName.endsWith(".jsonl")
				? fileName
				: `${fileName}.jsonl`;
			const fullPath = join(this.fixturesDir, targetFile);

			if (!existsSync(fullPath)) {
				return null;
			}

			const content = readFileSync(fullPath, "utf-8");
			const lines = content.split("\n").filter((l) => l.trim().length > 0);
			const hash = computePromptHash(reqBody);

			let matchedRecord: FixtureRecord | null = null;

			// Find exact hash match first
			for (const line of lines) {
				try {
					const rec = JSON.parse(line) as FixtureRecord;
					if (rec.hash === hash) {
						matchedRecord = rec;
						break;
					}
				} catch {
					// Ignore corrupt line
				}
			}

			// If no exact match, fallback to first recorded interaction in file
			if (!matchedRecord && lines.length > 0) {
				try {
					matchedRecord = JSON.parse(lines[0]) as FixtureRecord;
				} catch {
					matchedRecord = null;
				}
			}

			if (!matchedRecord) return null;

			const { response } = matchedRecord;
			const respHeaders = new Headers(response.headers || {});
			respHeaders.set("X-GN-Mocked", "true");
			respHeaders.set("X-GN-Fixture-File", targetFile);

			if (response.isStream && response.chunks && response.chunks.length > 0) {
				respHeaders.set("content-type", "text/event-stream; charset=utf-8");
				respHeaders.set("cache-control", "no-cache");
				respHeaders.set("connection", "keep-alive");
				respHeaders.set("x-accel-buffering", "no");

				const stream = formatCachedStreamChunks(response.chunks);
				return new Response(stream, {
					status: response.status || 200,
					headers: respHeaders,
				});
			}

			return new Response(response.body || "", {
				status: response.status || 200,
				headers: respHeaders,
			});
		} catch (err) {
			process.stderr.write(
				`⚠️  [GN Gateway Replay] Mock failed: ${(err as Error).message}\n`,
			);
			return null;
		}
	}
}
