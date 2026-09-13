/**
 * ─────────────────────────────────────────────────────────────
 * NexusRoute — Gateway Event Bus & SSE Stream Test Suite
 * ─────────────────────────────────────────────────────────────
 *
 * Covers the zero-dependency in-process GatewayEventBus and the
 * Bun-native SSE endpoint (GET /api/gateway/events + alias).
 * Strictly ephemeral: dynamic ports, no live network dependencies.
 */

import { describe, expect, test, beforeEach, afterEach, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEventBus, createGatewayServer } from "../../src/gateway/server";
import type { GatewayEventPayload } from "../../src/gateway/context";

const TEST_DIR = join(process.cwd(), ".tmp-test-gateway");
const ISOLATED_CONFIG_PATH = join(TEST_DIR, "events-isolated-config.json");
process.env.NEXUS_CONFIG_PATH = ISOLATED_CONFIG_PATH;
process.env.GN_CONFIG_PATH = ISOLATED_CONFIG_PATH;

if (!existsSync(TEST_DIR)) {
	mkdirSync(TEST_DIR, { recursive: true });
}
writeFileSync(
	ISOLATED_CONFIG_PATH,
	JSON.stringify({
		gateway: {
			enabled: true,
			modelFilter: { whitelist: { omp: [] }, blacklist: [] },
		},
	}),
);

/** Poll until the predicate holds or the timeout elapses. */
async function waitFor(
	predicate: () => boolean,
	timeoutMs = 2000,
): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (predicate()) return true;
		await new Promise((r) => setTimeout(r, 10));
	}
	return predicate();
}

function parseSseChunk(chunk: string): { event: string; data: any } | null {
	const lines = chunk.split("\n");
	const eventLine = lines.find((l) => l.startsWith("event: "));
	const dataLine = lines.find((l) => l.startsWith("data: "));
	if (!eventLine || !dataLine) return null;
	return {
		event: eventLine.slice("event: ".length).trim(),
		data: JSON.parse(dataLine.slice("data: ".length)),
	};
}

describe("1. GatewayEventBus (unit)", () => {
	test("delivers events to a single subscriber", () => {
		const bus = createEventBus();
		const received: GatewayEventPayload[] = [];
		bus.subscribe((e) => received.push(e));

		const event: GatewayEventPayload = { type: "heartbeat", ts: 1 };
		bus.emit(event);

		expect(received.length).toBe(1);
		expect(received[0]).toEqual(event);
		expect(bus.subscriberCount()).toBe(1);
	});

	test("broadcasts to multiple subscribers", () => {
		const bus = createEventBus();
		const a: GatewayEventPayload[] = [];
		const b: GatewayEventPayload[] = [];
		bus.subscribe((e) => a.push(e));
		bus.subscribe((e) => b.push(e));

		expect(bus.subscriberCount()).toBe(2);
		bus.emit({ type: "request_complete", ts: 2, data: { path: "/x" } });

		expect(a.length).toBe(1);
		expect(b.length).toBe(1);
		expect(a[0].data).toEqual({ path: "/x" });
	});

	test("unsubscribe removes only the target handler", () => {
		const bus = createEventBus();
		const kept: GatewayEventPayload[] = [];
		const dropped: GatewayEventPayload[] = [];

		const unsubscribe = bus.subscribe((e) => dropped.push(e));
		bus.subscribe((e) => kept.push(e));
		expect(bus.subscriberCount()).toBe(2);

		unsubscribe();
		expect(bus.subscriberCount()).toBe(1);

		bus.emit({ type: "heartbeat", ts: 3 });
		expect(dropped.length).toBe(0);
		expect(kept.length).toBe(1);
	});

	test("isolates a throwing subscriber from healthy ones", () => {
		const bus = createEventBus();
		const received: GatewayEventPayload[] = [];

		bus.subscribe(() => {
			throw new Error("subscriber boom");
		});
		bus.subscribe((e) => received.push(e));

		// Must not propagate the throwing handler's error.
		expect(() => bus.emit({ type: "heartbeat", ts: 4 })).not.toThrow();
		expect(received.length).toBe(1);
	});

	test("subscribing the same handler twice is idempotent", () => {
		const bus = createEventBus();
		let calls = 0;
		const handler = () => {
			calls += 1;
		};
		bus.subscribe(handler);
		bus.subscribe(handler);

		expect(bus.subscriberCount()).toBe(1);
		bus.emit({ type: "heartbeat", ts: 5 });
		expect(calls).toBe(1);
	});
});

