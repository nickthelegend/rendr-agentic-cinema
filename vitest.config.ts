import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: [
			"src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
			"electron/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
		],
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			// kokoro-js hides its web build behind an `exports` map that only
			// names the Node entry, and that entry imports `node:fs`. Reached by
			// absolute path under a name of our own instead.
			"kokoro-web": path.resolve(__dirname, "node_modules/kokoro-js/dist/kokoro.web.js"),
		},
	},
});
