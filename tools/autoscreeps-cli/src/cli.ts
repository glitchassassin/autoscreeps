#!/usr/bin/env node

import { Command } from "commander";
import { runDuelExperimentCommand } from "./commands/experiment/run-duel.ts";
import { runSingleExperimentCommand } from "./commands/experiment/run-single.ts";
import { runExperimentSuiteCommand } from "./commands/experiment/run-suite.ts";
import { listExperimentsCommand } from "./commands/experiment/list.ts";
import { showExperimentCommand } from "./commands/experiment/show.ts";
import { watchExperimentCommand } from "./commands/experiment/watch.ts";

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("autoscreeps")
    .description("Run local autoscreeps experiments")
    .showHelpAfterError();

  const experiment = program.command("experiment").description("Experiment commands");

  const run = experiment.command("run").description("Run an experiment");
  run
    .command("single")
    .description("Run a single bot against a scenario")
    .requiredOption("--scenario <path>", "Path to the experiment scenario YAML file")
    .requiredOption("--source <source>", "Bot source, such as git:main or workspace")
    .requiredOption("--package <path>", "Bot package path within the resolved source")
    .action(runSingleExperimentCommand);

  run
    .command("duel")
    .description("Run a duel between baseline and candidate variants")
    .requiredOption("--scenario <path>", "Path to the experiment scenario YAML file")
    .requiredOption("--baseline-source <source>", "Baseline source, such as git:main or workspace")
    .requiredOption("--baseline-package <path>", "Baseline package path within the resolved source")
    .requiredOption("--candidate-source <source>", "Candidate source, such as git:main or workspace")
    .requiredOption("--candidate-package <path>", "Candidate package path within the resolved source")
    .action(runDuelExperimentCommand);

  run
    .command("suite")
    .description("Run a manifest-driven experiment suite")
    .requiredOption("--manifest <path>", "Path to the experiment suite manifest YAML file")
    .requiredOption("--source <source>", "Baseline/source bot, such as git:main or workspace")
    .requiredOption("--package <path>", "Baseline/source package path within the resolved source")
    .option("--candidate-source <source>", "Candidate source for duel suites")
    .option("--candidate-package <path>", "Candidate package path for duel suites")
    .action(runExperimentSuiteCommand);

  experiment.command("list").description("List recorded experiment runs").action(listExperimentsCommand);

  experiment
    .command("show")
    .description("Show a recorded experiment suite")
    .argument("<suite-id>", "Suite identifier")
    .action(showExperimentCommand);

  experiment
    .command("watch")
    .description("Watch live status for experiment suites")
    .argument("[suite-id]", "Suite identifier to pin")
    .action(watchExperimentCommand);

  await program.parseAsync();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
