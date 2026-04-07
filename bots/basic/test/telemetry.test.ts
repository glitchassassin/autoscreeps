import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTelemetrySnapshot, recordTelemetry, telemetrySegmentId } from "../src/telemetry";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("telemetry", () => {
  beforeEach(() => {
    installScreepsGlobals();
    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory; RawMemory: RawMemory };
    const sourceA = { id: "source-a", pos: { x: 10, y: 10, roomName: "W0N0" } } as Source;
    const sourceB = { id: "source-b", pos: { x: 20, y: 20, roomName: "W0N0" } } as Source;

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
          body: [{ type: WORK, hits: 100 }, { type: WORK, hits: 100 }],
          pos: { x: 10, y: 11, roomName: "W0N0" },
          store: { energy: 0, getFreeCapacity: vi.fn(() => 50) }
        } as unknown as Creep,
        harvesterB: {
          memory: { role: "harvester", working: false, homeRoom: "W0N0", sourceId: "source-b" },
          body: [{ type: WORK, hits: 100 }, { type: WORK, hits: 100 }],
          pos: { x: 23, y: 23, roomName: "W0N0" },
          store: { energy: 0, getFreeCapacity: vi.fn(() => 50) }
        } as unknown as Creep,
        courierA: {
          memory: { role: "courier", working: false, homeRoom: "W0N0" },
          body: [],
          pos: { x: 12, y: 12, roomName: "W0N0" },
          store: { energy: 0, getFreeCapacity: vi.fn(() => 100) }
        } as unknown as Creep,
        workerA: {
          memory: { role: "worker", working: true, homeRoom: "W0N0" },
          body: [{ type: WORK, hits: 100 }],
          pos: { x: 10, y: 10, roomName: "W0N0" },
          store: { energy: 50, getFreeCapacity: vi.fn(() => 50) }
        } as unknown as Creep
      },
      spawns: {},
      getObjectById: vi.fn((id: Id<Source>) => (id === sourceA.id ? sourceA : id === sourceB.id ? sourceB : null)),
      rooms: {
        W0N0: {
          controller: {
            my: true,
            level: 2
          },
          find: (type: number) => {
            if (type === FIND_SOURCES) {
              return [sourceA, sourceB];
            }
            if (type === FIND_DROPPED_RESOURCES) {
              return [{ id: "drop-a", resourceType: RESOURCE_ENERGY, amount: 75, pos: { x: 10, y: 11, roomName: "W0N0" } }] as Array<Resource<ResourceConstant>>;
            }

            return [];
          },
          getTerrain: () => ({ get: () => 0 })
        } as unknown as Room
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
      schemaVersion: 5,
      gameTime: 25,
      debugError: null,
      colonyMode: "normal",
      totalCreeps: 4,
      roleCounts: {
        harvester: 2,
        courier: 1,
        worker: 1
      },
      spawn: {
        queueDepth: 5,
        isSpawning: false,
        nextRole: "worker",
        unmetDemand: {
          harvester: 0,
          courier: 0,
          worker: 5
        }
      },
      sources: {
        total: 2,
        staffed: 2,
        assignments: {
          "source-a": 1,
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
        },
        adjacentHarvesters: {
          "source-a": 1,
          "source-b": 0
        },
        successfulHarvestTicks: {},
        dropEnergy: {
          "source-a": 75,
          "source-b": 0
        },
        oldestDropAge: {
          "source-a": 0,
          "source-b": 0
        },
        overAssigned: {
          "source-a": 0,
          "source-b": 0
        },
        backlogEnergy: 75
      },
      loop: {
        phaseTicks: {},
        actionAttempts: {},
        actionSuccesses: {},
        actionFailures: {},
        targetFailures: {},
        workingStateFlips: {},
        cargoUtilizationTicks: {},
        noTargetTicks: {},
        withEnergyNoSpendTicks: {},
        noEnergyAvailableTicks: {},
        sourceAssignmentTicks: {},
        sourceAdjacencyTicks: {},
        samePositionTicks: {},
        energyGained: {},
        energySpent: {},
        energySpentOnBuild: 0,
        energySpentOnUpgrade: 0,
        deliveredEnergyByTargetType: {},
        transferSuccessByTargetType: {},
        workerTaskSelections: {},
        sourceDropPickupLatencyTotal: 0,
        sourceDropPickupLatencySamples: 0,
        pickupToSpendLatencyTotal: 0,
        pickupToSpendLatencySamples: 0
      },
      creeps: {},
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
      schemaVersion: 5,
      gameTime: 25,
      roleCounts: {
        harvester: 2,
        courier: 1,
        worker: 1
      },
      spawn: {
        queueDepth: 5,
        nextRole: "worker",
        unmetDemand: {
          courier: 0,
          worker: 5
        }
      },
      sources: {
        total: 2,
        staffed: 2,
        harvestingStaffed: 2,
        activeHarvestingStaffed: 1,
        backlogEnergy: 75
      },
      loop: {
        phaseTicks: {
          "harvester.gathering": 2,
          "courier.gathering": 1,
          "worker.working": 1
        },
        sourceAssignmentTicks: {
          harvester: 2
        },
        sourceAdjacencyTicks: {
          harvester: 1
        },
        cargoUtilizationTicks: {
          worker: 1
        },
        withEnergyNoSpendTicks: {
          worker: 1
        }
      },
      creeps: {
        harvesterA: {
          role: "harvester",
          ticksSinceSuccess: null,
          samePositionTicks: 0
        },
        workerA: {
          role: "worker",
          ticksSinceSuccess: null,
          samePositionTicks: 0
        }
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
      energyAvailable: 300,
      energyCapacityAvailable: 300,
      controller: {
        my: true,
        level: 2
      },
      find: (type: number) => {
        if (type === FIND_SOURCES) {
          return [
            { id: "source-a", pos: { x: 10, y: 10, roomName: "W0N0" } },
            { id: "source-b", pos: { x: 20, y: 20, roomName: "W0N0" } }
          ] as Source[];
        }
        if (type === FIND_DROPPED_RESOURCES) {
          return [{ id: "drop-a", resourceType: RESOURCE_ENERGY, amount: 75, pos: { x: 10, y: 11, roomName: "W0N0" } }] as Array<Resource<ResourceConstant>>;
        }

        return [];
      }
    }
  } as unknown as StructureSpawn;
}
