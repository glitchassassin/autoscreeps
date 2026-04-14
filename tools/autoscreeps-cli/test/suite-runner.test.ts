import { describe, expect, it } from "vitest";
import { runExperimentSuite, summarizeSuiteResults } from "../src/lib/suite-runner.ts";
import type { RunDetails, SuiteCaseDetails } from "../src/lib/contracts.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("suite runner", () => {
  it("summarizes case outcomes without gates", () => {
    const summary = summarizeSuiteResults([
      createCaseResult("train-a", "train", createRunDetails({ status: "completed" })),
      createCaseResult("holdout-a", "holdout", createRunDetails({ status: "failed", failureKind: "scenario" }))
    ]);

    expect(summary.overall).toEqual({
      caseCount: 2,
      completedCaseCount: 1,
      failedCaseCount: 1,
      passedCaseCount: 1,
      completionPct: 100
    });
    expect(summary.cohorts.train).toMatchObject({
      caseCount: 1,
      completedCaseCount: 1,
      failedCaseCount: 0
    });
    expect(summary.cohorts.holdout).toMatchObject({
      caseCount: 1,
      completedCaseCount: 0,
      failedCaseCount: 1
    });
    expect(summary.verdict).toBe("suite-failed");
  });

  it("runs single-mode manifest cases through the single runner", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-suite-runner-"));

    try {
      const scenarioPath = path.join(tempDir, "single-basic.yaml");
      const manifestPath = path.join(tempDir, "suite.yaml");
      await fs.writeFile(scenarioPath, [
        "version: 1",
        "name: single-basic",
        "mapGenerator:",
        "  type: mirrored-random-1x1",
        "run:",
        "  maxTicks: 200"
      ].join("\n"), "utf8");
      await fs.writeFile(manifestPath, [
        "version: 1",
        "name: suite-runner",
        "cases:",
        "  - id: train-a",
        "    scenario: ./single-basic.yaml"
      ].join("\n"), "utf8");

      const singleRunnerCalls: string[] = [];
      const result = await runExperimentSuite({
        cwd: tempDir,
        manifestPath,
        baseline: { source: "workspace", packagePath: "bots/basic" }
      }, {
        singleRunner: async (input) => {
          singleRunnerCalls.push(input.scenario.config.name);
          return createRunDetails({
            runId: "run-train-a",
            scenarioName: input.scenario.config.name,
            status: "completed",
            type: "single"
          });
        }
      });

      expect(singleRunnerCalls).toEqual(["suite-runner:train-a"]);
      expect(result.suite).toMatchObject({
        name: "suite-runner",
        mode: "single",
        status: "completed",
        progress: {
          caseCount: 1,
          completedCaseCount: 1,
          failedCaseCount: 0
        }
      });
      expect(result.summary.verdict).toBe("suite-passed");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("runs duel-mode manifest cases through the duel runner", async () => {
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
        "name: duel-suite",
        "mode: duel",
        "cases:",
        "  - id: compare-a",
        "    scenario: ./duel-basic.yaml",
        "    overrides:",
        "      mapGenerator:",
        "        sourceMapId: alpha"
      ].join("\n"), "utf8");

      const duelRunnerCalls: string[] = [];
      const result = await runExperimentSuite({
        cwd: tempDir,
        manifestPath,
        baseline: { source: "git:main", packagePath: "bots/basic" },
        candidate: { source: "workspace", packagePath: "bots/basic" }
      }, {
        duelRunner: async (input) => {
          duelRunnerCalls.push(input.scenario.config.name);
          expect(input.scenario.config.mapGenerator?.sourceMapId).toBe("alpha");
          return createRunDetails({
            runId: "run-compare-a",
            scenarioName: input.scenario.config.name,
            status: "failed",
            failureKind: "scenario",
            type: "duel"
          });
        }
      });

      expect(duelRunnerCalls).toEqual(["duel-suite:compare-a"]);
      expect(result.suite).toMatchObject({
        name: "duel-suite",
        mode: "duel",
        status: "completed",
        progress: {
          caseCount: 1,
          completedCaseCount: 0,
          failedCaseCount: 1
        }
      });
      expect(result.summary.verdict).toBe("suite-failed");
      expect(result.cases[0]).toMatchObject({
        id: "compare-a",
        status: "failed",
        failureKind: "scenario"
      });
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
    scenarioPath: "./scenario.yaml",
    scenarioName: details.run.scenarioName,
    runId: details.run.id,
    status: details.run.status === "completed" ? "completed" : "failed",
    failureKind: details.run.failureKind,
    error: details.run.error,
    startedAt: details.run.startedAt,
    finishedAt: details.run.finishedAt,
    details
  };
}

function createRunDetails(input: {
  runId?: string;
  scenarioName?: string;
  status: "completed" | "failed";
  failureKind?: "report" | "bot" | "scenario" | "execution" | null;
  type?: "single" | "duel";
}): RunDetails {
  return {
    run: {
      id: input.runId ?? "run-1",
      type: input.type ?? "duel",
      status: input.status,
      failureKind: input.failureKind ?? null,
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      finishedAt: "2026-01-01T00:00:02.000Z",
      repoRoot: "/repo",
      scenarioPath: "e2e/scenarios/basic.yaml",
      scenarioName: input.scenarioName ?? "basic",
      rooms: {
        baseline: "W0N0",
        ...(input.type === "duel" ? { candidate: "E0N0" } : {})
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
    metrics: null,
    samples: null
  };
}
