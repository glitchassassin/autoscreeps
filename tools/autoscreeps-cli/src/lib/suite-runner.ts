import path from "node:path";

import type { RunType, SuiteCaseDetails, SuiteRecord, SuiteSource, VariantInput } from "./contracts.ts";
import { resolveRepoRoot } from "./git.ts";
import { appendSuiteEvent, createSuiteCaseWorkspace, createSuiteWorkspace, readSuiteDetails, writeSuiteRecord } from "./history.ts";
import { runDuelExperiment, runSingleExperiment } from "./runner.ts";
import { loadScenario } from "./scenario.ts";
import { loadSuiteManifest, resolveSuiteCaseScenario } from "./suite-manifest.ts";
import { timestamp } from "./utils.ts";

type ResolvedScenario = Awaited<ReturnType<typeof loadScenario>>;

type ResolvedSuiteCase = {
  id: string;
  cohort: "train" | "holdout";
  tags: string[];
  scenario: ResolvedScenario;
};

type ResolvedSuiteInput = {
  cwd: string;
  repoRoot: string;
  name: string;
  description?: string;
  mode: RunType;
  source: SuiteSource;
  baseline: VariantInput;
  candidate?: VariantInput;
  cases: ResolvedSuiteCase[];
};

export type SuiteRunInput = {
  cwd: string;
  manifestPath: string;
  baseline: VariantInput;
  candidate?: VariantInput;
};

export type ScenarioSuiteRunInput = {
  cwd: string;
  scenarioPath: string;
  baseline: VariantInput;
  candidate?: VariantInput;
};

export type SuiteCohortSummary = {
  caseCount: number;
  completedCaseCount: number;
  failedCaseCount: number;
  passedCaseCount: number;
  completionPct: number;
};

export type SuiteVerdict = "suite-passed" | "suite-failed";

export type SuiteSummary = {
  overall: SuiteCohortSummary;
  cohorts: Partial<Record<"train" | "holdout", SuiteCohortSummary>>;
  verdict: SuiteVerdict;
};

export type SuiteRunResult = {
  suite: SuiteRecord;
  cases: SuiteCaseDetails[];
  summary: SuiteSummary;
};

export async function runExperimentSuite(
  input: SuiteRunInput,
  dependencies: {
    singleRunner?: typeof runSingleExperiment;
    duelRunner?: typeof runDuelExperiment;
  } = {}
): Promise<SuiteRunResult> {
  const repoRoot = await resolveExecutionRoot(input.cwd);
  const manifest = await loadSuiteManifest(input.manifestPath);
  const cases = await Promise.all(
    manifest.config.cases.map(async (testCase) => ({
      id: testCase.id,
      cohort: testCase.cohort,
      tags: [...testCase.tags],
      scenario: await resolveSuiteCaseScenario(manifest, testCase)
    }))
  );

  if (manifest.config.mode === "duel" && !input.candidate) {
    throw new Error("Duel suites require a candidate variant.");
  }

  return runResolvedSuite({
    cwd: input.cwd,
    repoRoot,
    name: manifest.config.name,
    description: manifest.config.description,
    mode: manifest.config.mode,
    source: {
      kind: "manifest",
      path: path.relative(repoRoot, manifest.path)
    },
    baseline: input.baseline,
    candidate: manifest.config.mode === "duel" ? input.candidate : undefined,
    cases
  }, dependencies);
}

export async function runScenarioSuite(
  input: ScenarioSuiteRunInput,
  dependencies: {
    singleRunner?: typeof runSingleExperiment;
    duelRunner?: typeof runDuelExperiment;
  } = {}
): Promise<SuiteRunResult> {
  const repoRoot = await resolveExecutionRoot(input.cwd);
  const scenario = await loadScenario(input.scenarioPath);
  const mode: RunType = input.candidate ? "duel" : "single";

  return runResolvedSuite({
    cwd: input.cwd,
    repoRoot,
    name: scenario.config.name,
    description: scenario.config.description,
    mode,
    source: {
      kind: "scenario",
      path: path.relative(repoRoot, scenario.path)
    },
    baseline: input.baseline,
    candidate: input.candidate,
    cases: [
      {
        id: "run",
        cohort: "train",
        tags: [],
        scenario
      }
    ]
  }, dependencies);
}

