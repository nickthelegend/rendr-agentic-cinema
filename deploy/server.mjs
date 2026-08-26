// The hosted build's server.
//
// Two jobs: serve the built single-page app, and stand in front of ClickHouse
// so the browser never sees a credential.
//
// The proxy is the reason this file exists at all. Pointing the client straight
// at a ClickHouse host means shipping the username and password inside the
// JavaScript bundle, where anyone can read them — a demo that leaks its own
// database to make a panel light up. Here the credentials stay in the server's
// environment and the page talks to a same-origin path.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// `public`, not `dist`: the repo gitignores dist, and Railway honours the
// ignore file when it builds the upload — so the whole site was silently left
// out and every request fell through to a missing index.html.
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const PORT = Number(process.env.PORT) || 8080;

const CH_URL = process.env.CLICKHOUSE_URL ?? "";
const CH_USER = process.env.CLICKHOUSE_USER ?? "default";
const CH_PASSWORD = process.env.CLICKHOUSE_PASSWORD ?? "";
const CH_DATABASE = process.env.CLICKHOUSE_DATABASE ?? "cinema";

const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".webp": "image/webp",
	".woff2": "font/woff2",
	".map": "application/json; charset=utf-8",
};

/**
 * Statements the page is allowed to run.
 *
 * An open SQL proxy is a public database with extra steps, so this is an
 * allow-list of shapes rather than a filter of bad words: reads against the one
 * table, the two statements that create it, and the single UPDATE that records
 * a verdict. Anything else is refused without being forwarded.
 */
function allowed(sql) {
	const text = sql.trim().replace(/\s+/g, " ");
	if (/^CREATE DATABASE IF NOT EXISTS cinema$/i.test(text)) return true;
	if (/^CREATE TABLE IF NOT EXISTS generations \(/i.test(text)) return true;
	if (/^INSERT INTO generations VALUES /i.test(text)) return true;
	if (/^SELECT [\s\S]+ FROM generations\b/i.test(text)) return true;
	if (/^ALTER TABLE generations UPDATE accepted = [01] WHERE /i.test(text)) return true;
	return false;
}

async function proxy(request, response, body) {
	if (!CH_URL) {
		response.writeHead(503, { "Content-Type": "text/plain" });
		response.end("No ledger is configured for this deployment.");
		return;
	}
	if (!allowed(body)) {
		response.writeHead(400, { "Content-Type": "text/plain" });
		response.end("That statement is not one this proxy forwards.");
		return;
	}
	const url = new URL(CH_URL);
	url.searchParams.set("database", CH_DATABASE);
	try {
		const upstream = await fetch(url.toString(), {
			method: "POST",
			headers: {
				"Content-Type": "text/plain",
				Authorization: `Basic ${Buffer.from(`${CH_USER}:${CH_PASSWORD}`).toString("base64")}`,
			},
			body,
		});
		const text = await upstream.text();
		response.writeHead(upstream.status, { "Content-Type": "text/plain; charset=utf-8" });
		response.end(text);
	} catch (error) {
		// A ledger that cannot be reached must not take the page down with it —
		// the app already treats this as "no history", which is the right shape.
		response.writeHead(502, { "Content-Type": "text/plain" });
		response.end(`Ledger unreachable: ${String(error).slice(0, 200)}`);
	}
}

createServer((request, response) => {
	const { pathname } = new URL(request.url ?? "/", `http://${request.headers.host}`);

	if (pathname === "/healthz") {
		response.writeHead(200, { "Content-Type": "text/plain" });
		response.end("ok");
		return;
	}

	if (pathname === "/ch") {
		if (request.method !== "POST") {
			response.writeHead(405).end();
			return;
		}
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
			// A statement is never megabytes. Cap it so a bad actor cannot use
			// this endpoint to hold memory open.
			if (body.length > 2_000_000) request.destroy();
		});
		request.on("end", () => void proxy(request, response, body));
		return;
	}

	// normalize() before joining: without it a request for ../../etc/passwd
	// walks straight out of the served directory.
	const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
	let file = join(ROOT, rel);
	if (!file.startsWith(ROOT)) file = ROOT;
	if (!existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, "index.html");

	response.writeHead(200, {
		"Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
		// The hashed assets are immutable; index.html must never be.
		"Cache-Control": file.endsWith("index.html")
			? "no-cache"
			: "public, max-age=31536000, immutable",
	});
	const stream = createReadStream(file);
	// A read that fails must not take the process down. Without this an ENOENT
	// raises an unhandled 'error' on the stream and node exits — one missing
	// file killing the whole server.
	stream.on("error", () => response.destroy());
	stream.pipe(response);
}).listen(PORT, "0.0.0.0", () => {
	console.log(`rendr-agentic-cinema on :${PORT} (ledger ${CH_URL ? "configured" : "absent"})`);
});
