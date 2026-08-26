// Builds the hosted payload.
//
// The site is built here rather than on Railway because the repo's `build`
// script is the full Electron pipeline — native helpers, electron-builder, the
// lot — and none of it is wanted for a web deploy.
//
// The output goes to deploy/public rather than deploy/dist because .gitignore
// excludes `dist`, and Railway honours the ignore file when it makes the
// upload: the whole site was silently left out of the first deployment and
// every request fell through to a missing index.html.

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

const OUT = "deploy/public";
rmSync(OUT, { recursive: true, force: true });

execSync(`npx vite build --config vite.ui.config.ts --outDir ${OUT} --emptyOutDir`, {
	stdio: "inherit",
	env: {
		...process.env,
		// Same origin: the server proxies to Clickhouse and holds the credential,
		// so nothing secret reaches the bundle.
		VITE_CLICKHOUSE_URL: "/ch",
		VITE_CLICKHOUSE_USER: "",
		VITE_CLICKHOUSE_PASSWORD: "",
	},
});

// Desktop decoration the cinema build never shows — 42 MB of wallpapers and
// platform icons that would triple the upload for nothing.
for (const extra of ["wallpapers", "app-icons"]) {
	rmSync(`${OUT}/${extra}`, { recursive: true, force: true });
}
console.log(`built ${OUT}`);
