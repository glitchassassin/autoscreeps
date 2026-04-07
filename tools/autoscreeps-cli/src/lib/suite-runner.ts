import path from "node:path";

import type { RunDetails, SuiteCaseDetails, SuiteGates, SuitePrimaryMetric, SuiteRecord, SuiteSource, UserRunSummaryMetrics, VariantInput } from "./contracts.ts";
import { resolveRepoRoot } from "./git.ts";
import { appendSuiteEvent, createSuiteCaseWorkspace, createSuiteWorkspace, readSuiteDetails, writeSuiteRecord } from "./history.ts";
import { runDuelExperiment } from "./runner.ts";
import { loadScenario } from "./scenario.ts";
import { defaultSuiteGates, loadSuiteManifest, resolveSuiteCaseScenario } from "./suite-manifest.ts";
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
  source: SuiteSource;
  gates: SuiteGates;
  baseline: VariantInput;
  candidate: VariantInput;
  cases: ResolvedSuiteCase[];
};

export type SuiteRunInput = {
  cwd: string;
  manifestPath: string;
  baseline: VariantInput;
  candidate: VariantInput;
};

export type ScenarioSuiteRunInput = {
  cwd: string;
  scenarioPath: string;
  baseline: VariantInput;
  candidate: VariantInput;
};

export type SuiteHarvestModeMetric = "harvestingSourceCoveragePct" | "harvestingSourceUptimePct";
export type SuiteActiveHarvestMetric = "activeHarvestingSourceCoveragePct" | "activeHarvestingSourceUptimePct";
export type SuiteExtensionMetric = "firstExtensionTick" | "allRcl2ExtensionsTick";

type SuiteSummaryMetric = SuitePrimaryMetric | SuiteHarvestModeMetric | SuiteActiveHarvestMetric | SuiteExtensionMetric;

type MetricComparison<Metric extends string> = {
  metric: Metric;
  direction: "lower-is-better" | "higher-is-better";
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  regressionPct: number | null;
  improved: boolean | null;
  comparable: boolean;
};

export type SuiteMetricComparison = MetricComparison<SuitePrimaryMetric>;
export type SuiteHarvestModeMetricComparison = MetricComparison<SuiteHarvestModeMetric>;
export type SuiteActiveHarvestMetricComparison = MetricComparison<SuiteActiveHarvestMetric>;
export type SuiteExtensionMetricComparison = MetricComparison<SuiteExtensionMetric>;

export type SuiteCohortSummary = {
  caseCount: number;
  completedCaseCount: number;
  completionPct: number;
  primaryMetrics: Partial<Record<SuitePrimaryMetric, SuiteMetricComparison>>;
  harvestModeMetrics: Record<SuiteHarvestModeMetric, SuiteHarvestModeMetricComparison>;
  activeHarvestMetrics: Record<SuiteActiveHarvestMetric, SuiteActiveHarvestMetricComparison>;
  extensionMetrics: Record<SuiteExtensionMetric, SuiteExtensionMetricComparison>;
};

export type SuiteGateSummary = {
  passed: boolean;
  training: {
    passed: boolean;
    improvedMetrics: SuitePrimaryMetric[];
    requiredImprovedMetrics: number;
  };
  holdout: {
    passed: boolean;
    maxRegressionPct: number;
    regressions: Array<{ metric: SuitePrimaryMetric; regressionPct: number }>;
  };
};

export type SuiteSummary = {
  overall: SuiteCohortSummary;
  cohorts: Partial<Record<"train" | "holdout", SuiteCohortSummary>>;
  gates: SuiteGateSummary;
};

export type SuiteRunResult = {
  suite: SuiteRecord;
  cases: SuiteCaseDetails[];
  summary: SuiteSummary;
};

const suiteHarvestModeMetrics: SuiteHarvestModeMetric[] = ["harvestingSourceCoveragePct", "harvestingSourceUptimePct"];
const suiteActiveHarvestMetrics: SuiteActiveHarvestMetric[] = ["activeHarvestingSourceCoveragePct", "activeHarvestingSourceUptimePct"];
const suiteExtensionMetrics: SuiteExtensionMetric[] = ["firstExtensionTick", "allRcl2ExtensionsTick"];

