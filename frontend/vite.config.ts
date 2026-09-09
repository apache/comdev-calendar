import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";

// The backend the dev server proxies to. Override with BACKEND=... npm run dev
const backend = process.env.BACKEND ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  server: {
    port: 5173,
    strictPort: false,
    // Everything the backend owns is proxied, so the dev server behaves like
    // the production deployment (same origin, real session cookies).
    proxy: {
      "/api": { target: backend, changeOrigin: false },
      "/auth": { target: backend, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**/*.ts"],
    },
  },
});
