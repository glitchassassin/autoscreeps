import { describe, expect, it } from "vitest";

import type { EventRecord, SuiteCaseDetails, SuiteIndexEntry, SuiteRecord } from "../src/lib/contracts.ts";
import type { RoomObjectsResponse } from "../src/lib/screeps-api.ts";
import { renderDashboard, type DashboardSnapshot } from "../src/commands/experiment/watch.ts";
import { selectSuiteForWatch, summarizeLiveRoom, summarizeRecordedRoom } from "../src/lib/watch.ts";

describe("watch helpers", () => {
  it("follows the newest suite when not pinned", () => {
    const selected = selectSuiteForWatch([
      createSuiteIndexEntry("older", "2026-01-01T00:00:00.000Z"),
      createSuiteIndexEntry("newer", "2026-01-01T00:01:00.000Z")
    ]);

    expect(selected?.id).toBe("newer");
  });

  it("pins an explicit suite even when a newer suite exists", () => {
    const selected = selectSuiteForWatch([
      createSuiteIndexEntry("older", "2026-01-01T00:00:00.000Z"),
      createSuiteIndexEntry("newer", "2026-01-01T00:01:00.000Z")
    ], "older");

    expect(selected?.id).toBe("older");
  });

  it("reduces live room objects into watcher stats", () => {
    const stats = summarizeLiveRoom("W5N5", {
      objects: [
        { type: "controller", user: "u1", level: 2, progress: 250, progressTotal: 45000 },
        { type: "spawn", user: "u1", store: { energy: 150 }, storeCapacityResource: { energy: 300 } },
        { type: "extension", user: "u1", energy: 50, energyCapacity: 50 },
        { type: "constructionSite", user: "u1" },
        { type: "creep", user: "u1", store: { energy: 25 }, storeCapacity: 50 },
        { type: "creep", user: "u1", store: { energy: 0 }, storeCapacity: 50 },
        { type: "source" }
      ],
      users: {
        u1: { username: "baseline" }
      }
    } satisfies RoomObjectsResponse);

    expect(stats.owner).toBe("baseline");
    expect(stats.creeps).toBe(2);
    expect(stats.spawns).toBe(1);
    expect(stats.extensions).toBe(1);
    expect(stats.constructionSites).toBe(1);
    expect(stats.controllerLevel).toBe(2);
    expect(stats.energy).toBe(225);
    expect(stats.energyCapacity).toBe(450);
  });

  it("reduces recorded metrics into watcher stats", () => {
    const stats = summarizeRecordedRoom({
      room: "W5N5",
      totalObjects: 12,
      typeCounts: {
        creep: 3,
        spawn: 1,
        extension: 2,
        constructionSite: 1
      },
      owners: {
        baseline: 6
      },
      controllerOwners: ["baseline"],
      spawnOwners: ["baseline"]
    });

    expect(stats.owner).toBe("baseline");
    expect(stats.creeps).toBe(3);
    expect(stats.spawns).toBe(1);
    expect(stats.extensions).toBe(2);
    expect(stats.energy).toBeNull();
  });

  it("renders the dashboard in plain text when colors are disabled", () => {
    const snapshot: DashboardSnapshot = {
      mode: "follow-latest",
      suite: createSuiteRecord("suite-1", "2026-01-01T00:00:00.000Z"),
      displayCase: createCaseDetails("run-1"),
      events: [
        {
          timestamp: "2026-01-01T00:00:01.000Z",
          level: "info",
          event: "simulation.progress",
          message: "Simulation advanced.",
          data: { gameTime: 10, remainingTicks: 90 }
        } satisfies EventRecord
      ],
      eventsLabel: "Recent Case Events",
      baseline: {
        room: "W5N5",
        owner: "baseline",
        controllerLevel: 2,
        controllerProgress: 250,
        controllerProgressTotal: 45000,
        creeps: 2,
        spawns: 1,
        constructionSites: 1,
        extensions: 1,
        energy: 200,
        energyCapacity: 350,
        objects: 8
      },
      candidate: {
        room: "W6N5",
        owner: "candidate",
        controllerLevel: 2,
        controllerProgress: 300,
        controllerProgressTotal: 45000,
        creeps: 2,
        spawns: 1,
        constructionSites: 0,
        extensions: 1,
        energy: 175,
        energyCapacity: 350,
        objects: 8
      },
      configuredTickDurationMs: 250,
      measuredTickDurationMs: 248.5,
      displayGameTime: 10,
      targetGameTime: 101,
      statsError: null
    };

    const rendered = renderDashboard(snapshot, { width: 120, colors: false, clear: false });

    expect(rendered).toContain("AUTOSCREEPS EXPERIMENT WATCH");
    expect(rendered).toContain("Suite Summary");
    expect(rendered).toContain("Baseline (W5N5)");
    expect(rendered).toContain("Candidate (W6N5)");
    expect(rendered).toContain("Recent Case Events");
    expect(rendered).toContain("RCL 2 (0.6% to RCL 3)");
    expect(rendered).toContain("RCL 2 (0.7% to RCL 3)");
    expect(rendered).toContain("250 ms configured / 248.5 ms actual");
    expect(rendered).not.toContain("\u001b[");
    expect(rendered).not.toContain("+");
  });

  it("shows RCL1 progress even when the API omits progressTotal", () => {
    const rendered = renderDashboard({
      mode: "follow-latest",
      suite: createSuiteRecord("suite-3", "2026-01-01T00:00:00.000Z"),
      displayCase: createCaseDetails("run-3"),
      events: [],
      eventsLabel: "Recent Case Events",
      baseline: {
        room: "W5N5",
        owner: "baseline",
        controllerLevel: 1,
        controllerProgress: 50,
        controllerProgressTotal: null,
        creeps: 1,
        spawns: 1,
        constructionSites: 0,
        extensions: 0,
        energy: 150,
        energyCapacity: 300,
        objects: 6
      },
      candidate: null,
      configuredTickDurationMs: 250,
      measuredTickDurationMs: null,
      displayGameTime: 10,
      targetGameTime: 101,
      statsError: null
    }, { width: 120, colors: false, clear: false });

    expect(rendered).toContain("RCL 1 (25.0% to RCL 2)");
  });

  it("pads separator and room rows to the full dashboard width", () => {
    const rendered = renderDashboard({
      mode: "follow-latest",
      suite: createSuiteRecord("suite-2", "2026-01-01T00:00:00.000Z"),
      displayCase: createCaseDetails("run-2"),
      events: [
        {
          timestamp: "2026-01-01T00:00:01.000Z",
          level: "info",
          event: "suite.case.started",
          message: "Started suite case.",
          data: undefined
        } satisfies EventRecord
      ],
      eventsLabel: "Recent Case Events",
      baseline: null,
      candidate: {
        room: "W6N5",
        owner: "candidate",
        controllerLevel: 2,
        controllerProgress: 300,
        controllerProgressTotal: 45000,
        creeps: 2,
        spawns: 1,
        constructionSites: 0,
        extensions: 1,
        energy: 175,
        energyCapacity: 350,
        objects: 8
      },
      configuredTickDurationMs: 250,
      measuredTickDurationMs: 248.5,
      displayGameTime: 10,
      targetGameTime: 101,
      statsError: null
    }, { width: 120, colors: false, clear: false });

    const lines = rendered.split("\n").slice(0, -1);
    const recentEventsIndex = lines.findIndex((line) => line.includes("Recent Case Events"));

    expect(lines.every((line) => line.length === 120)).toBe(true);
    expect(recentEventsIndex).toBeGreaterThan(0);
    expect(lines[recentEventsIndex - 1]).toBe(" ".repeat(120));
  });

  it("keeps the title on the first line when clearing the screen", () => {
    const rendered = renderDashboard({
      mode: "follow-latest",
      suite: null,
      displayCase: null,
      events: [],
      eventsLabel: "Recent Suite Events",
      baseline: null,
      candidate: null,
      configuredTickDurationMs: null,
      measuredTickDurationMs: null,
      displayGameTime: null,
      targetGameTime: null,
      statsError: null
    }, { width: 120, colors: false, clear: true });

    expect(rendered.split("\n")[0]).toContain("AUTOSCREEPS EXPERIMENT WATCH");
  });
});

