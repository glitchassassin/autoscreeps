import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendIndexEntry, createRunWorkspace, listRunRecords, listRuns, readEventTail, readRunDetails, resolveRunDir, writeRunRecord, writeVariantRecords } from "../src/lib/history.ts";
import type { RunRecord, VariantRecord } from "../src/lib/contracts.ts";

const tempPaths: string[] = [];

describe("history", () => {
  afterEach(async () => {
    await Promise.all(tempPaths.map((tempPath) => fs.rm(tempPath, { recursive: true, force: true })));
    tempPaths.length = 0;
  });

  it("creates a run workspace and reads it back", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-history-"));
    tempPaths.push(repoRoot);

    const { historyRoot, runDir, runId } = await createRunWorkspace(repoRoot);
    const run: RunRecord = {
      id: runId,
      type: "duel",
      status: "completed",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      finishedAt: "2026-01-01T00:00:02.000Z",
      repoRoot,
      scenarioPath: "experiments/scenarios/duel-basic.yaml",
      scenarioName: "duel-basic",
      rooms: {
        baseline: "W5N5",
        candidate: "W6N5"
      },
      run: {
        tickDuration: 250,
        maxTicks: 100,
        pollIntervalMs: 1000,
        map: null,
        startGameTime: 1,
        endGameTime: 101
      },
      server: {
        httpUrl: "http://127.0.0.1:21025",
        cliHost: "127.0.0.1",
        cliPort: 21026
      },
      error: null
    };
    const variants: Record<"baseline" | "candidate", VariantRecord> = {
      baseline: {
        role: "baseline",
        snapshot: {
          kind: "git",
          source: "git:main",
          ref: "main",
          resolvedSha: "abc123"
        },
        build: {
          packagePath: "bots/basic",
          bundleHash: "hash-a",
          bundleSize: 10,
          builtAt: "2026-01-01T00:00:00.000Z",
          nodeVersion: "v22.0.0"
        }
      },
      candidate: {
        role: "candidate",
        snapshot: {
          kind: "workspace",
          source: "workspace",
          baseSha: "def456",
          branchName: "main",
          dirty: false,
          patchFile: null,
          patchHash: null
        },
        build: {
          packagePath: "bots/basic",
          bundleHash: "hash-b",
          bundleSize: 12,
          builtAt: "2026-01-01T00:00:00.000Z",
          nodeVersion: "v22.0.0"
        }
      }
    };

    await writeRunRecord(runDir, run);
    await writeVariantRecords(runDir, variants);
    await appendIndexEntry(historyRoot, {
      id: runId,
      type: "duel",
      status: "completed",
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      scenarioName: run.scenarioName,
      rooms: run.rooms
    });

    const listed = await listRuns(repoRoot);
    const details = await readRunDetails(repoRoot, runId);

    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(runId);
    expect(details.run.id).toBe(runId);
    expect(details.variants.baseline.snapshot.kind).toBe("git");
  });

  it("lists run records by run.json and ignores incomplete files", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-history-"));
    tempPaths.push(repoRoot);

    const olderRunId = "2026-01-01T00-00-00-000Z-oldrun";
    const newerRunId = "2026-01-01T00-01-00-000Z-newrun";
    const partialRunId = "2026-01-01T00-02-00-000Z-partial";

    await fs.mkdir(resolveRunDir(repoRoot, olderRunId), { recursive: true });
    await fs.mkdir(resolveRunDir(repoRoot, newerRunId), { recursive: true });
    await fs.mkdir(resolveRunDir(repoRoot, partialRunId), { recursive: true });

    await writeRunRecord(resolveRunDir(repoRoot, olderRunId), createRunRecord(repoRoot, olderRunId, "2026-01-01T00:00:00.000Z"));
    await writeRunRecord(resolveRunDir(repoRoot, newerRunId), createRunRecord(repoRoot, newerRunId, "2026-01-01T00:01:00.000Z"));
    await fs.writeFile(path.join(resolveRunDir(repoRoot, partialRunId), "run.json"), "{\n  \"id\":", "utf8");

    const runs = await listRunRecords(repoRoot);

    expect(runs.map((run) => run.id)).toEqual([newerRunId, olderRunId]);
  });

  it("reads the event tail and ignores an incomplete last line", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-history-"));
    tempPaths.push(repoRoot);

    const runId = "2026-01-01T00-00-00-000Z-tail";
    const runDir = resolveRunDir(repoRoot, runId);
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(
      path.join(runDir, "events.jsonl"),
      [
        JSON.stringify({ timestamp: "2026-01-01T00:00:00.000Z", level: "info", event: "one", message: "one" }),
        JSON.stringify({ timestamp: "2026-01-01T00:00:01.000Z", level: "info", event: "two", message: "two" }),
        JSON.stringify({ timestamp: "2026-01-01T00:00:02.000Z", level: "info", event: "three", message: "three" }),
        '{"timestamp":"2026-01-01T00:00:03.000Z"'
      ].join("\n"),
      "utf8"
    );

    const events = await readEventTail(runDir, 2);

    expect(events.map((event) => event.event)).toEqual(["two", "three"]);
  });
});

function createRunRecord(repoRoot: string, runId: string, createdAt: string): RunRecord {
  return {
    id: runId,
    type: "duel",
    status: "running",
    createdAt,
    startedAt: null,
    finishedAt: null,
    repoRoot,
    scenarioPath: "experiments/scenarios/duel-basic.yaml",
    scenarioName: "duel-basic",
    rooms: {
      baseline: "W5N5",
      candidate: "W6N5"
    },
    run: {
      tickDuration: 250,
      maxTicks: 100,
      pollIntervalMs: 1000,
      map: null,
      startGameTime: null,
      endGameTime: null
    },
    server: {
      httpUrl: "http://127.0.0.1:21025",
      cliHost: "127.0.0.1",
      cliPort: 21026
    },
    error: null
  };
}
