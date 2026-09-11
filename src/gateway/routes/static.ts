import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import type { GatewayContext } from "../context";

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
