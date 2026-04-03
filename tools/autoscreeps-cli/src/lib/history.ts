import fs from "node:fs/promises";
import path from "node:path";
import type { EventRecord, RunDetails, RunIndexEntry, RunMetrics, RunRecord, VariantRecord } from "./contracts.js";
import { createRunId, ensureDirectory } from "./utils.js";

const indexFileName = "index.jsonl";

export async function createRunWorkspace(repoRoot: string): Promise<{ historyRoot: string; runId: string; runDir: string }> {
  const historyRoot = path.join(repoRoot, ".autoscreeps", "runs");
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

export async function appendEvent(runDir: string, event: EventRecord): Promise<void> {
  await fs.appendFile(path.join(runDir, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
}

export async function appendIndexEntry(historyRoot: string, entry: RunIndexEntry): Promise<void> {
  await ensureDirectory(historyRoot);
  await fs.appendFile(path.join(historyRoot, indexFileName), `${JSON.stringify(entry)}\n`, "utf8");
}

export async function listRuns(repoRoot: string): Promise<RunIndexEntry[]> {
  const historyRoot = path.join(repoRoot, ".autoscreeps", "runs");
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

export async function readRunDetails(repoRoot: string, runId: string): Promise<RunDetails> {
  const runDir = path.join(repoRoot, ".autoscreeps", "runs", runId);
  const run = (await readJson(path.join(runDir, "run.json"))) as RunRecord;
  const variantsPath = path.join(runDir, "variants.json");
  const metricsPath = path.join(runDir, "metrics.json");

  let variants: Record<"baseline" | "candidate", VariantRecord> | null = null;
  let metrics: RunMetrics | null = null;

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

  return {
    run,
    variants,
    metrics
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
}
