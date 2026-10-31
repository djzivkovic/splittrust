import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The build lands inside the Go module so `go:embed web/dist` serves it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "../internal/api/web/dist", emptyOutDir: true, sourcemap: false },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
});
