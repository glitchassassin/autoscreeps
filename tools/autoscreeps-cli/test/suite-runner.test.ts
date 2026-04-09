import { describe, expect, it } from "vitest";
import { runExperimentSuite, summarizeSuiteResults } from "../src/lib/suite-runner.ts";
import type { SuiteManifest } from "../src/lib/suite-manifest.ts";
import type { RunDetails, SuiteCaseDetails, UserRunSummaryMetrics } from "../src/lib/contracts.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("suite runner", () => {
  it("summarizes cohort metrics and applies training and holdout gates", () => {
    const manifest: SuiteManifest = {
      version: 1,
      name: "opener-suite",
      gates: {
        primaryMetrics: ["T_RCL3", "controllerProgressToRCL3Pct", "spawnWaitingForSufficientEnergyPct", "sourceCoveragePct", "sourceUptimePct"],
        training: { minImprovedPrimaryMetrics: 2 },
        holdout: { maxRegressionPct: 5 }
      },
      cases: []
    };

    const summary = summarizeSuiteResults(manifest, [
      createCaseResult("train-a", "train", createRunDetails({
        baseline: createSummary({
          rcl3: 250,
          controllerProgressToRCL3Pct: 60,
          spawnWaitingForSufficientEnergyPct: 40,
          firstExtensionTick: 140,
          allRcl2ExtensionsTick: 180,
          sourceCoveragePct: 50,
          sourceUptimePct: 0,
          harvestingSourceCoveragePct: 45,
          harvestingSourceUptimePct: 0,
          activeHarvestingSourceCoveragePct: 20,
          activeHarvestingSourceUptimePct: 0
        }),
        candidate: createSummary({
          rcl3: 200,
          controllerProgressToRCL3Pct: 80,
          spawnWaitingForSufficientEnergyPct: 10,
          firstExtensionTick: 110,
          allRcl2ExtensionsTick: 150,
          sourceCoveragePct: 75,
          sourceUptimePct: 50,
          harvestingSourceCoveragePct: 60,
          harvestingSourceUptimePct: 25,
          activeHarvestingSourceCoveragePct: 40,
          activeHarvestingSourceUptimePct: 10
        })
      })),
      createCaseResult("holdout-a", "holdout", createRunDetails({
        baseline: createSummary({
          rcl3: 200,
          controllerProgressToRCL3Pct: 70,
          spawnWaitingForSufficientEnergyPct: 20,
          firstExtensionTick: 120,
          allRcl2ExtensionsTick: 160,
          sourceCoveragePct: 100,
          sourceUptimePct: 100,
          harvestingSourceCoveragePct: 60,
          harvestingSourceUptimePct: 40,
          activeHarvestingSourceCoveragePct: 35,
          activeHarvestingSourceUptimePct: 10
        }),
        candidate: createSummary({
          rcl3: 200,
          controllerProgressToRCL3Pct: 72,
          spawnWaitingForSufficientEnergyPct: 21,
          firstExtensionTick: 118,
          allRcl2ExtensionsTick: 150,
          sourceCoveragePct: 92,
          sourceUptimePct: 100,
          harvestingSourceCoveragePct: 57,
          harvestingSourceUptimePct: 35,
          activeHarvestingSourceCoveragePct: 30,
          activeHarvestingSourceUptimePct: 5
        })
      }))
    ]);

    expect(summary.cohorts.train?.primaryMetrics.controllerProgressToRCL3Pct.improved).toBe(true);
    expect(summary.cohorts.train?.primaryMetrics.sourceCoveragePct.improved).toBe(true);
    expect(summary.cohorts.train?.harvestModeMetrics.harvestingSourceCoveragePct).toMatchObject({
      baseline: 45,
      candidate: 60,
      improved: true
    });
    expect(summary.cohorts.holdout?.primaryMetrics.sourceCoveragePct.regressionPct).toBe(8);
    expect(summary.cohorts.holdout?.harvestModeMetrics.harvestingSourceUptimePct).toMatchObject({
      baseline: 40,
      candidate: 35,
      regressionPct: 12.5
    });
    expect(summary.cohorts.train?.activeHarvestMetrics.activeHarvestingSourceCoveragePct).toMatchObject({
      baseline: 20,
      candidate: 40,
      improved: true
    });
    expect(summary.cohorts.holdout?.activeHarvestMetrics.activeHarvestingSourceUptimePct).toMatchObject({
      baseline: 10,
      candidate: 5,
      regressionPct: 50
    });
    expect(summary.cohorts.train?.extensionMetrics.firstExtensionTick).toMatchObject({
      baseline: 140,
      candidate: 110,
      improved: true
    });
    expect(summary.cohorts.holdout?.extensionMetrics.allRcl2ExtensionsTick).toMatchObject({
      baseline: 160,
      candidate: 150,
      improved: true
    });
    expect(summary.gates.training.passed).toBe(true);
    expect(summary.gates.holdout.passed).toBe(false);
    expect(summary.gates.holdout.regressions).toEqual([
      { metric: "sourceCoveragePct", regressionPct: 8 }
    ]);
    expect(summary.gates.passed).toBe(false);
  });

  it("runs manifest cases through the duel runner and collects case results", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-suite-runner-"));

    try {
      const scenarioPath = path.join(tempDir, "duel-basic.yaml");
      const manifestPath = path.join(tempDir, "suite.yaml");
      await fs.writeFile(scenarioPath, [
        "version: 1",
        "name: duel-basic",
        "mapGenerator:",
        "  type: mirrored-random-1x1",
        "run:",
        "  maxTicks: 200"
      ].join("\n"), "utf8");
      await fs.writeFile(manifestPath, [
        "version: 1",
        "name: suite-runner",
        "gates:",
        "  training:",
        "    minImprovedPrimaryMetrics: 0",
        "cases:",
        "  - id: train-a",
        "    scenario: ./duel-basic.yaml",
        "    overrides:",
        "      mapGenerator:",
        "        sourceMapId: alpha"
      ].join("\n"), "utf8");

      const duelRunnerCalls: string[] = [];
      const result = await runExperimentSuite({
        cwd: tempDir,
        manifestPath,
        baseline: { source: "workspace", packagePath: "bots/basic" },
        candidate: { source: "workspace", packagePath: "bots/basic" }
      }, {
        duelRunner: async (input) => {
          duelRunnerCalls.push(input.scenario.config.name);
          expect(input.scenario.config.mapGenerator?.sourceMapId).toBe("alpha");
          return createRunDetails({
            runId: "run-train-a",
            scenarioName: input.scenario.config.name,
            baseline: createSummary({
              rcl3: 200,
              controllerProgressToRCL3Pct: 30,
               spawnWaitingForSufficientEnergyPct: 25,
              firstExtensionTick: 120,
              allRcl2ExtensionsTick: 150,
              sourceCoveragePct: 50,
              sourceUptimePct: 0
            }),
            candidate: createSummary({
              rcl3: 200,
              controllerProgressToRCL3Pct: 30,
               spawnWaitingForSufficientEnergyPct: 25,
              firstExtensionTick: 120,
              allRcl2ExtensionsTick: 150,
              sourceCoveragePct: 50,
              sourceUptimePct: 0
            })
          });
        }
      });

      expect(duelRunnerCalls).toEqual(["suite-runner:train-a"]);
      expect(result.suite).toMatchObject({
        name: "suite-runner",
        status: "completed",
        progress: {
          caseCount: 1,
          completedCaseCount: 1,
          failedCaseCount: 0
        }
      });
      expect(result.cases).toHaveLength(1);
      expect(result.cases[0]).toMatchObject({
        id: "train-a",
        status: "completed"
      });
      expect(result.cases[0]?.runId).toMatch(/^\d{4}-/);
      expect(result.cases[0]?.details).toBeNull();
      expect(result.summary.gates.training.passed).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

function createCaseResult(id: string, cohort: "train" | "holdout", details: RunDetails): SuiteCaseDetails {
  return {
    id,
    cohort,
    caseIndex: 1,
    tags: [],
    scenarioPath: "./duel-basic.yaml",
    scenarioName: details.run.scenarioName,
    runId: details.run.id,
    status: details.run.status === "completed" ? "completed" : "failed",
    error: details.run.error,
    startedAt: details.run.startedAt,
    finishedAt: details.run.finishedAt,
    details
  };
}

function createRunDetails(input: {
  runId?: string;
  scenarioName?: string;
  baseline: UserRunSummaryMetrics;
  candidate: UserRunSummaryMetrics;
}): RunDetails {
  return {
    run: {
      id: input.runId ?? "run-1",
      type: "duel",
      status: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      finishedAt: "2026-01-01T00:00:02.000Z",
      repoRoot: "/repo",
      scenarioPath: "experiments/scenarios/duel-basic.yaml",
      scenarioName: input.scenarioName ?? "duel-basic",
      rooms: {
        baseline: "W0N0",
        candidate: "E0N0"
      },
      run: {
        tickDuration: 250,
        maxTicks: 200,
        sampleEveryTicks: 25,
        pollIntervalMs: 1000,
        map: "generated:mirrored-random-1x1:alpha",
        startGameTime: 1,
        endGameTime: 201,
        terminalConditions: null,
        terminationReason: "max-ticks"
      },
      server: {
        httpUrl: "http://127.0.0.1:21025",
        cliHost: "127.0.0.1",
        cliPort: 21026
      },
      error: null
    },
    variants: null,
    metrics: {
      users: {
        baseline: {
          status: "normal",
          ownedControllers: 1,
          combinedRCL: 1,
          maxOwnedControllerLevel: 1,
          rcl: { "1": 1 },
          terminal: null
        },
        candidate: {
          status: "normal",
          ownedControllers: 1,
          combinedRCL: 1,
          maxOwnedControllerLevel: 1,
          rcl: { "1": 1 },
          terminal: null
        }
      },
      rooms: {
        baseline: {
          room: "W0N0",
          totalObjects: 0,
          typeCounts: {},
          owners: {},
          controllerOwners: [],
          spawnOwners: []
        },
        candidate: {
          room: "E0N0",
          totalObjects: 0,
          typeCounts: {},
          owners: {},
          controllerOwners: [],
          spawnOwners: []
        }
      },
      summary: {
        sampleEveryTicks: 25,
        users: {
          baseline: input.baseline,
          candidate: input.candidate
        }
      }
    },
    samples: null
  };
}

function createSummary(input: {
  rcl3: number | null;
  controllerProgressToRCL3Pct: number | null;
  spawnWaitingForSufficientEnergyPct: number | null;
  firstExtensionTick: number | null;
  allRcl2ExtensionsTick: number | null;
  sourceCoveragePct: number | null;
  sourceUptimePct: number | null;
  harvestingSourceCoveragePct?: number | null;
  harvestingSourceUptimePct?: number | null;
  activeHarvestingSourceCoveragePct?: number | null;
  activeHarvestingSourceUptimePct?: number | null;
}): UserRunSummaryMetrics {
  return {
    sampleCount: 4,
    firstSeenGameTime: 1,
    controllerLevelMilestones: {
      "1": 1,
      "2": input.controllerProgressToRCL3Pct !== null ? 100 : null,
      "3": input.rcl3,
      "4": null,
      "5": null,
      "6": null,
      "7": null,
      "8": null
    },
    controllerProgressToRCL3Pct: input.controllerProgressToRCL3Pct,
    maxCombinedRCL: 3,
    maxOwnedControllers: 1,
    firstExtensionTick: input.firstExtensionTick,
    allRcl2ExtensionsTick: input.allRcl2ExtensionsTick,
    telemetrySampleCount: 4,
    spawnWaitingForSufficientEnergyPct: input.spawnWaitingForSufficientEnergyPct,
    sourceCoveragePct: input.sourceCoveragePct,
    sourceUptimePct: input.sourceUptimePct,
    harvestingSourceCoveragePct: input.harvestingSourceCoveragePct ?? input.sourceCoveragePct,
    harvestingSourceUptimePct: input.harvestingSourceUptimePct ?? input.sourceUptimePct,
    activeHarvestingSourceCoveragePct: input.activeHarvestingSourceCoveragePct ?? input.harvestingSourceCoveragePct ?? input.sourceCoveragePct,
    activeHarvestingSourceUptimePct: input.activeHarvestingSourceUptimePct ?? input.harvestingSourceUptimePct ?? input.sourceUptimePct
  };
}
