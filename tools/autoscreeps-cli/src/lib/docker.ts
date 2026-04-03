import { execa } from "execa";

export async function resetPrivateServer(repoRoot: string): Promise<void> {
  await execa("docker", ["compose", "down", "-v"], { cwd: repoRoot, stdio: "pipe" });
  await execa("docker", ["compose", "up", "-d"], { cwd: repoRoot, stdio: "pipe" });
}

export async function restartScreepsService(repoRoot: string): Promise<void> {
  await execa("docker", ["compose", "restart", "screeps"], { cwd: repoRoot, stdio: "pipe" });
}
