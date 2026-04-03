import { readRunDetails } from "../../lib/history.js";
import { resolveRepoRoot } from "../../lib/git.js";

export async function showExperimentCommand(runId: string): Promise<void> {
  const repoRoot = await resolveRepoRoot(process.cwd());
  const run = await readRunDetails(repoRoot, runId);
  process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
}
