import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import type { WorkspaceVariantSnapshot } from "./contracts.js";
import { fileExists, sha256 } from "./utils.js";

export type VariantSource =
  | { kind: "workspace"; raw: "workspace" }
  | { kind: "git"; raw: string; ref: string };

export function parseVariantSource(value: string): VariantSource {
  if (value === "workspace") {
    return { kind: "workspace", raw: value };
  }

  if (value.startsWith("git:")) {
    const ref = value.slice(4);
    if (!ref) {
      throw new Error("Git sources must be formatted as git:<ref>.");
    }
    return { kind: "git", raw: value, ref };
  }

  throw new Error(`Unsupported variant source '${value}'. Use 'workspace' or 'git:<ref>'.`);
}

export async function resolveRepoRoot(cwd: string): Promise<string> {
  const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"], { cwd });
  return stdout.trim();
}

export async function resolveGitRef(repoRoot: string, ref: string): Promise<string> {
  const { stdout } = await execa("git", ["rev-parse", `${ref}^{commit}`], { cwd: repoRoot });
  return stdout.trim();
}

export async function getHeadSha(repoRoot: string): Promise<string> {
  const { stdout } = await execa("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  return stdout.trim();
}

export async function getBranchName(repoRoot: string): Promise<string> {
  const { stdout } = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot });
  return stdout.trim();
}

export async function createWorkspaceSnapshot(repoRoot: string, patchPath: string): Promise<WorkspaceVariantSnapshot> {
  const baseSha = await getHeadSha(repoRoot);
  const branchName = await getBranchName(repoRoot);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-index-"));
  const indexFile = path.join(tempDir, "index");
  const env = {
    ...process.env,
    GIT_INDEX_FILE: indexFile
  };

  try {
    await execa("git", ["read-tree", "HEAD"], { cwd: repoRoot, env });
    await execa("git", ["add", "-A"], { cwd: repoRoot, env });
    const { stdout } = await execa("git", ["diff", "--cached", "--binary", "HEAD"], { cwd: repoRoot, env, maxBuffer: 20 * 1024 * 1024 });
    const dirty = stdout.length > 0;

    if (dirty) {
      await fs.writeFile(patchPath, stdout, "utf8");
    }

    return {
      kind: "workspace",
      source: "workspace",
      baseSha,
      branchName,
      dirty,
      patchFile: dirty ? path.basename(patchPath) : null,
      patchHash: dirty ? sha256(stdout) : null
    };
  } finally {
    if (await fileExists(tempDir)) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

export async function withGitWorktree<T>(repoRoot: string, ref: string, callback: (worktreeRoot: string, resolvedSha: string) => Promise<T>): Promise<T> {
  const resolvedSha = await resolveGitRef(repoRoot, ref);
  const worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-worktree-"));

  await execa("git", ["worktree", "add", "--detach", worktreeRoot, resolvedSha], { cwd: repoRoot });

  try {
    return await callback(worktreeRoot, resolvedSha);
  } finally {
    await execa("git", ["worktree", "remove", "--force", worktreeRoot], { cwd: repoRoot });
  }
}
