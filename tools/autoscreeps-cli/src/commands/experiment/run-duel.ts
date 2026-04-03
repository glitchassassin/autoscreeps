import { runDuelExperiment } from "../../lib/runner.js";

type DuelCommandOptions = {
  scenario: string;
  baselineSource: string;
  baselinePackage: string;
  candidateSource: string;
  candidatePackage: string;
};

export async function runDuelExperimentCommand(options: DuelCommandOptions): Promise<void> {
  const details = await runDuelExperiment({
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

  process.stdout.write(`${JSON.stringify(details, null, 2)}\n`);
  if (details.run.status !== "completed") {
    process.exitCode = 1;
  }
}
