import path from "node:path";
import tailwindcss from "@tailwindcss/vite";

const appRoot = import.meta.dirname;

export default {
  root: appRoot,
  base: process.env.BASE_PATH ?? "/",
  plugins: [tailwindcss()],
  server: {
    port: 5175,
    host: "0.0.0.0",
    fs: {
      allow: [appRoot]
    }
  },
  build: {
    outDir: path.resolve(appRoot, "dist"),
    emptyOutDir: true,
    target: "es2024",
    sourcemap: true
  }
};
