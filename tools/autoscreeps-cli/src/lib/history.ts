import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { EventRecord, RunDetails, RunIndexEntry, RunMetrics, RunRecord, RunSample, SuiteDetails, SuiteIndexEntry, SuiteRecord, UserRunSummaryMetrics, VariantRecord } from "./contracts.ts";
import { createRunId, ensureDirectory } from "./utils.ts";

const indexFileName = "index.jsonl";

export function resolveHistoryRoot(repoRoot: string): string {
  return path.join(repoRoot, ".autoscreeps", "runs");
}

export function resolveRunDir(repoRoot: string, runId: string): string {
  return path.join(resolveHistoryRoot(repoRoot), runId);
}

export function resolveSuitesRoot(repoRoot: string): string {
  return path.join(repoRoot, ".autoscreeps", "suites");
}

export function resolveSuiteDir(repoRoot: string, suiteId: string): string {
  return path.join(resolveSuitesRoot(repoRoot), suiteId);
}

export function resolveSuiteCaseRunDir(repoRoot: string, suiteId: string, runId: string): string {
  return path.join(resolveSuiteDir(repoRoot, suiteId), "cases", runId);
}

export async function createRunWorkspace(repoRoot: string): Promise<{ historyRoot: string; runId: string; runDir: string }> {
  const historyRoot = resolveHistoryRoot(repoRoot);
  const runId = createRunId();
  const runDir = path.join(historyRoot, runId);

  await ensureDirectory(runDir);

  return {
    historyRoot,
    runId,
    runDir
  };
}

export async function createSuiteWorkspace(repoRoot: string): Promise<{ suitesRoot: string; suiteId: string; suiteDir: string }> {
  const suitesRoot = resolveSuitesRoot(repoRoot);
  const suiteId = createRunId();
  const suiteDir = path.join(suitesRoot, suiteId);

  await ensureDirectory(path.join(suiteDir, "cases"));

  return {
    suitesRoot,
    suiteId,
    suiteDir
  };
}

export async function createSuiteCaseWorkspace(suiteDir: string): Promise<{ runId: string; runDir: string }> {
  const runId = createRunId();
  const runDir = path.join(suiteDir, "cases", runId);

  await ensureDirectory(runDir);

  return {
    runId,
    runDir
  };
}

export async function writeRunRecord(runDir: string, record: RunRecord): Promise<void> {
  await writeJson(path.join(runDir, "run.json"), record);
}

export async function writeSuiteRecord(suiteDir: string, record: SuiteRecord): Promise<void> {
  await writeJson(path.join(suiteDir, "suite.json"), record);
}

export async function writeVariantRecords(runDir: string, variants: Record<"baseline" | "candidate", VariantRecord>): Promise<void> {
  await writeJson(path.join(runDir, "variants.json"), variants);
}

export async function writeMetrics(runDir: string, metrics: RunMetrics): Promise<void> {
  await writeJson(path.join(runDir, "metrics.json"), metrics);
}

export async function appendRunSample(runDir: string, sample: RunSample): Promise<void> {
  await fs.appendFile(path.join(runDir, "samples.jsonl"), `${JSON.stringify(sample)}\n`, "utf8");
}

export async function appendEvent(runDir: string, event: EventRecord): Promise<void> {
  await fs.appendFile(path.join(runDir, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
}

export async function appendSuiteEvent(suiteDir: string, event: EventRecord): Promise<void> {
  await appendEvent(suiteDir, event);
}

export async function appendIndexEntry(historyRoot: string, entry: RunIndexEntry): Promise<void> {
  await ensureDirectory(historyRoot);
  await fs.appendFile(path.join(historyRoot, indexFileName), `${JSON.stringify(entry)}\n`, "utf8");
}

export async function listRuns(repoRoot: string): Promise<RunIndexEntry[]> {
  const historyRoot = resolveHistoryRoot(repoRoot);
  const filePath = path.join(historyRoot, indexFileName);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as RunIndexEntry)
      .reverse();
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function listRunRecords(repoRoot: string): Promise<RunRecord[]> {
  const historyRoot = resolveHistoryRoot(repoRoot);

  let entries: Dirent[];
  try {
    entries = await fs.readdir(historyRoot, { withFileTypes: true });
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const runs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          return (await readJson(path.join(historyRoot, entry.name, "run.json"))) as RunRecord;
        } catch (error) {
          if (shouldIgnoreTransientJsonError(error)) {
            return null;
          }
          throw error;
        }
      })
  );

  return runs.filter((run): run is RunRecord => run !== null).sort(compareRunsNewestFirst);
}

export async function listSuites(repoRoot: string): Promise<SuiteIndexEntry[]> {
  const suitesRoot = resolveSuitesRoot(repoRoot);

  let entries: Dirent[];
  try {
    entries = await fs.readdir(suitesRoot, { withFileTypes: true });
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const suites = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          return normalizeSuiteRecord((await readJson(path.join(suitesRoot, entry.name, "suite.json"))) as SuiteRecord);
        } catch (error) {
          if (shouldIgnoreTransientJsonError(error)) {
            return null;
          }
          throw error;
        }
      })
  );

  return suites
    .filter((suite): suite is SuiteRecord => suite !== null)
    .sort(compareSuitesNewestFirst)
    .map((suite) => ({
      id: suite.id,
      status: suite.status,
      createdAt: suite.createdAt,
      finishedAt: suite.finishedAt,
      name: suite.name,
      progress: suite.progress
    }));
}

