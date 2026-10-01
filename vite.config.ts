import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev: `npm run dev` serves the UI with hot reload and forwards /api and /vault
// to a Learn server (LEARN_API, default the usual port). `npm run build` writes
// dist/, which server/server.mjs serves.
const api = process.env.LEARN_API || "http://127.0.0.1:4747";
// The server only takes POSTs from its own origin; the dev page is that origin by proxy.
const proxy = { target: api, changeOrigin: true, headers: { origin: api } };

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
	server: { proxy: { "/api": proxy, "/vault": proxy } },
	// Mermaid and its layout engines are big, but they only load when a lesson has a diagram.
	build: { chunkSizeWarningLimit: 2000 },
});