describe("2. SSE endpoint GET /api/gateway/events", () => {
	let gateway: ReturnType<typeof createGatewayServer>;
	let baseUrl = "";

	beforeEach(() => {
		gateway = createGatewayServer({
			port: 0, // dynamic ephemeral port
			cacheEnabled: false,
			shieldEnabled: false,
			mode: "live",
			upstreams: [
				{ name: "omp", host: "127.0.0.1", port: 1, basePath: "/v1" },
			],
		});
		const instance = gateway.start();
		baseUrl = `http://127.0.0.1:${instance.port}`;
	});

	afterEach(() => {
		gateway?.stop();
	});

	afterAll(() => {
		// Only remove this suite's own artifact; TEST_DIR is shared with other suites.
		if (existsSync(ISOLATED_CONFIG_PATH)) {
			rmSync(ISOLATED_CONFIG_PATH, { force: true });
		}
	});

	test("streams the connected greeting with SSE headers", async () => {
		const controller = new AbortController();
		const res = await fetch(`${baseUrl}/api/gateway/events`, {
			signal: controller.signal,
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
		expect(res.headers.get("x-accel-buffering")).toBe("no");
		// Security: CORS and hop-by-hop headers must not be set on the SSE stream.
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
		expect(res.headers.get("connection")).toBeNull();

		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		const first = await reader.read();
		const parsed = parseSseChunk(decoder.decode(first.value));

		expect(parsed).not.toBeNull();
		expect(parsed!.event).toBe("connected");
		expect(parsed!.data.type).toBe("connected");
		expect(typeof parsed!.data.ts).toBe("number");
		expect(parsed!.data.stats).toBeDefined();
		expect(typeof parsed!.data.stats.mode).toBe("string");

		await reader.cancel();
		controller.abort();
	});

	test("forwards emitted request_complete events and cleans up on cancel", async () => {
		const controller = new AbortController();
		const res = await fetch(`${baseUrl}/api/gateway/events`, {
			signal: controller.signal,
		});
		const reader = res.body!.getReader();
		const decoder = new TextDecoder();

		// Drain the initial connected greeting.
		await reader.read();

		// A client is now subscribed to the shared in-process bus.
		await waitFor(() => gateway.context.eventBus.subscriberCount() > 0);
		expect(gateway.context.eventBus.subscriberCount()).toBe(1);

		const payload: GatewayEventPayload = {
			type: "request_complete",
			ts: 1700000000000,
			data: { path: "/v1/chat/completions", status: 200 },
		};
		gateway.context.eventBus.emit(payload);

		const second = await reader.read();
		const parsed = parseSseChunk(decoder.decode(second.value));
		expect(parsed).not.toBeNull();
		expect(parsed!.event).toBe("request_complete");
		expect(parsed!.data.type).toBe("request_complete");
		expect(parsed!.data.ts).toBe(payload.ts);
		expect(parsed!.data.data).toEqual({
			path: "/v1/chat/completions",
			status: 200,
		});

		// Cancelling the reader must tear down the subscription exactly once.
		await reader.cancel();
		const cleaned = await waitFor(
			() => gateway.context.eventBus.subscriberCount() === 0,
		);
		expect(cleaned).toBe(true);
		expect(gateway.context.eventBus.subscriberCount()).toBe(0);

		controller.abort();
	});

	test("serves the alias GET /api/dashboard/events", async () => {
		const controller = new AbortController();
		const res = await fetch(`${baseUrl}/api/dashboard/events`, {
			signal: controller.signal,
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/event-stream");

		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		const first = await reader.read();
		const parsed = parseSseChunk(decoder.decode(first.value));
		expect(parsed!.event).toBe("connected");

		await reader.cancel();
		controller.abort();
	});
});