export async function readRunDetails(repoRoot: string, runId: string): Promise<RunDetails> {
  return readCaseRunDetails(resolveRunDir(repoRoot, runId));
}

export async function readCaseRunDetails(runDir: string): Promise<RunDetails> {
  const run = (await readJson(path.join(runDir, "run.json"))) as RunRecord;
  const variantsPath = path.join(runDir, "variants.json");
  const metricsPath = path.join(runDir, "metrics.json");
  const samplesPath = path.join(runDir, "samples.jsonl");

  let variants: Record<"baseline" | "candidate", VariantRecord> | null = null;
  let metrics: RunMetrics | null = null;
  let samples: RunSample[] | null = null;

  try {
    variants = (await readJson(variantsPath)) as Record<"baseline" | "candidate", VariantRecord>;
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    metrics = normalizeRunMetrics((await readJson(metricsPath)) as RunMetrics);
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    samples = await readJsonLines<RunSample>(samplesPath);
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code !== "ENOENT") {
      throw error;
    }
  }

  return {
    run,
    variants,
    metrics,
    samples
  };
}

export async function readSuiteRecord(repoRoot: string, suiteId: string): Promise<SuiteRecord> {
  return normalizeSuiteRecord((await readJson(path.join(resolveSuiteDir(repoRoot, suiteId), "suite.json"))) as SuiteRecord);
}

export async function readSuiteDetails(repoRoot: string, suiteId: string): Promise<SuiteDetails> {
  const suite = await readSuiteRecord(repoRoot, suiteId);
  const cases = await Promise.all(
    suite.cases.map(async (testCase) => ({
      ...testCase,
      details: testCase.runId === null
        ? null
        : await readCaseRunDetailsOrNull(resolveSuiteCaseRunDir(repoRoot, suite.id, testCase.runId))
    }))
  );

  return {
    suite,
    cases
  };
}

export async function readEventTail(runDir: string, limit: number): Promise<EventRecord[]> {
  return (await readEvents(runDir)).slice(-limit);
}

export async function readEvents(runDir: string): Promise<EventRecord[]> {
  const filePath = path.join(runDir, "events.jsonl");

  try {
    return await readJsonLines<EventRecord>(filePath);
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const items: T[] = [];

  for (const line of raw.split("\n")) {
    if (line.length === 0) {
      continue;
    }

    try {
      items.push(JSON.parse(line) as T);
    } catch (error) {
      if (error instanceof SyntaxError) {
        continue;
      }
      throw error;
    }
  }

  return items;
}

function normalizeSuiteRecord(record: SuiteRecord): SuiteRecord {
  const legacyPrimaryMetrics = record.gates.primaryMetrics as string[];

  return {
    ...record,
    gates: {
      ...record.gates,
      primaryMetrics: legacyPrimaryMetrics.map((metric) => {
        if (metric === "spawnIdlePct" || metric === "spawnIdleWithDemandPct") {
          return "spawnWaitingForSufficientEnergyPct";
        }

        return metric;
      }) as SuiteRecord["gates"]["primaryMetrics"]
    }
  };
}

function normalizeRunMetrics(metrics: RunMetrics): RunMetrics {
  if (!metrics.summary) {
    return metrics;
  }

  return {
    ...metrics,
    summary: {
      ...metrics.summary,
      users: {
        baseline: normalizeUserRunSummaryMetrics(metrics.summary.users.baseline),
        candidate: normalizeUserRunSummaryMetrics(metrics.summary.users.candidate)
      }
    }
  };
}

function normalizeUserRunSummaryMetrics(summary: UserRunSummaryMetrics): UserRunSummaryMetrics {
  const legacySummary = summary as UserRunSummaryMetrics & {
    spawnIdlePct?: number | null;
    spawnIdleWithDemandPct?: number | null;
  };

  return {
    ...summary,
    sourceHarvestEnergyPerTick: summary.sourceHarvestEnergyPerTick ?? null,
    sourceHarvestCeilingEnergyPerTick: summary.sourceHarvestCeilingEnergyPerTick ?? null,
    sourceHarvestUtilizationPct: summary.sourceHarvestUtilizationPct ?? null,
    spawnIdlePct: summary.spawnIdlePct ?? null,
    spawnSpawningPct: summary.spawnSpawningPct ?? null,
    spawnWaitingForSufficientEnergyPct:
      summary.spawnWaitingForSufficientEnergyPct
      ?? legacySummary.spawnIdleWithDemandPct
      ?? legacySummary.spawnIdlePct
      ?? null,
    creepIdlePct: summary.creepIdlePct ?? null,
    creepActivePct: summary.creepActivePct ?? null,
    creepWaitingForEnergyPct: summary.creepWaitingForEnergyPct ?? null
  };
}

function shouldIgnoreTransientJsonError(error: unknown): boolean {
  const fileError = error as NodeJS.ErrnoException;
  return fileError.code === "ENOENT" || error instanceof SyntaxError;
}

async function readCaseRunDetailsOrNull(runDir: string): Promise<RunDetails | null> {
  try {
    return await readCaseRunDetails(runDir);
  } catch (error) {
    if (shouldIgnoreTransientJsonError(error)) {
      return null;
    }
    throw error;
  }
}

function compareRunsNewestFirst(left: RunRecord, right: RunRecord): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id);
}

function compareSuitesNewestFirst(left: SuiteRecord, right: SuiteRecord): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id);
}
