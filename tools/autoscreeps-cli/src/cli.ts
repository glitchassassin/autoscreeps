#!/usr/bin/env node

import { Command } from "commander";
import { runDuelExperimentCommand } from "./commands/experiment/run-duel.ts";
import { listExperimentsCommand } from "./commands/experiment/list.ts";
import { showExperimentCommand } from "./commands/experiment/show.ts";

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("autoscreeps")
    .description("Run local autoscreeps experiments")
    .showHelpAfterError();

  const experiment = program.command("experiment").description("Experiment commands");

  const run = experiment.command("run").description("Run an experiment");
  run
    .command("duel")
    .description("Run a duel between baseline and candidate variants")
    .requiredOption("--scenario <path>", "Path to the experiment scenario YAML file")
    .requiredOption("--baseline-source <source>", "Baseline source, such as git:main or workspace")
    .requiredOption("--baseline-package <path>", "Baseline package path within the resolved source")
    .requiredOption("--candidate-source <source>", "Candidate source, such as git:main or workspace")
    .requiredOption("--candidate-package <path>", "Candidate package path within the resolved source")
    .action(runDuelExperimentCommand);

  experiment.command("list").description("List recorded experiment runs").action(listExperimentsCommand);

  experiment
    .command("show")
    .description("Show a recorded experiment run")
    .argument("<run-id>", "Run identifier")
    .action(showExperimentCommand);

  await program.parseAsync();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
