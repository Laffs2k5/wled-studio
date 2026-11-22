/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // the backend during development: python -m wledstudio
    proxy: { "/api": "http://127.0.0.1:8080" },
  },
  build: { sourcemap: false },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    coverage: { reporter: ["text"], include: ["src/**/*.{ts,tsx}"], exclude: ["src/test/**", "src/main.tsx"] },
  },
});
