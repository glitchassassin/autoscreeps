import { listRuns } from "../../lib/history.ts";
import { resolveRepoRoot } from "../../lib/git.ts";

export async function listExperimentsCommand(): Promise<void> {
  const repoRoot = await resolveRepoRoot(process.cwd());
  const runs = await listRuns(repoRoot);
  process.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
}
