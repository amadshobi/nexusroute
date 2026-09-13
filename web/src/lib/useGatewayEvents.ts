import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "@/types/dashboard";

export interface UseGatewayEventsOptions {
	/** Whether the SSE connection should be active. Defaults to true. */
	enabled?: boolean;
	/** SSE endpoint. Defaults to the dashboard events route. */
	url?: string;
	/** Fired for every `request_complete` or `log_entry` carrying an access log entry. */
	onLogEntry?: (entry: LogEntry) => void;
	/** Fired for `stats_delta` events with the delta payload. */
	onStatsDelta?: (stats: any) => void;
	/** Fired once the server greets the stream with a `connected` event. */
	onConnected?: (data: any) => void;
	/** Relaxed safety-net poll used when the stream is down or silently stale. */
	fallbackPoll?: () => void;
	/** Fallback interval while disconnected. Defaults to 30s. */
	fallbackIntervalMs?: number;
	/** Very relaxed fallback interval while connected. Defaults to 60s. Set 0 to disable. */
	fallbackConnectedIntervalMs?: number;
}

export interface UseGatewayEventsResult {
	isConnected: boolean;
}

const RECONNECT_MAX_MS = 30_000;

function safeParse(raw: string): any {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

/** Extract the access log entry from either a bare entry or an event envelope. */
function extractEntry(payload: any): LogEntry | null {
	if (!payload || typeof payload !== "object") return null;
	const candidate = (payload as any).data ?? payload;
	if (
		candidate &&
		typeof candidate === "object" &&
		"ts" in candidate &&
		"path" in candidate
	) {
		return candidate as LogEntry;
	}
	return null;
}

/**
 * Subscribes to the gateway SSE event stream with automatic reconnect backoff
 * and a relaxed fallback poll. The EventSource is torn down on unmount.
 */
export function useGatewayEvents(
	options: UseGatewayEventsOptions = {},
): UseGatewayEventsResult {
	const { enabled = true, url = "/api/dashboard/events" } = options;
	const [isConnected, setIsConnected] = useState(false);

	// Keep the latest callbacks in a ref so inline closures do not force the
	// EventSource to reconnect on every render.
	const optionsRef = useRef(options);
	useEffect(() => {
		optionsRef.current = options;
	});

	useEffect(() => {
		if (!enabled) return;

		let disposed = false;
		let source: EventSource | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let fallbackTimer: ReturnType<typeof setInterval> | null = null;
		let reconnectAttempt = 0;

		function clearReconnect() {
			if (reconnectTimer !== null) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
		}

		function applyFallbackInterval(connected: boolean) {
			if (fallbackTimer !== null) {
				clearInterval(fallbackTimer);
				fallbackTimer = null;
			}
			const ms = connected
				? (optionsRef.current.fallbackConnectedIntervalMs ?? 60_000)
				: (optionsRef.current.fallbackIntervalMs ?? 30_000);
			if (ms > 0) {
				fallbackTimer = setInterval(() => {
					optionsRef.current.fallbackPoll?.();
				}, ms);
			}
		}

		function scheduleReconnect() {
			if (disposed) return;
			clearReconnect();
			// Exponential backoff capped at 30s: 1s, 2s, 4s, 8s, 16s, 30s...
			const delay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** reconnectAttempt);
			reconnectAttempt += 1;
			reconnectTimer = setTimeout(connect, delay);
		}

		function teardownSource() {
			if (source) {
				source.close();
				source = null;
			}
		}

		function connect() {
			if (disposed) return;
			teardownSource();
			try {
				source = new EventSource(url);
			} catch {
				scheduleReconnect();
				return;
			}

			source.onopen = () => {
				reconnectAttempt = 0;
				setIsConnected(true);
				applyFallbackInterval(true);
			};

			source.addEventListener("connected", (event) => {
				reconnectAttempt = 0;
				setIsConnected(true);
				applyFallbackInterval(true);
				optionsRef.current.onConnected?.(
					safeParse((event as MessageEvent).data),
				);
			});

			source.addEventListener("request_complete", (event) => {
				const entry = extractEntry(safeParse((event as MessageEvent).data));
				if (entry) optionsRef.current.onLogEntry?.(entry);
			});

			source.addEventListener("log_entry", (event) => {
				const entry = extractEntry(safeParse((event as MessageEvent).data));
				if (entry) optionsRef.current.onLogEntry?.(entry);
			});

			source.addEventListener("stats_delta", (event) => {
				const payload = safeParse((event as MessageEvent).data);
				optionsRef.current.onStatsDelta?.(
					payload && typeof payload === "object" && "data" in payload
						? payload.data
						: payload,
				);
			});

			// Heartbeats only prove liveness; no state update needed.
			source.addEventListener("heartbeat", () => {});

			source.onerror = () => {
				setIsConnected(false);
				applyFallbackInterval(false);
				teardownSource();
				scheduleReconnect();
			};
		}

		applyFallbackInterval(false);
		connect();

		return () => {
			disposed = true;
			clearReconnect();
			if (fallbackTimer !== null) {
				clearInterval(fallbackTimer);
				fallbackTimer = null;
			}
			teardownSource();
		};
	}, [enabled, url]);

	return { isConnected };
}
