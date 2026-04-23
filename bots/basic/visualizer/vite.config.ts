import path from "node:path";
import { defineConfig } from "vite";

const packageRoot = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  root: import.meta.dirname,
  server: {
    port: 5174,
    host: "0.0.0.0",
    fs: {
      allow: [packageRoot]
    }
  },
  build: {
    outDir: path.resolve(packageRoot, "dist-visualizer"),
    emptyOutDir: true,
    target: "es2024",
    sourcemap: true
  }
});
