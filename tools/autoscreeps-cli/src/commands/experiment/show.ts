import { readSuiteDetails } from "../../lib/history.ts";
import { resolveRepoRoot } from "../../lib/git.ts";
import { summarizeSuiteResults } from "../../lib/suite-runner.ts";

export async function showExperimentCommand(suiteId: string): Promise<void> {
  const repoRoot = await resolveRepoRoot(process.cwd());
  const details = await readSuiteDetails(repoRoot, suiteId);
  process.stdout.write(`${JSON.stringify({
    suite: details.suite,
    summary: summarizeSuiteResults(details.cases),
    cases: details.cases
  }, null, 2)}\n`);
}
