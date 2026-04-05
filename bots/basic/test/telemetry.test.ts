import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTelemetrySnapshot, recordTelemetry, telemetrySegmentId } from "../src/telemetry";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("telemetry", () => {
  beforeEach(() => {
    installScreepsGlobals();
    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory; RawMemory: RawMemory };

    testGlobal.Memory = {
      creeps: {},
      telemetry: {
        creepDeaths: 2,
        firstOwnedSpawnTick: null,
        rcl2Tick: null,
        rcl3Tick: null
      }
    } as unknown as Memory;

    testGlobal.Game = {
      creeps: {
        harvesterA: {
          memory: { role: "harvester", working: false, homeRoom: "W0N0", sourceId: "source-a" },
          pos: { x: 10, y: 11, roomName: "W0N0" }
        } as Creep,
        harvesterB: {
          memory: { role: "harvester", working: false, homeRoom: "W0N0", sourceId: "source-b" },
          pos: { x: 23, y: 23, roomName: "W0N0" }
        } as Creep,
        upgraderA: {
          memory: { role: "upgrader", working: true, homeRoom: "W0N0", sourceId: "source-a" },
          pos: { x: 10, y: 10, roomName: "W0N0" }
        } as Creep
      },
      spawns: {},
      rooms: {
        W0N0: {
          controller: {
            my: true,
            level: 2
          },
          find: (type: number) => (type === FIND_SOURCES
            ? [
              { id: "source-a", pos: { x: 10, y: 10, roomName: "W0N0" } },
              { id: "source-b", pos: { x: 20, y: 20, roomName: "W0N0" } }
            ]
            : [])
        } as Room
      },
      time: 25
    } as unknown as Game;

    testGlobal.RawMemory = {
      segments: {},
      setActiveSegments: vi.fn()
    } as unknown as RawMemory;
  });

  it("creates a compact telemetry snapshot from game state", () => {
    const spawn = makeSpawn();

    const snapshot = createTelemetrySnapshot(spawn, Memory.telemetry!);

    expect(snapshot).toEqual({
      schemaVersion: 4,
      gameTime: 25,
      colonyMode: "normal",
      totalCreeps: 3,
      roleCounts: {
        harvester: 2,
        upgrader: 1
      },
      spawn: {
        queueDepth: 1,
        isSpawning: false,
        nextRole: "upgrader",
        unmetDemand: {
          harvester: 0,
          upgrader: 1
        }
      },
      sources: {
        total: 2,
        staffed: 2,
        assignments: {
          "source-a": 2,
          "source-b": 1
        },
        harvestingStaffed: 2,
        harvestingAssignments: {
          "source-a": 1,
          "source-b": 1
        },
        activeHarvestingStaffed: 1,
        activeHarvestingAssignments: {
          "source-a": 1
        }
      },
      milestones: {
        firstOwnedSpawnTick: null,
        rcl2Tick: null,
        rcl3Tick: null
      },
      counters: {
        creepDeaths: 2
      }
    });
  });

  it("writes telemetry to a reserved memory segment on sample ticks", () => {
    const testGlobal = globalThis as typeof globalThis & { RawMemory: RawMemory };
    const spawn = makeSpawn();

    recordTelemetry(spawn);

    expect(testGlobal.RawMemory.setActiveSegments).toHaveBeenCalledWith([telemetrySegmentId]);
    const rawSegment = testGlobal.RawMemory.segments[telemetrySegmentId];
    expect(typeof rawSegment).toBe("string");
    expect(JSON.parse(rawSegment as string)).toMatchObject({
      schemaVersion: 4,
      gameTime: 25,
      sources: {
        total: 2,
        staffed: 2,
        harvestingStaffed: 2,
        activeHarvestingStaffed: 1
      },
      milestones: {
        firstOwnedSpawnTick: 25,
        rcl2Tick: 25,
        rcl3Tick: null
      }
    });
  });

  it("still requests the telemetry segment on non-sample ticks without rewriting it", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game; RawMemory: RawMemory };
    testGlobal.Game.time = 26;
    testGlobal.RawMemory.segments[telemetrySegmentId] = "existing";

    recordTelemetry(makeSpawn());

    expect(testGlobal.RawMemory.setActiveSegments).toHaveBeenCalledWith([telemetrySegmentId]);
    expect(testGlobal.RawMemory.segments[telemetrySegmentId]).toBe("existing");
  });
});

function makeSpawn(): StructureSpawn {
  return {
    name: "Spawn1",
    spawning: null,
    room: {
      name: "W0N0",
      energyAvailable: 300
    }
  } as unknown as StructureSpawn;
}
