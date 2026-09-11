#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────
// Goblin Nexus — Ollama Cloud API & Database Metadata Fetcher
//
// Single source of truth untuk credential: tabel `auth_credentials`
// di ~/.omp/agent/agent.db (provider = 'ollama-cloud', exact match).
//
// ENRICHMENT (live, optional, best-effort):
//   - POST https://ollama.com/api/me       (Bearer auth → email/plan/id)
//   - GET  https://ollama.com/settings     (cookie auth → session/weekly %)
//
// CACHE: ~/.cache/goblin-nexus/ollama-me-cache.json, TTL 15 menit.
//
// ARSITEKTUR (architect section 5.3):
//   - Read-only via helper withDb() / getOmpAgentDb() di utils/db.ts.
//   - File vault ~/.shell/secret/ollama-cloud/*.json sudah di-deprecate:
//     sebelumnya dipakai sebagai fallback tapi menyebabkan duplikat/stale
//     (id-5.json, id-6.json, id-7.json yang mirror row di DB) → sekarang
//     sumbernya tunggal dari SQLite saja.
// ─────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";
import { stderr } from "node:process";

import { withDb, isDatabaseAvailable, getOmpAgentDb } from "./utils/db";
import type { OllamaAccountMeta } from "./types";

// ─── DB Row Type (mirror schema auth_credentials) ────────────

/**
 * Shape baris dari `auth_credentials` agent.db. Field name pakai
 * snake_case; di-mapping ke `OllamaCredential` (internal shape)
 * oleh `parseCredentialData()`.
 */
interface AuthCredentialsRow {
  id: number;
  provider: string;
  credential_type: string;
  /** JSON blob: `{ "key": "...", "source": "login" }` (dan field lain). */
  data: string;
  identity_key: string | null;
  disabled_cause: string | null;
}

// ─── Internal: normalized credential shape ───────────────────

/**
 * Shape ter-normalisasi yang dipakai `fetchOllamaAccountsMeta()`.
 * Properti `email` & `cookie` optional — DB Ollama saat ini tidak
 * menulis keduanya, tapi parser tetap tolerate kalau broker
 * menambahkannya di schema masa depan.
 */
interface OllamaCredential {
  /** API key (dari data.key / data.token / data.apiKey di DB) */
  key: string;
  /** Email jika tertulis di JSON data (saat ini DB tidak menulis ini) */
  email?: string;
  /** Cookie session untuk ollama.com/settings (saat ini DB tidak menulis ini) */
  cookie?: string;
  /** DB id untuk traceability & cache key fallback */
  dbId: number;
}

// ─── Cache ───────────────────────────────────────────────────

const CACHE_FILE = path.join(
  process.env.HOME || "/tmp",
  ".cache", "goblin-nexus", "ollama-me-cache.json"
);
const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheMap {
  timestamp: number;
  data: Record<string, OllamaAccountMeta>;
}

/**
 * Provider key untuk ollama-cloud di auth_credentials.
 * Pakai exact match (bukan LIKE) untuk menghindari false positive
 * kalau broker menambah provider 'ollama-cloud-pro' dll di masa depan.
 */
const OLLAMA_PROVIDER = "ollama-cloud";

// ─── DB Credential Reader ────────────────────────────────────

/**
 * Parse `data` JSON blob dari auth_credentials ke OllamaCredential.
 * Return null kalau data malformed atau tidak ada key/token/apiKey.
 *
 * Field yang dikenali (case-sensitive sesuai konvensi broker OMP):
 *   - data.key            : API key (canonical)
 *   - data.token          : alias untuk key
 *   - data.apiKey         : alias untuk key
 *   - data.email          : optional, jarang ditulis DB
 *   - data.cookie         : optional, cookie session
 *   - data.secure_session : alias untuk cookie
 */
