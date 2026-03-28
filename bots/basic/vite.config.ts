import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption } from "vite";
import { loadDeploymentTarget, resolveBundlePath, uploadBundle } from "./scripts/screeps-upload";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

function screepsUploadPlugin(target: Awaited<ReturnType<typeof loadDeploymentTarget>>): PluginOption {
  return {
    name: "screeps-upload",
    apply: "build",
    async closeBundle() {
      if (!target) {
        return;
      }

      const bundlePath = resolveBundlePath(path.resolve(rootDir, "dist"));
      await uploadBundle(bundlePath, target);
    }
  };
}

export default defineConfig(({ mode }) => {
  const target = loadDeploymentTarget(rootDir, mode);

  return {
    build: {
      outDir: "dist",
      emptyOutDir: true,
      minify: false,
      sourcemap: true,
      target: "es2020",
      lib: {
        entry: path.resolve(rootDir, "src/main.ts"),
        formats: ["cjs"],
        fileName: () => "main.js"
      },
      rollupOptions: {
        output: {
          exports: "named"
        }
      }
    },
    plugins: [screepsUploadPlugin(target)]
  };
});
