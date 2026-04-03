import { describe, expect, it } from "vitest";
import type { EventRecord } from "../src/lib/contracts.ts";
import type { RoomObjectsResponse } from "../src/lib/screeps-api.ts";
import { selectRunForWatch, summarizeLiveRoom, summarizeRecordedRoom } from "../src/lib/watch.ts";
import { renderDashboard, type DashboardSnapshot } from "../src/commands/experiment/watch.ts";

describe("watch helpers", () => {
  it("follows the newest run when not pinned", () => {
    const selected = selectRunForWatch([
      createRunRecord("older", "2026-01-01T00:00:00.000Z"),
      createRunRecord("newer", "2026-01-01T00:01:00.000Z")
    ]);

    expect(selected?.id).toBe("newer");
  });

  it("pins an explicit run even when a newer run exists", () => {
    const selected = selectRunForWatch([
      createRunRecord("older", "2026-01-01T00:00:00.000Z"),
      createRunRecord("newer", "2026-01-01T00:01:00.000Z")
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
        { type: "creep", user: "u1" },
        { type: "creep", user: "u1" },
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
    expect(stats.energy).toBe(200);
    expect(stats.energyCapacity).toBe(350);
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
      details: {
        run: createRunRecord("run-1", "2026-01-01T00:00:00.000Z"),
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
      },
      events: [
        {
          timestamp: "2026-01-01T00:00:01.000Z",
          level: "info",
          event: "simulation.progress",
          message: "Simulation advanced.",
          data: { gameTime: 10, remainingTicks: 90 }
        } satisfies EventRecord
      ],
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
      displayGameTime: 10,
      targetGameTime: 101,
      statsError: null
    };

    const rendered = renderDashboard(snapshot, { width: 120, colors: false, clear: false });

    expect(rendered).toContain("AUTOSCREEPS EXPERIMENT WATCH");
    expect(rendered).toContain("Run Summary");
    expect(rendered).toContain("Baseline (W5N5)");
    expect(rendered).toContain("Candidate (W6N5)");
    expect(rendered).toContain("Recent Events");
    expect(rendered).not.toContain("\u001b[");
    expect(rendered).not.toContain("+");
  });
});

function createRunRecord(runId: string, createdAt: string) {
  return {
    id: runId,
    type: "duel" as const,
    status: "running" as const,
    createdAt,
    startedAt: null,
    finishedAt: null,
    repoRoot: "/repo",
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