export async function runExperimentSuite(
  input: SuiteRunInput,
  dependencies: {
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

  return runResolvedSuite({
    cwd: input.cwd,
    repoRoot,
    name: manifest.config.name,
    description: manifest.config.description,
    source: {
      kind: "manifest",
      path: path.relative(repoRoot, manifest.path)
    },
    gates: manifest.config.gates,
    baseline: input.baseline,
    candidate: input.candidate,
    cases
  }, dependencies);
}

export async function runScenarioSuite(
  input: ScenarioSuiteRunInput,
  dependencies: {
    duelRunner?: typeof runDuelExperiment;
  } = {}
): Promise<SuiteRunResult> {
  const repoRoot = await resolveExecutionRoot(input.cwd);
  const scenario = await loadScenario(input.scenarioPath);

  return runResolvedSuite({
    cwd: input.cwd,
    repoRoot,
    name: scenario.config.name,
    description: scenario.config.description,
    source: {
      kind: "scenario",
      path: path.relative(repoRoot, scenario.path)
    },
    gates: defaultSuiteGates,
    baseline: input.baseline,
    candidate: input.candidate,
    cases: [
      {
        id: "duel",
        cohort: "train",
        tags: [],
        scenario
      }
    ]
  }, dependencies);
}

export function summarizeSuiteResults(gatesOrManifest: SuiteGates | { gates: SuiteGates }, cases: SuiteCaseDetails[]): SuiteSummary {
  const gates = "gates" in gatesOrManifest ? gatesOrManifest.gates : gatesOrManifest;
  const overall = summarizeCohort(cases, gates.primaryMetrics);
  const trainCases = cases.filter((testCase) => testCase.cohort === "train");
  const holdoutCases = cases.filter((testCase) => testCase.cohort === "holdout");
  const train = trainCases.length > 0 ? summarizeCohort(trainCases, gates.primaryMetrics) : undefined;
  const holdout = holdoutCases.length > 0 ? summarizeCohort(holdoutCases, gates.primaryMetrics) : undefined;
  const gateSummary = evaluateSuiteGates(gates, train, holdout);

  return {
    overall,
    cohorts: {
      ...(train ? { train } : {}),
      ...(holdout ? { holdout } : {})
    },
    gates: gateSummary
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
    duelRunner?: typeof runDuelExperiment;
  }
): Promise<SuiteRunResult> {
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
    source: input.source,
    baseline: input.baseline,
    candidate: input.candidate,
    gates: {
      primaryMetrics: [...input.gates.primaryMetrics],
      training: { ...input.gates.training },
      holdout: { ...input.gates.holdout }
    },
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
      error: null,
      startedAt: null,
      finishedAt: null
    })),
    error: null
  };

  await writeSuiteRecord(suiteDir, suiteRecord);
  await logSuiteEvent(suiteDir, "info", "suite.created", "Created experiment suite workspace.", {
    suiteId: suiteRecord.id,
    caseCount: suiteRecord.progress.caseCount
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
        const details = await duelRunner({
          cwd: input.cwd,
          scenario: testCase.scenario,
          baseline: input.baseline,
          candidate: input.candidate,
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
        suiteCase.error = details.run.error;
        suiteCase.finishedAt = details.run.finishedAt ?? timestamp();
      } catch (error) {
        suiteCase.status = "failed";
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
    const summary = summarizeSuiteResults(details.suite.gates, details.cases);
    await logSuiteEvent(suiteDir, "info", "suite.completed", "Experiment suite completed.", {
      caseCount: details.suite.progress.caseCount,
      completedCaseCount: details.suite.progress.completedCaseCount,
      failedCaseCount: details.suite.progress.failedCaseCount,
      gatesPassed: summary.gates.passed
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

async function logSuiteEvent(suiteDir: string, level: "info" | "error", event: string, message: string, data?: unknown): Promise<void> {
  await appendSuiteEvent(suiteDir, {
    timestamp: timestamp(),
    level,
    event,
    message,
    data
  });
}

function summarizeCohort(cases: SuiteCaseDetails[], metrics: SuitePrimaryMetric[]): SuiteCohortSummary {
  const completedCaseCount = cases.filter((testCase) => testCase.status === "completed").length;
  const primaryMetrics = Object.fromEntries(metrics.map((metric) => [metric, compareMetric(cases, metric)])) as Partial<Record<SuitePrimaryMetric, SuiteMetricComparison>>;
  const harvestModeMetrics = Object.fromEntries(
    suiteHarvestModeMetrics.map((metric) => [metric, compareMetric(cases, metric)])
  ) as Record<SuiteHarvestModeMetric, SuiteHarvestModeMetricComparison>;
  const activeHarvestMetrics = Object.fromEntries(
    suiteActiveHarvestMetrics.map((metric) => [metric, compareMetric(cases, metric)])
  ) as Record<SuiteActiveHarvestMetric, SuiteActiveHarvestMetricComparison>;
  const extensionMetrics = Object.fromEntries(
    suiteExtensionMetrics.map((metric) => [metric, compareMetric(cases, metric)])
  ) as Record<SuiteExtensionMetric, SuiteExtensionMetricComparison>;

  return {
    caseCount: cases.length,
    completedCaseCount,
    completionPct: toPct(completedCaseCount, cases.length) ?? 0,
    primaryMetrics,
    harvestModeMetrics,
    activeHarvestMetrics,
    extensionMetrics
  };
}

function compareMetric<Metric extends SuiteSummaryMetric>(cases: SuiteCaseDetails[], metric: Metric): MetricComparison<Metric> {
  const direction = metricDirection(metric);
  const baselineValues = collectMetricValues(cases, "baseline", metric);
  const candidateValues = collectMetricValues(cases, "candidate", metric);
  const baseline = median(baselineValues);
  const candidate = median(candidateValues);
  const comparable = baseline !== null && candidate !== null;
  const delta = comparable ? round(candidate - baseline) : null;
  const improved = comparable ? isImproved(direction, baseline, candidate) : null;
  const regressionPct = comparable ? calculateRegressionPct(direction, baseline, candidate) : null;

  return {
    metric,
    direction,
    baseline,
    candidate,
    delta,
    regressionPct,
    improved,
    comparable
  };
}

function collectMetricValues(cases: SuiteCaseDetails[], role: "baseline" | "candidate", metric: SuiteSummaryMetric): number[] {
  const values: number[] = [];

  for (const testCase of cases) {
    if (testCase.status !== "completed") {
      continue;
    }

    const summary = testCase.details?.metrics?.summary?.users[role];
    const value = summary ? metricValue(summary, metric) : null;
    if (value !== null) {
      values.push(value);
    }
  }

  return values;
}

function evaluateSuiteGates(
  gates: SuiteGates,
  train: SuiteCohortSummary | undefined,
  holdout: SuiteCohortSummary | undefined
): SuiteGateSummary {
  const improvedMetrics = train
    ? gates.primaryMetrics.filter((metric) => train.primaryMetrics[metric]?.improved === true)
    : [];
  const trainingPassed = train ? improvedMetrics.length >= gates.training.minImprovedPrimaryMetrics : true;

  const regressions = holdout
    ? gates.primaryMetrics
      .map((metric) => ({ metric, regressionPct: holdout.primaryMetrics[metric]?.regressionPct ?? null }))
      .filter((entry): entry is { metric: SuitePrimaryMetric; regressionPct: number } => entry.regressionPct !== null && entry.regressionPct > gates.holdout.maxRegressionPct)
    : [];
  const holdoutPassed = regressions.length === 0;

  return {
    passed: trainingPassed && holdoutPassed,
    training: {
      passed: trainingPassed,
      improvedMetrics,
      requiredImprovedMetrics: gates.training.minImprovedPrimaryMetrics
    },
    holdout: {
      passed: holdoutPassed,
      maxRegressionPct: gates.holdout.maxRegressionPct,
      regressions
    }
  };
}

function metricValue(summary: UserRunSummaryMetrics, metric: SuiteSummaryMetric): number | null {
  switch (metric) {
    case "T_RCL2":
      return summary.controllerLevelMilestones["2"] ?? null;
    case "T_RCL3":
      return summary.controllerLevelMilestones["3"] ?? null;
    case "controllerProgressToRCL3Pct":
      return summary.controllerProgressToRCL3Pct;
    case "spawnIdlePct":
      return summary.spawnIdlePct;
    case "sourceCoveragePct":
      return summary.sourceCoveragePct;
    case "sourceUptimePct":
      return summary.sourceUptimePct;
    case "harvestingSourceCoveragePct":
      return summary.harvestingSourceCoveragePct;
    case "harvestingSourceUptimePct":
      return summary.harvestingSourceUptimePct;
    case "activeHarvestingSourceCoveragePct":
      return summary.activeHarvestingSourceCoveragePct;
    case "activeHarvestingSourceUptimePct":
      return summary.activeHarvestingSourceUptimePct;
    case "firstExtensionTick":
      return summary.firstExtensionTick;
    case "allRcl2ExtensionsTick":
      return summary.allRcl2ExtensionsTick;
  }
}

function metricDirection(metric: SuiteSummaryMetric): SuiteMetricComparison["direction"] {
  switch (metric) {
    case "T_RCL2":
    case "T_RCL3":
    case "spawnIdlePct":
    case "firstExtensionTick":
    case "allRcl2ExtensionsTick":
      return "lower-is-better";
    case "controllerProgressToRCL3Pct":
    case "sourceCoveragePct":
    case "sourceUptimePct":
    case "harvestingSourceCoveragePct":
    case "harvestingSourceUptimePct":
    case "activeHarvestingSourceCoveragePct":
    case "activeHarvestingSourceUptimePct":
      return "higher-is-better";
  }
}

function isImproved(direction: SuiteMetricComparison["direction"], baseline: number, candidate: number): boolean {
  return direction === "lower-is-better" ? candidate < baseline : candidate > baseline;
}

function calculateRegressionPct(direction: SuiteMetricComparison["direction"], baseline: number, candidate: number): number {
  if (direction === "lower-is-better") {
    if (candidate <= baseline) {
      return 0;
    }

    return baseline === 0 ? Number.POSITIVE_INFINITY : round(((candidate - baseline) / baseline) * 100);
  }

  if (candidate >= baseline) {
    return 0;
  }

  return baseline === 0 ? Number.POSITIVE_INFINITY : round(((baseline - candidate) / baseline) * 100);
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return round(sorted[middle]!);
  }

  return round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function toPct(value: number, total: number): number | null {
  if (total === 0) {
    return null;
  }

  return round((value / total) * 100);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
