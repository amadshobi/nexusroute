/**
 * ─────────────────────────────────────────────────────────────
 * NexusRoute — Single Source of Truth for the CLI Version
 * ─────────────────────────────────────────────────────────────
 *
 * Kept separate from index.ts so the gateway/server modules can
 * share the same version without introducing a circular import.
 *
 * `GN_VERSION` is retained as a backward-compatible alias
 * (used by the gateway/server modules and legacy services).
 */
export const GN_VERSION = "1.8.1";

/** Canonical NexusRoute CLI version. */
export const NEXUS_VERSION = GN_VERSION;
