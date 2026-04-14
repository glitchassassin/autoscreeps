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
        rcl3Tick: null,
        errors: []
      }
    } as unknown as Memory;

    testGlobal.Game = {
      creeps: {
        workerA: {
          memory: { role: "worker", working: false, homeRoom: "W0N0" }
        } as Creep,
        workerB: {
          memory: { role: "worker", working: true, homeRoom: "W0N0" }
        } as Creep
      },
      rooms: {
        W0N0: {
          controller: {
            my: true,
            level: 2,
            progress: 500,
            progressTotal: 45000
          }
        } as Room
      },
      spawns: {},
      time: 25
    } as unknown as Game;

    testGlobal.RawMemory = {
      segments: {},
      setActiveSegments: vi.fn()
    } as unknown as RawMemory;
  });

  it("creates a compact snapshot from game state", () => {
    const snapshot = createTelemetrySnapshot(makeSpawn(), Memory.telemetry!);

    expect(snapshot).toEqual({
      schemaVersion: 12,
      gameTime: 25,
      totalCreeps: 2,
      workerCount: 2,
      spawn: {
        isSpawning: false,
        queueDepth: 3,
        nextRole: "worker"
      },
      controller: {
        level: 2,
        progress: 500,
        progressTotal: 45000
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

  it("writes the report envelope with telemetry on sample ticks", () => {
    const testGlobal = globalThis as typeof globalThis & { RawMemory: RawMemory };

    recordTelemetry(makeSpawn());

    expect(testGlobal.RawMemory.setActiveSegments).toHaveBeenCalledWith([telemetrySegmentId]);
    expect(JSON.parse(testGlobal.RawMemory.segments[telemetrySegmentId] as string)).toMatchObject({
      schemaVersion: 12,
      gameTime: 25,
      errors: [],
      telemetry: {
        totalCreeps: 2,
        workerCount: 2,
        spawn: {
          queueDepth: 3,
          nextRole: "worker"
        }
      }
    });
  });

  it("writes only the control-plane report between sample ticks", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game; RawMemory: RawMemory };
    testGlobal.Game.time = 26;

    recordTelemetry(makeSpawn());

    expect(JSON.parse(testGlobal.RawMemory.segments[telemetrySegmentId] as string)).toEqual({
      schemaVersion: 12,
      gameTime: 26,
      errors: []
    });
  });
});

function makeSpawn(): StructureSpawn {
  return {
    name: "Spawn1",
    spawning: null,
    room: {
      name: "W0N0",
      controller: {
        my: true,
        level: 2,
        progress: 500,
        progressTotal: 45000
      },
      energyAvailable: 300,
      energyCapacityAvailable: 300
    } as Room
  } as unknown as StructureSpawn;
}
