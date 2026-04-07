import { runScenarioSuite } from "../../lib/suite-runner.ts";

type DuelCommandOptions = {
  scenario: string;
  baselineSource: string;
  baselinePackage: string;
  candidateSource: string;
  candidatePackage: string;
};

export async function runDuelExperimentCommand(options: DuelCommandOptions): Promise<void> {
  const result = await runScenarioSuite({
    cwd: process.cwd(),
    scenarioPath: options.scenario,
    baseline: {
      source: options.baselineSource,
      packagePath: options.baselinePackage
    },
    candidate: {
      source: options.candidateSource,
      packagePath: options.candidatePackage
    }
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.suite.status !== "completed" || result.suite.progress.failedCaseCount > 0 || !result.summary.gates.passed) {
    process.exitCode = 1;
  }
}
