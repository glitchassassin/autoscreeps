import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendIndexEntry, createRunWorkspace, listRuns, readRunDetails, writeRunRecord, writeVariantRecords } from "../src/lib/history.js";
import { RunRecord, VariantRecord } from "../src/lib/contracts.js";

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
});
