import { describe, expect, it } from "vitest";
import { buildTelemetryByRole, parseBotTelemetry } from "../src/lib/bot-telemetry.ts";

describe("bot telemetry", () => {
  it("parses a valid telemetry payload", () => {
    const parsed = parseBotTelemetry(JSON.stringify({
      schemaVersion: 1,
      gameTime: 250,
      colonyMode: "normal",
      totalCreeps: 4,
      roleCounts: { harvester: 2, upgrader: 2 },
      spawn: {
        queueDepth: 1,
        isSpawning: false,
        nextRole: "harvester",
        unmetDemand: { harvester: 1, upgrader: 0 }
      },
      sources: {
        total: 2,
        staffed: 1,
        assignments: { sourceA: 1 }
      },
      milestones: { rcl2Tick: 125 },
      counters: { creepDeaths: 3 }
    }));

    expect(parsed).toEqual({
      schemaVersion: 1,
      gameTime: 250,
      colonyMode: "normal",
      totalCreeps: 4,
      roleCounts: { harvester: 2, upgrader: 2 },
      spawn: {
        queueDepth: 1,
        isSpawning: false,
        nextRole: "harvester",
        unmetDemand: { harvester: 1, upgrader: 0 }
      },
      sources: {
        total: 2,
        staffed: 1,
        assignments: { sourceA: 1 }
      },
      milestones: { rcl2Tick: 125 },
      counters: { creepDeaths: 3 }
    });
  });

  it("returns null for malformed telemetry and builds role maps", () => {
    expect(parseBotTelemetry("{bad json")).toBeNull();
    expect(parseBotTelemetry(JSON.stringify({ schemaVersion: "1", gameTime: 25 }))).toBeNull();

    expect(buildTelemetryByRole({
      baseline: JSON.stringify({ schemaVersion: 1, gameTime: 25 }),
      candidate: null
    })).toEqual({
      baseline: { schemaVersion: 1, gameTime: 25 },
      candidate: null
    });
  });
});