export function summarizeSuiteResults(cases: SuiteCaseDetails[]): SuiteSummary {
  const overall = summarizeCohort(cases);
  const trainCases = cases.filter((testCase) => testCase.cohort === "train");
  const holdoutCases = cases.filter((testCase) => testCase.cohort === "holdout");

  return {
    overall,
    cohorts: {
      ...(trainCases.length > 0 ? { train: summarizeCohort(trainCases) } : {}),
      ...(holdoutCases.length > 0 ? { holdout: summarizeCohort(holdoutCases) } : {})
    },
    verdict: overall.failedCaseCount > 0 ? "suite-failed" : "suite-passed"
  };
}

async function resolveExecutionRoot(cwd: string): Promise<string> {
  try {
    return await resolveRepoRoot(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

async function runResolvedSuite(
  input: ResolvedSuiteInput,
  dependencies: {
    singleRunner?: typeof runSingleExperiment;
    duelRunner?: typeof runDuelExperiment;
  }
): Promise<SuiteRunResult> {
  const singleRunner = dependencies.singleRunner ?? runSingleExperiment;
  const duelRunner = dependencies.duelRunner ?? runDuelExperiment;
  const { suiteId, suiteDir } = await createSuiteWorkspace(input.repoRoot);
  const suiteRecord: SuiteRecord = {
    id: suiteId,
    type: "suite",
    status: "running",
    createdAt: timestamp(),
    startedAt: null,
    finishedAt: null,
    repoRoot: input.repoRoot,
    name: input.name,
    description: input.description,
    mode: input.mode,
    source: input.source,
    baseline: input.baseline,
    ...(input.candidate ? { candidate: input.candidate } : {}),
    progress: {
      caseCount: input.cases.length,
      completedCaseCount: 0,
      failedCaseCount: 0,
      currentCaseId: null,
      currentCaseRunId: null
    },
    cases: input.cases.map((testCase, index) => ({
      id: testCase.id,
      cohort: testCase.cohort,
      caseIndex: index + 1,
      tags: [...testCase.tags],
      scenarioPath: path.relative(input.repoRoot, testCase.scenario.path),
      scenarioName: testCase.scenario.config.name,
      runId: null,
      status: "pending",
      failureKind: null,
      error: null,
      startedAt: null,
      finishedAt: null
    })),
    error: null
  };

  await writeSuiteRecord(suiteDir, suiteRecord);
  await logSuiteEvent(suiteDir, "info", "suite.created", "Created experiment suite workspace.", {
    suiteId: suiteRecord.id,
    caseCount: suiteRecord.progress.caseCount,
    mode: suiteRecord.mode
  });

  try {
    for (const [index, testCase] of input.cases.entries()) {
      const suiteCase = suiteRecord.cases[index]!;
      const { runId, runDir } = await createSuiteCaseWorkspace(suiteDir);

      if (suiteRecord.startedAt === null) {
        suiteRecord.startedAt = timestamp();
      }

      suiteRecord.progress.currentCaseId = suiteCase.id;
      suiteRecord.progress.currentCaseRunId = runId;
      suiteCase.runId = runId;
      suiteCase.status = "running";
      suiteCase.error = null;
      suiteCase.startedAt = timestamp();
      suiteCase.finishedAt = null;
      await writeSuiteRecord(suiteDir, suiteRecord);
      await logSuiteEvent(suiteDir, "info", "suite.case.started", "Started suite case.", {
        caseId: suiteCase.id,
        caseIndex: suiteCase.caseIndex,
        caseCount: suiteRecord.progress.caseCount,
        runId
      });

      try {
        const details = input.mode === "duel"
          ? await duelRunner({
            cwd: input.cwd,
            scenario: testCase.scenario,
            baseline: input.baseline,
            candidate: input.candidate!,
            runWorkspace: {
              runId,
              runDir
            },
            suite: {
              id: suiteRecord.id,
              name: suiteRecord.name,
              caseId: suiteCase.id,
              cohort: suiteCase.cohort,
              caseIndex: suiteCase.caseIndex,
              caseCount: suiteRecord.progress.caseCount
            }
          })
          : await singleRunner({
            cwd: input.cwd,
            scenario: testCase.scenario,
            variant: input.baseline,
            runWorkspace: {
              runId,
              runDir
            },
            suite: {
              id: suiteRecord.id,
              name: suiteRecord.name,
              caseId: suiteCase.id,
              cohort: suiteCase.cohort,
              caseIndex: suiteCase.caseIndex,
              caseCount: suiteRecord.progress.caseCount
            }
          });

        suiteCase.status = details.run.status === "completed" ? "completed" : "failed";
        suiteCase.failureKind = details.run.failureKind ?? null;
        suiteCase.error = details.run.error;
        suiteCase.finishedAt = details.run.finishedAt ?? timestamp();
      } catch (error) {
        suiteCase.status = "failed";
        suiteCase.failureKind = "execution";
        suiteCase.error = error instanceof Error ? error.message : String(error);
        suiteCase.finishedAt = timestamp();
      }

      suiteRecord.progress.currentCaseId = null;
      suiteRecord.progress.currentCaseRunId = null;
      refreshSuiteProgress(suiteRecord);
      await writeSuiteRecord(suiteDir, suiteRecord);
      await logSuiteEvent(
        suiteDir,
        suiteCase.status === "failed" ? "error" : "info",
        suiteCase.status === "failed" ? "suite.case.failed" : "suite.case.completed",
        suiteCase.status === "failed" ? "Suite case failed." : "Suite case completed.",
        {
          caseId: suiteCase.id,
          runId: suiteCase.runId,
          completedCaseCount: suiteRecord.progress.completedCaseCount,
          failedCaseCount: suiteRecord.progress.failedCaseCount
        }
      );
    }

    suiteRecord.status = "completed";
    suiteRecord.finishedAt = timestamp();
    await writeSuiteRecord(suiteDir, suiteRecord);

    const details = await readSuiteDetails(input.repoRoot, suiteRecord.id);
    const summary = summarizeSuiteResults(details.cases);
    await logSuiteEvent(suiteDir, "info", "suite.completed", "Experiment suite completed.", {
      caseCount: details.suite.progress.caseCount,
      completedCaseCount: details.suite.progress.completedCaseCount,
      failedCaseCount: details.suite.progress.failedCaseCount,
      verdict: summary.verdict
    });

    return {
      suite: details.suite,
      cases: details.cases,
      summary
    };
  } catch (error) {
    suiteRecord.status = "failed";
    suiteRecord.finishedAt = timestamp();
    suiteRecord.progress.currentCaseId = null;
    suiteRecord.progress.currentCaseRunId = null;
    suiteRecord.error = error instanceof Error ? error.stack ?? error.message : String(error);
    await writeSuiteRecord(suiteDir, suiteRecord);
    await logSuiteEvent(suiteDir, "error", "suite.failed", "Experiment suite failed.", {
      error: suiteRecord.error
    });
    throw error;
  }
}

function refreshSuiteProgress(suiteRecord: SuiteRecord): void {
  suiteRecord.progress.completedCaseCount = suiteRecord.cases.filter((testCase) => testCase.status === "completed").length;
  suiteRecord.progress.failedCaseCount = suiteRecord.cases.filter((testCase) => testCase.status === "failed").length;
}

function summarizeCohort(cases: SuiteCaseDetails[]): SuiteCohortSummary {
  const completedCaseCount = cases.filter((testCase) => testCase.status === "completed").length;
  const failedCaseCount = cases.filter((testCase) => testCase.status === "failed").length;

  return {
    caseCount: cases.length,
    completedCaseCount,
    failedCaseCount,
    passedCaseCount: completedCaseCount,
    completionPct: toPct(completedCaseCount + failedCaseCount, cases.length) ?? 0
  };
}

async function logSuiteEvent(suiteDir: string, level: "info" | "error", event: string, message: string, data?: unknown): Promise<void> {
  await appendSuiteEvent(suiteDir, {
    timestamp: timestamp(),
    level,
    event,
    message,
    data
  });
}

function toPct(value: number, total: number): number | null {
  if (total === 0) {
    return null;
  }

  return Math.round((value / total) * 10000) / 100;
}
