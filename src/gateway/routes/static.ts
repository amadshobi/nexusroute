import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import type { GatewayContext } from "../context";
import { isStaticAssetPath } from "../access-log";

/**
 * Resolve a request path to a real file inside the dist root.
 * Returns null when the path is unsafe or does not exist as a file.
 */
function resolveDistFile(
	distRoot: string,
	pathname: string,
): string | null {
	// Map both `/dashboard/<asset>` and bare `/assets/<asset>` onto dist.
	const relativeRaw = pathname
		.replace(/^\/dashboard\/?/, "")
		.split("?")[0];
	if (!relativeRaw) return null;

	const target = normalize(join(distRoot, relativeRaw));
	if (!target.startsWith(distRoot + sep) && target !== distRoot) {
		return null;
	}
	if (!existsSync(target) || !statSync(target).isFile()) {
		return null;
	}
	return target;
}

/**
 * Serve SPA dashboard static assets (build output in web/dist).
 */
export async function handleStaticSpa(
	req: Request,
	url: URL,
	ctx: GatewayContext,
): Promise<Response | null> {
	if (!ctx.config.webDistDir) {
		return null;
	}

	const method = req.method.toUpperCase();
	if (method !== "GET" && method !== "HEAD") {
		return new Response("Method Not Allowed", { status: 405 });
	}

	const distRoot = normalize(ctx.config.webDistDir);
	let relative = url.pathname.replace(/^\/dashboard\/?/, "").split("?")[0];
	if (!relative || relative.endsWith("/")) {
		relative = "index.html";
	}

	// Prevent path traversal outside dist.
	const target = normalize(join(distRoot, relative));
	if (!target.startsWith(distRoot + sep) && target !== distRoot) {
		return new Response("Not Found", { status: 404 });
	}

	// Coba file aset dulu; kalau ada, serve langsung (biar JS/CSS/image dapat content-type benar dari Bun.file).
	if (
		relative !== "index.html" &&
		existsSync(target) &&
		statSync(target).isFile()
	) {
		const assetFile = Bun.file(target);
		if (await assetFile.exists()) {
			return new Response(assetFile);
		}
	}

	// SPA fallback: semua path non-file mengarah ke index.html.
	const indexFile = Bun.file(join(distRoot, "index.html"));
	return new Response(indexFile);
}

/**
 * Serve a static bundle asset (JS/CSS/images/fonts or `/assets/*`).
 * Returns 404 when the asset does not exist, never falling back to the SPA.
 */
export async function handleStaticAsset(
	req: Request,
	url: URL,
	ctx: GatewayContext,
): Promise<Response> {
	if (!ctx.config.webDistDir) {
		return new Response("Not Found", { status: 404 });
	}

	const method = req.method.toUpperCase();
	if (method !== "GET" && method !== "HEAD") {
		return new Response("Method Not Allowed", { status: 405 });
	}

	// Unknown external asset requests (e.g. /favicon.ico) are harmless 404s.
	if (!isStaticAssetPath(url.pathname)) {
		return new Response("Not Found", { status: 404 });
	}

	const distRoot = normalize(ctx.config.webDistDir);
	const filePath = resolveDistFile(distRoot, url.pathname);
	if (!filePath) {
		return new Response("Not Found", { status: 404 });
	}

	const assetFile = Bun.file(filePath);
	if (!(await assetFile.exists())) {
		return new Response("Not Found", { status: 404 });
	}
	return new Response(assetFile);
}
