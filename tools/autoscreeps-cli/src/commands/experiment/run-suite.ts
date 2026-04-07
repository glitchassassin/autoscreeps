import { runExperimentSuite } from "../../lib/suite-runner.ts";

type SuiteCommandOptions = {
  manifest: string;
  baselineSource: string;
  baselinePackage: string;
  candidateSource: string;
  candidatePackage: string;
};

export async function runExperimentSuiteCommand(options: SuiteCommandOptions): Promise<void> {
  const result = await runExperimentSuite({
    cwd: process.cwd(),
    manifestPath: options.manifest,
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
