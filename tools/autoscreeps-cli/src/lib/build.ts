import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { ScreepsModule, VariantBuildRecord } from "./contracts.ts";
import { fileExists, sha256, timestamp } from "./utils.ts";

export async function buildVariantPackage(
  sourceRoot: string,
  packagePath: string,
  installMode: "auto" | "ci"
): Promise<{ modules: Record<string, ScreepsModule>; record: VariantBuildRecord }> {
  const packageRoot = resolvePackageRoot(sourceRoot, packagePath);
  const packageJsonPath = path.join(packageRoot, "package.json");

  if (!(await fileExists(packageJsonPath))) {
    throw new Error(`Expected a package.json at ${packageJsonPath}.`);
  }

  await installDependencies(packageRoot, installMode);
  await execa("npm", ["run", "build"], { cwd: packageRoot, stdio: "pipe" });

  const modules = await readBuiltModules(path.join(packageRoot, "dist"));
  const serializedModules = serializeModulesForHash(modules);

  return {
    modules,
    record: {
      packagePath,
      bundleHash: sha256(serializedModules),
      bundleSize: Buffer.byteLength(serializedModules, "utf8"),
      builtAt: timestamp(),
      nodeVersion: process.version
    }
  };
}

async function readBuiltModules(distDir: string): Promise<Record<string, ScreepsModule>> {
  const entries = await fs.readdir(distDir, { withFileTypes: true });
  const modules: Record<string, ScreepsModule> = {};

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name);
    const modulePath = path.join(distDir, entry.name);

    if (extension === ".js") {
      modules[path.basename(entry.name, ".js")] = await fs.readFile(modulePath, "utf8");
    } else if (extension === ".wasm") {
      modules[entry.name] = {
        binary: await fs.readFile(modulePath, "base64")
      };
    }
  }

  if (!("main" in modules)) {
    throw new Error(`Expected build output at ${path.join(distDir, "main.js")}.`);
  }

  return modules;
}

function serializeModulesForHash(modules: Record<string, ScreepsModule>): string {
  const sortedModules: Record<string, ScreepsModule> = {};

  for (const moduleName of Object.keys(modules).sort()) {
    sortedModules[moduleName] = modules[moduleName]!;
  }

  return JSON.stringify(sortedModules);
}

function resolvePackageRoot(sourceRoot: string, packagePath: string): string {
  const resolved = path.resolve(sourceRoot, packagePath);
  const relative = path.relative(sourceRoot, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Package path '${packagePath}' escapes the resolved source root.`);
  }

  return resolved;
}

async function installDependencies(packageRoot: string, installMode: "auto" | "ci"): Promise<void> {
  const nodeModulesPath = path.join(packageRoot, "node_modules");
  const hasNodeModules = await fileExists(nodeModulesPath);

  if (installMode === "auto" && hasNodeModules) {
    return;
  }

  const hasLockfile = await fileExists(path.join(packageRoot, "package-lock.json"));
  const args = installMode === "ci" && hasLockfile ? ["ci"] : ["install"];

  await execa("npm", args, { cwd: packageRoot, stdio: "pipe" });
}
