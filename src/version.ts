/**
 * ─────────────────────────────────────────────────────────────
 * NexusRoute — Single Source of Truth untuk Versi CLI
 * ─────────────────────────────────────────────────────────────
 *
 * Dipisah dari index.ts agar modul gateway/server bisa memakai
 * versi yang sama tanpa menimbulkan circular import.
 *
 * `GN_VERSION` dipertahankan sebagai alias backward-compatible
 * (dipakai modul gateway/server & service lama).
 */
export const GN_VERSION = "1.0.0";

/** Versi kanonik NexusRoute CLI. */
export const NEXUS_VERSION = GN_VERSION;