function parseCredentialData(row: AuthCredentialsRow): OllamaCredential | null {
  let parsed: {
    key?: string;
    token?: string;
    apiKey?: string;
    email?: string;
    cookie?: string;
    secure_session?: string;
  };
  try {
    parsed = JSON.parse(row.data);
  } catch {
    return null;
  }
  const key = parsed.key || parsed.token || parsed.apiKey;
  if (!key) return null;
  return {
    dbId: row.id,
    key,
    email: parsed.email,
    cookie: parsed.cookie || parsed.secure_session,
  };
}

/**
 * Ambil semua credential Ollama Cloud dari auth_credentials.
 * Single source of truth — file vault sudah di-deprecate.
 *
 * @returns OllamaCredential[] diurut by dbId ASC (deterministic).
 *          Empty array kalau DB tidak ada / query gagal / tidak ada row.
 */
function getOllamaCredentialsFromDb(): OllamaCredential[] {
  const dbPath = getOmpAgentDb();
  if (!isDatabaseAvailable(dbPath)) {
    return [];
  }
  try {
    return withDb(dbPath, (db) => {
      const rows = db
        .query<AuthCredentialsRow, [string]>(`
          SELECT id, provider, credential_type, data, identity_key, disabled_cause
          FROM auth_credentials
          WHERE provider = ?
          ORDER BY id ASC
        `)
        .all(OLLAMA_PROVIDER);
      const out: OllamaCredential[] = [];
      for (const row of rows) {
        const parsed = parseCredentialData(row);
        if (parsed) out.push(parsed);
      }
      return out;
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`⚠️  ollama-me: gagal query auth_credentials: ${msg}\n`);
    return [];
  }
}

// ─── Cache helpers ───────────────────────────────────────────

function loadCache(): Record<string, OllamaAccountMeta> | null {
  if (!fs.existsSync(CACHE_FILE)) return null;
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const cache: CacheMap = JSON.parse(raw);
    if (Date.now() - cache.timestamp < CACHE_TTL_MS) {
      return cache.data;
    }
  } catch {
    // Corrupt cache atau permission error → anggap cache miss.
  }
  return null;
}

function saveCache(data: Record<string, OllamaAccountMeta>): void {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload: CacheMap = { timestamp: Date.now(), data };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2));
  } catch {
    // Cache write failure: silent — best-effort, fetch tetap jalan.
  }
}

// ─── HTML parser untuk ollama.com/settings ───────────────────

/**
 * Parse HTML dari ollama.com/settings. Dashboard Ollama Cloud
 * menampilkan "Session % used" dan "Weekly % used" dalam card
 * plain HTML (no data-* attribute untuk pct). Regex sederhana
 * cukup — pattern dijamin stabil karena string literal di UI.
 */
