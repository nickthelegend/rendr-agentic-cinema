// Browser-only Vite config for iterating on the renderer without launching
// Electron. Same aliases as vite.config.ts, no electron plugin.
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	// Pinned so the server can be launched from a parent directory.
	root: __dirname,
	plugins: [react()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
			// kokoro-js publishes an `exports` map whose only condition is the
			// Node build, which imports `node:fs` and cannot run in a tab. The
			// web build ships in the same package but the exports map hides it,
			// so it is reached by absolute path under a name of our own.
			"kokoro-web": path.resolve(__dirname, "./node_modules/kokoro-js/dist/kokoro.web.js"),
		},
	},
	server: {
		port: 5233,
		strictPort: true,
	},
});
