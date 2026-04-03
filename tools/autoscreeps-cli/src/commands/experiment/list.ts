import { listRuns } from "../../lib/history.js";
import { resolveRepoRoot } from "../../lib/git.js";

export async function listExperimentsCommand(): Promise<void> {
  const repoRoot = await resolveRepoRoot(process.cwd());
  const runs = await listRuns(repoRoot);
  process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
}
