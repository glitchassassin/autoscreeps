import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { VariantBuildRecord } from "./contracts.ts";
import { fileExists, sha256, timestamp } from "./utils.ts";

export async function buildVariantPackage(sourceRoot: string, packagePath: string, installMode: "auto" | "ci"): Promise<{ bundle: string; record: VariantBuildRecord }> {
  const packageRoot = resolvePackageRoot(sourceRoot, packagePath);
  const packageJsonPath = path.join(packageRoot, "package.json");

  if (!(await fileExists(packageJsonPath))) {
    throw new Error(`Expected a package.json at ${packageJsonPath}.`);
  }

  await installDependencies(packageRoot, installMode);
  await execa("npm", ["run", "build"], { cwd: packageRoot, stdio: "pipe" });

  const bundlePath = path.join(packageRoot, "dist", "main.js");
  if (!(await fileExists(bundlePath))) {
    throw new Error(`Expected build output at ${bundlePath}.`);
  }

  const bundle = await fs.readFile(bundlePath, "utf8");

  return {
    bundle,
    record: {
      packagePath,
      bundleHash: sha256(bundle),
      bundleSize: Buffer.byteLength(bundle, "utf8"),
      builtAt: timestamp(),
      nodeVersion: process.version
    }
  };
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
