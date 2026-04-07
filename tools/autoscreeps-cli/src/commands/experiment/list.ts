import { listSuites } from "../../lib/history.ts";
import { resolveRepoRoot } from "../../lib/git.ts";

export async function listExperimentsCommand(): Promise<void> {
  const repoRoot = await resolveRepoRoot(process.cwd());
  const suites = await listSuites(repoRoot);
  process.stdout.write(`${JSON.stringify(suites, null, 2)}\n`);
}
