import { beforeEach, describe, expect, it, vi } from "vitest";
import { createColonyPlan } from "../src/planning/colony-plan";
import { createTelemetrySnapshot, telemetrySegmentId } from "../src/telemetry/snapshot";
import { recordTelemetry } from "../src/telemetry/report";
import { observeWorld } from "../src/world/observe";
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
        harvesterA: {
          name: "harvesterA",
          memory: { role: "harvester", homeRoom: "W0N0" },
          body: [{ type: WORK, hits: 100 }, { type: WORK, hits: 100 }],
          room: { name: "W0N0" },
          store: { [RESOURCE_ENERGY]: 0, getFreeCapacity: vi.fn(() => 0) },
          getActiveBodyparts: vi.fn(() => 2)
        } as unknown as Creep,
        runnerA: {
          name: "runnerA",
          memory: { role: "runner", working: true, homeRoom: "W0N0" },
          body: [{ type: CARRY, hits: 100 }, { type: MOVE, hits: 100 }],
          room: { name: "W0N0" },
          store: { [RESOURCE_ENERGY]: 50, getFreeCapacity: vi.fn(() => 0) },
          getActiveBodyparts: vi.fn(() => 0)
        } as unknown as Creep
      },
      constructionSites: {},
      getObjectById: vi.fn(() => null),
      rooms: {
        W0N0: {
          name: "W0N0",
          find: vi.fn((type: FindConstant) => {
            if (type === FIND_SOURCES) {
              return [makeSource("source-1")];
            }

            return [];
          }),
          controller: {
            my: true,
            level: 2,
            progress: 500,
            progressTotal: 45000
          }
        } as unknown as Room
      },
      spawns: {
        Spawn1: makeSpawn()
      },
      time: 25
    } as unknown as Game;

    testGlobal.RawMemory = {
      segments: {},
      setActiveSegments: vi.fn()
    } as unknown as RawMemory;
  });

  it("creates a compact snapshot from game state", () => {
    const world = observeWorld();
    const plan = createColonyPlan(world);
    const snapshot = createTelemetrySnapshot(world, plan, {
      harvestedEnergyBySourceId: {
        "source-1": 4
      }
    }, Memory.telemetry!);

    expect(snapshot).toEqual({
      schemaVersion: 13,
      gameTime: 25,
      totalCreeps: 2,
      mode: "normal",
      roleCounts: {
        "recovery-worker": 0,
        harvester: 1,
        runner: 1,
        upgrader: 0
      },
      spawn: {
        isSpawning: false,
        queueDepth: 1,
        nextRole: "upgrader"
      },
      sources: [
        {
          sourceId: "source-1",
          theoreticalGrossEpt: 10,
          plannedGrossEpt: 4,
          actualGrossEpt: 4,
          staffingCoverage: 0.4,
          harvestExecutionRatio: 1,
          overallUtilization: 0.4,
          assignedHarvesterCount: 1
        }
      ],
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

  it("writes the report envelope with telemetry", () => {
    const testGlobal = globalThis as typeof globalThis & { RawMemory: RawMemory };
    const world = observeWorld();
    const plan = createColonyPlan(world);

    recordTelemetry(world, plan, {
      harvestedEnergyBySourceId: {
        "source-1": 4
      }
    });

    expect(testGlobal.RawMemory.setActiveSegments).toHaveBeenCalledWith([telemetrySegmentId]);
    expect(JSON.parse(testGlobal.RawMemory.segments[telemetrySegmentId] as string)).toMatchObject({
      schemaVersion: 13,
      gameTime: 25,
      errors: [],
      telemetry: {
        totalCreeps: 2,
        spawn: {
          queueDepth: 1,
          nextRole: "upgrader"
        },
        sources: [
          {
            sourceId: "source-1",
            actualGrossEpt: 4
          }
        ],
        roleCounts: {
          harvester: 1,
          runner: 1
        }
      }
    });
  });

  it("keeps telemetry in the report between former sample ticks", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game; RawMemory: RawMemory };
    testGlobal.Game.time = 26;
    const world = observeWorld();
    const plan = createColonyPlan(world);

    recordTelemetry(world, plan, {
      harvestedEnergyBySourceId: {
        "source-1": 4
      }
    });

    expect(JSON.parse(testGlobal.RawMemory.segments[telemetrySegmentId] as string)).toEqual({
      schemaVersion: 13,
      gameTime: 26,
      errors: [],
      telemetry: {
        schemaVersion: 13,
        gameTime: 26,
        totalCreeps: 2,
        mode: "normal",
        roleCounts: {
          "recovery-worker": 0,
          harvester: 1,
          runner: 1,
          upgrader: 0
        },
        spawn: {
          isSpawning: false,
          queueDepth: 1,
          nextRole: "upgrader"
        },
        sources: [
          {
            sourceId: "source-1",
            theoreticalGrossEpt: 10,
            plannedGrossEpt: 4,
            actualGrossEpt: 4,
            staffingCoverage: 0.4,
            harvestExecutionRatio: 1,
            overallUtilization: 0.4,
            assignedHarvesterCount: 1
          }
        ],
        controller: {
          level: 2,
          progress: 500,
          progressTotal: 45000
        },
        milestones: {
          firstOwnedSpawnTick: 26,
          rcl2Tick: 26,
          rcl3Tick: null
        },
        counters: {
          creepDeaths: 2
        }
      }
    });
  });
});

function makeSpawn(): StructureSpawn {
  return {
    name: "Spawn1",
    spawning: null,
    room: {
      name: "W0N0",
      find: vi.fn((type: FindConstant) => {
        if (type === FIND_SOURCES) {
          return [makeSource("source-1")];
        }

        return [];
      }),
      controller: {
        my: true,
        level: 2,
        progress: 500,
        progressTotal: 45000
      },
      energyAvailable: 300,
      energyCapacityAvailable: 300
    } as unknown as Room
  } as unknown as StructureSpawn;
}

function makeSource(id: string): Source {
  return {
    id,
    energy: 3000,
    energyCapacity: 3000,
    ticksToRegeneration: 300,
    pos: {
      x: 10,
      y: 10,
      roomName: "W0N0"
    },
    room: {
      name: "W0N0"
    } as Room
  } as Source;
}