function parseSettingsHtml(html: string): {
  sessionPct: number;
  weeklyPct: number;
  sessionReset?: string;
} {
  let sessionPct = 0;
  let weeklyPct = 0;
  let sessionReset: string | undefined;

  const sessionMatch = html.match(/Session[\s\S]*?(\d+(?:\.\d+)?)\s*%\s*used/i);
  if (sessionMatch) sessionPct = parseFloat(sessionMatch[1]);

  const weeklyMatch = html.match(/Weekly[\s\S]*?(\d+(?:\.\d+)?)\s*%\s*used/i);
  if (weeklyMatch) weeklyPct = parseFloat(weeklyMatch[1]);

  const timeMatch = html.match(/class=["']local-time["'][^>]*data-time=["']([^"']+)["']/i);
  if (timeMatch) sessionReset = timeMatch[1];

  return { sessionPct, weeklyPct, sessionReset };
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Ambil metadata akun Ollama Cloud. Single source of truth =
 * auth_credentials di agent.db. Live HTTP fetch ke ollama.com
 * untuk enrich (email/plan/id dari /api/me, session/weekly %
 * dari /settings jika cookie tersedia). Cache 15 menit.
 *
 * @returns Daftar OllamaAccountMeta; satu entry per credential
 *          aktif di DB (3 akun untuk setup standar). Urutan
 *          konsisten dengan dbId ASC.
 */
export async function fetchOllamaAccountsMeta(): Promise<OllamaAccountMeta[]> {
  const cached = loadCache();
  const creds = getOllamaCredentialsFromDb();

  // Cache hit-only path: kalau cache punya cukup entry dan creds
  // sudah ada, pakai cache. Mapping by token agar 3 akun stabil
  // di render (tidak peduli perubahan urutan DB).
  if (cached && Object.keys(cached).length >= creds.length && creds.length > 0) {
    return creds.map((c, idx) => {
      const tok = c.key || c.email || `idx_${idx}`;
      return cached[tok] || {
        email: c.email || `ollama-user-${idx + 1}`,
        plan: "free",
        id: tok.slice(0, 8),
        suspended: false,
        sessionUsagePct: 0,
        weeklyUsagePct: 0,
        hasCookie: Boolean(c.cookie),
      };
    });
  }

  // Cache miss (atau cache tidak cukup lengkap): fetch fresh
  // dari ollama.com untuk tiap akun.
  const results: OllamaAccountMeta[] = [];
  const newCache: Record<string, OllamaAccountMeta> = cached || {};

  for (let i = 0; i < creds.length; i++) {
    const c = creds[i];
    const tok = c.key;
    const cookie = c.cookie;

    let email = c.email || `ollama-user-${i + 1}`;
    let plan = "free";
    let id = tok ? tok.slice(0, 8) : `user-${i + 1}`;
    let suspended = false;
    let sessionUsagePct = 0;
    let weeklyUsagePct = 0;
    let sessionResetsAt: string | undefined;

    // Live fetch #1: ollama.com/api/me (Bearer auth, pakai key)
    if (tok) {
      try {
        const res = await fetch("https://ollama.com/api/me", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tok}`,
            "Content-Type": "application/json",
          },
        });
        if (res.ok) {
          const json = (await res.json()) as {
            Email?: string;
            email?: string;
            Plan?: string;
            plan?: string;
            ID?: string;
            id?: string;
            SuspendedAt?: { Valid?: boolean };
          };
          email = json.Email || json.email || email;
          plan = json.Plan || json.plan || plan;
          id = json.ID || json.id || id;
          suspended = Boolean(json.SuspendedAt?.Valid);
        }
      } catch {
        // Network/abort error: silent — best-effort enrichment.
      }
    }

    // Live fetch #2: ollama.com/settings (cookie auth, optional).
    // Cookie biasanya tidak tersedia di DB — hanya legacy file vault
    // yang punya. Kalau tidak ada cookie, session/weekly tetap 0.
    if (cookie) {
      try {
        const cleanCookie = cookie.startsWith("__Secure-session=")
          ? cookie
          : `__Secure-session=${cookie}`;
        const res = await fetch("https://ollama.com/settings", {
          headers: {
            Cookie: cleanCookie,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        if (res.ok) {
          const html = await res.text();
          const parsed = parseSettingsHtml(html);
          sessionUsagePct = parsed.sessionPct;
          weeklyUsagePct = parsed.weeklyPct;
          sessionResetsAt = parsed.sessionReset;
        } else {
          // Log non-OK responses so silent enrichment failures
          // become diagnosable instead of vanishing into the void.
          stderr.write(
            `⚠️  ollama.com/settings -> HTTP ${res.status} (account=${email})\n`
          );
        }
      } catch (err) {
        // Network/abort/parse failures: surface underlying error so
        // we can tell DNS, TLS, timeout, or auth issues apart.
        const msg = err instanceof Error ? err.message : String(err);
        stderr.write(
          `⚠️  ollama.com/settings fetch failed (account=${email}): ${msg}\n`
        );
      }
    }

    const meta: OllamaAccountMeta = {
      email,
      plan,
      id,
      suspended,
      sessionUsagePct,
      weeklyUsagePct,
      sessionResetsAt,
      hasCookie: Boolean(cookie),
    };

    results.push(meta);
    const cacheKey = tok || email;
    if (cacheKey) newCache[cacheKey] = meta;
  }

  saveCache(newCache);
  return results;
}
