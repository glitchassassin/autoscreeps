import { runSingleExperiment } from "../../lib/runner.ts";

type SingleCommandOptions = {
  scenario: string;
  source: string;
  package: string;
};

export async function runSingleExperimentCommand(options: SingleCommandOptions): Promise<void> {
  const result = await runSingleExperiment({
    cwd: process.cwd(),
    scenarioPath: options.scenario,
    variant: {
      source: options.source,
      packagePath: options.package
    }
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.run.status !== "completed") {
    process.exitCode = 1;
  }
}
