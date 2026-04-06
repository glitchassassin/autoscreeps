import type { RunDetails, UserRunSummaryMetrics } from "./contracts.ts";
import { runDuelExperiment } from "./runner.ts";
import { loadSuiteManifest, resolveSuiteCaseScenario, type SuiteManifest, type SuitePrimaryMetric } from "./suite-manifest.ts";

type DuelVariantInput = {
  source: string;
  packagePath: string;
};

export type SuiteRunInput = {
  cwd: string;
  manifestPath: string;
  baseline: DuelVariantInput;
  candidate: DuelVariantInput;
};

export type SuiteCaseResult = {
  id: string;
  cohort: "train" | "holdout";
  scenarioPath: string;
  scenarioName: string | null;
  runId: string | null;
  status: "completed" | "failed";
  error: string | null;
  details: RunDetails | null;
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
  primaryMetrics: Record<SuitePrimaryMetric, SuiteMetricComparison>;
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

export type SuiteRunResult = {
  manifest: {
    path: string;
    name: string;
    description?: string;
  };
  baseline: DuelVariantInput;
  candidate: DuelVariantInput;
  cases: SuiteCaseResult[];
  summary: {
    overall: SuiteCohortSummary;
    cohorts: Partial<Record<"train" | "holdout", SuiteCohortSummary>>;
    gates: SuiteGateSummary;
  };
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
  const manifest = await loadSuiteManifest(input.manifestPath);
  const duelRunner = dependencies.duelRunner ?? runDuelExperiment;
  const cases: SuiteCaseResult[] = [];

  for (const testCase of manifest.config.cases) {
    try {
      const scenario = await resolveSuiteCaseScenario(manifest, testCase);
      const details = await duelRunner({
        cwd: input.cwd,
        scenario,
        baseline: input.baseline,
        candidate: input.candidate
      });

      cases.push({
        id: testCase.id,
        cohort: testCase.cohort,
        scenarioPath: testCase.scenario,
        scenarioName: details.run.scenarioName,
        runId: details.run.id,
        status: details.run.status === "completed" ? "completed" : "failed",
        error: details.run.error,
        details
      });
    } catch (error) {
      cases.push({
        id: testCase.id,
        cohort: testCase.cohort,
        scenarioPath: testCase.scenario,
        scenarioName: null,
        runId: null,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        details: null
      });
    }
  }

  return {
    manifest: {
      path: manifest.path,
      name: manifest.config.name,
      description: manifest.config.description
    },
    baseline: input.baseline,
    candidate: input.candidate,
    cases,
    summary: summarizeSuiteResults(manifest.config, cases)
  };
}

export function summarizeSuiteResults(manifest: SuiteManifest, cases: SuiteCaseResult[]): SuiteRunResult["summary"] {
  const overall = summarizeCohort(cases, manifest.gates.primaryMetrics);
  const trainCases = cases.filter((testCase) => testCase.cohort === "train");
  const holdoutCases = cases.filter((testCase) => testCase.cohort === "holdout");
  const train = trainCases.length > 0 ? summarizeCohort(trainCases, manifest.gates.primaryMetrics) : undefined;
  const holdout = holdoutCases.length > 0 ? summarizeCohort(holdoutCases, manifest.gates.primaryMetrics) : undefined;
  const gates = evaluateSuiteGates(manifest, train, holdout);

  return {
    overall,
    cohorts: {
      ...(train ? { train } : {}),
      ...(holdout ? { holdout } : {})
    },
    gates
  };
}

function summarizeCohort(cases: SuiteCaseResult[], metrics: SuitePrimaryMetric[]): SuiteCohortSummary {
  const completedCaseCount = cases.filter((testCase) => testCase.status === "completed").length;
  const primaryMetrics = Object.fromEntries(metrics.map((metric) => [metric, compareMetric(cases, metric)])) as Record<SuitePrimaryMetric, SuiteMetricComparison>;
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

function compareMetric<Metric extends SuiteSummaryMetric>(cases: SuiteCaseResult[], metric: Metric): MetricComparison<Metric> {
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

function collectMetricValues(cases: SuiteCaseResult[], role: "baseline" | "candidate", metric: SuiteSummaryMetric): number[] {
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
  manifest: SuiteManifest,
  train: SuiteCohortSummary | undefined,
  holdout: SuiteCohortSummary | undefined
): SuiteGateSummary {
  const improvedMetrics = train
    ? manifest.gates.primaryMetrics.filter((metric) => train.primaryMetrics[metric].improved === true)
    : [];
  const trainingPassed = train ? improvedMetrics.length >= manifest.gates.training.minImprovedPrimaryMetrics : true;

  const regressions = holdout
    ? manifest.gates.primaryMetrics
      .map((metric) => ({ metric, regressionPct: holdout.primaryMetrics[metric].regressionPct }))
      .filter((entry): entry is { metric: SuitePrimaryMetric; regressionPct: number } => entry.regressionPct !== null && entry.regressionPct > manifest.gates.holdout.maxRegressionPct)
    : [];
  const holdoutPassed = regressions.length === 0;

  return {
    passed: trainingPassed && holdoutPassed,
    training: {
      passed: trainingPassed,
      improvedMetrics,
      requiredImprovedMetrics: manifest.gates.training.minImprovedPrimaryMetrics
    },
    holdout: {
      passed: holdoutPassed,
      maxRegressionPct: manifest.gates.holdout.maxRegressionPct,
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
