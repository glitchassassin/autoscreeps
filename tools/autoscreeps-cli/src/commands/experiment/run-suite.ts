import { runExperimentSuite } from "../../lib/suite-runner.ts";

type SuiteCommandOptions = {
  manifest: string;
  source: string;
  package: string;
  candidateSource?: string;
  candidatePackage?: string;
};

export async function runExperimentSuiteCommand(options: SuiteCommandOptions): Promise<void> {
  const candidate = options.candidateSource && options.candidatePackage
    ? {
      source: options.candidateSource,
      packagePath: options.candidatePackage
    }
    : undefined;

  const result = await runExperimentSuite({
    cwd: process.cwd(),
    manifestPath: options.manifest,
    baseline: {
      source: options.source,
      packagePath: options.package
    },
    candidate
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.suite.status !== "completed" || result.suite.progress.failedCaseCount > 0) {
    process.exitCode = 1;
  }
}
