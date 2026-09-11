import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Returns the base configuration directory for GN (~/.config/gn)
 * Ensures the directory and subdirectories exist.
 */
export function getGnConfigDir(): string {
  const base = path.join(os.homedir(), ".config", "gn");
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }
  return base;
}

/**
 * Returns cache directory for ping or bench:
 * - ~/.config/gn/cache/ping
 * - ~/.config/gn/cache/bench
 */
export function getGnCacheDir(type: "ping" | "bench"): string {
  const cacheDir = path.join(getGnConfigDir(), "cache", type);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

/**
 * Normalizes provider name for file naming (e.g., "google-antigravity" -> "google-antigravity.json")
 */
export function getGnCacheFilePath(type: "ping" | "bench", provider: string): string {
  const cleanProvider = provider.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return path.join(getGnCacheDir(type), `${cleanProvider}.json`);
}

/**
 * Reads cache JSON file directly from ~/.config/gn/cache/<type>/<provider>.json
 */
export function readGnCache<T = any>(type: "ping" | "bench", provider: string): T | null {
  const targetPath = getGnCacheFilePath(type, provider);

  if (fs.existsSync(targetPath)) {
    try {
      const raw = fs.readFileSync(targetPath, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Writes data to cache JSON file in ~/.config/gn/cache/<type>/<provider>.json
 */
export function writeGnCache(type: "ping" | "bench", provider: string, data: any): boolean {
  try {
    const targetPath = getGnCacheFilePath(type, provider);
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}
