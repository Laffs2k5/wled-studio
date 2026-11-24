/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // the backend during development: python -m wledstudio
    proxy: { "/api": "http://127.0.0.1:8080" },
  },
  // the code editor (CodeMirror) is its own lazy chunk of about 530 kB (175 kB gzipped)
  build: { sourcemap: false, chunkSizeWarningLimit: 600 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    coverage: { reporter: ["text"], include: ["src/**/*.{ts,tsx}"], exclude: ["src/test/**", "src/main.tsx"] },
  },
});
