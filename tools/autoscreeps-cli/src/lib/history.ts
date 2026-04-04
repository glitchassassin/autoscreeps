import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { EventRecord, RunDetails, RunIndexEntry, RunMetrics, RunRecord, RunSample, VariantRecord } from "./contracts.ts";
import { createRunId, ensureDirectory } from "./utils.ts";

const indexFileName = "index.jsonl";

export function resolveHistoryRoot(repoRoot: string): string {
  return path.join(repoRoot, ".autoscreeps", "runs");
}

export function resolveRunDir(repoRoot: string, runId: string): string {
  return path.join(resolveHistoryRoot(repoRoot), runId);
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

export async function writeRunRecord(runDir: string, record: RunRecord): Promise<void> {
  await writeJson(path.join(runDir, "run.json"), record);
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

export async function readRunDetails(repoRoot: string, runId: string): Promise<RunDetails> {
  const runDir = resolveRunDir(repoRoot, runId);
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
    metrics = (await readJson(metricsPath)) as RunMetrics;
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

export async function readEventTail(runDir: string, limit: number): Promise<EventRecord[]> {
  const filePath = path.join(runDir, "events.jsonl");

  try {
    const events = await readJsonLines<EventRecord>(filePath);
    return events.slice(-limit);
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

function shouldIgnoreTransientJsonError(error: unknown): boolean {
  const fileError = error as NodeJS.ErrnoException;
  return fileError.code === "ENOENT" || error instanceof SyntaxError;
}

function compareRunsNewestFirst(left: RunRecord, right: RunRecord): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id);
}