function createSuiteIndexEntry(id: string, createdAt: string): SuiteIndexEntry {
  return {
    id,
    status: "running",
    createdAt,
    finishedAt: null,
    name: id,
    progress: {
      caseCount: 1,
      completedCaseCount: 0,
      failedCaseCount: 0,
      currentCaseId: "duel",
      currentCaseRunId: `${id}-run`
    }
  };
}

function createSuiteRecord(id: string, createdAt: string): SuiteRecord {
  return {
    id,
    type: "suite",
    status: "running",
    createdAt,
    startedAt: createdAt,
    finishedAt: null,
    repoRoot: "/repo",
    name: "duel-basic",
    mode: "duel",
    source: {
      kind: "scenario",
      path: "e2e/scenarios/duel-basic.yaml"
    },
    baseline: {
      source: "git:main",
      packagePath: "bots/basic"
    },
    candidate: {
      source: "workspace",
      packagePath: "bots/basic"
    },
    progress: {
      caseCount: 1,
      completedCaseCount: 0,
      failedCaseCount: 0,
      currentCaseId: "duel",
      currentCaseRunId: "run-1"
    },
    cases: [
      {
        id: "duel",
        cohort: "train",
        caseIndex: 1,
        tags: [],
        scenarioPath: "e2e/scenarios/duel-basic.yaml",
        scenarioName: "duel-basic",
        runId: "run-1",
        status: "running",
        error: null,
        startedAt: createdAt,
        finishedAt: null
      }
    ],
    error: null
  };
}

function createCaseDetails(runId: string): SuiteCaseDetails {
  return {
    id: "duel",
    cohort: "train",
    caseIndex: 1,
    tags: [],
    scenarioPath: "e2e/scenarios/duel-basic.yaml",
    scenarioName: "duel-basic",
    runId,
    status: "running",
    error: null,
    startedAt: "2026-01-01T00:00:01.000Z",
    finishedAt: null,
    details: {
      run: {
        id: runId,
        type: "duel",
        status: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:01.000Z",
        finishedAt: null,
        repoRoot: "/repo",
        scenarioPath: "e2e/scenarios/duel-basic.yaml",
        scenarioName: "duel-basic",
        suite: {
          id: "suite-1",
          name: "duel-basic",
          caseId: "duel",
          cohort: "train",
          caseIndex: 1,
          caseCount: 1
        },
        rooms: {
          baseline: "W5N5",
          candidate: "W6N5"
        },
        run: {
          tickDuration: 250,
          maxTicks: 100,
          sampleEveryTicks: 25,
          pollIntervalMs: 1000,
          map: null,
          startGameTime: 1,
          endGameTime: null,
          terminalConditions: null,
          terminationReason: null
        },
        server: {
          httpUrl: "http://127.0.0.1:21025",
          cliHost: "127.0.0.1",
          cliPort: 21026
        },
        error: null
      },
      variants: {
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
            dirty: true,
            patchFile: "candidate.patch",
            patchHash: "hash-b"
          },
          build: {
            packagePath: "bots/basic",
            bundleHash: "hash-b",
            bundleSize: 12,
            builtAt: "2026-01-01T00:00:00.000Z",
            nodeVersion: "v22.0.0"
          }
        }
      },
      metrics: null
    }
  };
}
