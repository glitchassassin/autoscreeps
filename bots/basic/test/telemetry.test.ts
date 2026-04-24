import { beforeEach, describe, expect, it, vi } from "vitest";
import { createColonyPlan } from "../src/planning/colony-plan";
import { createEmptyCpuTelemetrySnapshot } from "../src/telemetry/cpu-profiler";
import { beginCpuSpan, createCpuProfiler, endCpuSpan } from "../src/telemetry/cpu-profiler";
import { recordTelemetry, resetPendingCpuTelemetry } from "../src/telemetry/report";
import { createTelemetrySnapshot, telemetrySegmentId } from "../src/telemetry/snapshot";
import { observeWorld } from "../src/world/observe";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("telemetry", () => {
  let cpuUsed = 0;

  beforeEach(() => {
    installScreepsGlobals();
    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory; RawMemory: RawMemory };
    cpuUsed = 0;
    resetPendingCpuTelemetry();

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
          getActiveBodyparts: vi.fn((part: BodyPartConstant) => part === CARRY ? 1 : 0)
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
            progressTotal: 45000,
            pos: {
              x: 20,
              y: 20,
              roomName: "W0N0"
            }
          }
        } as unknown as Room
      },
      spawns: {
        Spawn1: makeSpawn()
      },
      cpu: {
        limit: 20,
        tickLimit: 500,
        bucket: 10000,
        getUsed: vi.fn(() => cpuUsed)
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
    const cpu = createEmptyCpuTelemetrySnapshot();
    const snapshot = createTelemetrySnapshot(world, plan, {
      harvestedEnergyBySourceId: {
        "source-1": 4
      }
    }, Memory.telemetry!, cpu, null);

    expect(snapshot).toEqual({
      schemaVersion: 17,
      gameTime: 25,
      cpuGameTime: null,
      cpu: {
        used: null,
        limit: 20,
        tickLimit: 500,
        bucket: 10000,
        profile: []
      },
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
        queueDepth: 15,
        nextRole: "runner",
        inputs: {
          harvest: {
            requiredWorkParts: 5,
            coveredWorkParts: 2,
            plannedWorkPartsPerCreep: 2,
            targetCount: 3,
            coverage: 0.4
          },
          haul: {
            requiredCarryParts: 3,
            coveredCarryParts: 1,
            plannedCarryPartsPerCreep: 3,
            targetCount: 1,
            coverage: 1 / 3
          },
          upgrade: {
            surplusBudgetEpt: 9.3,
            coveredNetEpt: 0,
            plannedNetEptPerCreep: 50 / 71 + 200 / 1500,
            targetCount: 12,
            coverage: 0
          }
        }
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
      },
      roomPlanning: {
        activeRoomName: null,
        activePolicy: null,
        activeStage: null,
        activeTicksSpent: 0,
        completedCount: 0,
        failedCount: 0,
        lastFailure: null
      }
    });
  });

  it("writes the report envelope with telemetry", () => {
    const testGlobal = globalThis as typeof globalThis & { RawMemory: RawMemory };
    const world = observeWorld();
    const plan = createColonyPlan(world);
    const profiler = createCpuProfiler();

    recordTelemetry(world, plan, {
      harvestedEnergyBySourceId: {
        "source-1": 4
      }
    }, profiler);

    expect(testGlobal.RawMemory.setActiveSegments).toHaveBeenCalledWith([telemetrySegmentId]);
    expect(JSON.parse(testGlobal.RawMemory.segments[telemetrySegmentId] as string)).toMatchObject({
      schemaVersion: 17,
      gameTime: 25,
      errors: [],
      telemetry: {
        cpuGameTime: null,
        cpu: {
          used: null,
          limit: 20,
          tickLimit: 500,
          bucket: 10000,
          profile: []
        },
        totalCreeps: 2,
        spawn: {
          queueDepth: 15,
          nextRole: "runner",
          inputs: {
            harvest: {
              requiredWorkParts: 5
            },
            haul: {
              requiredCarryParts: 3
            },
            upgrade: {
              surplusBudgetEpt: 9.3
            }
          }
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
    const profiler = createCpuProfiler();
    const firstWorld = observeWorld();
    const firstPlan = createColonyPlan(firstWorld);

    recordTelemetry(firstWorld, firstPlan, {
      harvestedEnergyBySourceId: {
        "source-1": 4
      }
    }, profiler);

    testGlobal.Game.time = 26;
    const world = observeWorld();
    const plan = createColonyPlan(world);

    recordTelemetry(world, plan, {
      harvestedEnergyBySourceId: {
        "source-1": 4
      }
    }, createCpuProfiler());

    expect(JSON.parse(testGlobal.RawMemory.segments[telemetrySegmentId] as string)).toEqual({
      schemaVersion: 17,
      gameTime: 26,
      errors: [],
      telemetry: {
        schemaVersion: 17,
        gameTime: 26,
        cpuGameTime: 25,
        cpu: {
          used: 0,
          limit: 20,
          tickLimit: 500,
          bucket: 10000,
          profile: [
            {
              label: "report",
              total: 0,
              self: 0,
              calls: 1,
              children: []
            }
          ]
        },
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
          queueDepth: 15,
          nextRole: "runner",
          inputs: {
            harvest: {
              requiredWorkParts: 5,
              coveredWorkParts: 2,
              plannedWorkPartsPerCreep: 2,
              targetCount: 3,
              coverage: 0.4
            },
            haul: {
              requiredCarryParts: 3,
              coveredCarryParts: 1,
              plannedCarryPartsPerCreep: 3,
              targetCount: 1,
              coverage: 1 / 3
            },
            upgrade: {
              surplusBudgetEpt: 9.3,
              coveredNetEpt: 0,
              plannedNetEptPerCreep: 50 / 71 + 200 / 1500,
              targetCount: 12,
              coverage: 0
            }
          }
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
          firstOwnedSpawnTick: 25,
          rcl2Tick: 25,
          rcl3Tick: null
        },
        counters: {
          creepDeaths: 2
        },
        roomPlanning: {
          activeRoomName: null,
          activePolicy: null,
          activeStage: null,
          activeTicksSpent: 0,
          completedCount: 0,
          failedCount: 0,
          lastFailure: null
        }
      }
    });
  });

  it("records nested cpu profile spans when a profiler is provided", () => {
    const testGlobal = globalThis as typeof globalThis & { RawMemory: RawMemory };
    const world = observeWorld();
    const plan = createColonyPlan(world);
    const profiler = createCpuProfiler();

    const planSpan = beginCpuSpan(profiler, "plan");
    cpuUsed = 2;
    const spawnDemandSpan = beginCpuSpan(profiler, "summarizeSpawnDemand");
    cpuUsed = 4;
    endCpuSpan(profiler, spawnDemandSpan);
    cpuUsed = 5;
    endCpuSpan(profiler, planSpan);

    recordTelemetry(world, plan, {
      harvestedEnergyBySourceId: {
        "source-1": 4
      }
    }, profiler);

    const nextProfiler = createCpuProfiler();
    const nextWorld = observeWorld();
    const nextPlan = createColonyPlan(nextWorld);

    recordTelemetry(nextWorld, nextPlan, {
      harvestedEnergyBySourceId: {
        "source-1": 4
      }
    }, nextProfiler);

    expect(JSON.parse(testGlobal.RawMemory.segments[telemetrySegmentId] as string)).toMatchObject({
      telemetry: {
        cpuGameTime: 25,
        cpu: {
          used: 5,
          limit: 20,
          tickLimit: 500,
          bucket: 10000,
          profile: [
            {
              label: "plan",
              total: 5,
              self: 3,
              calls: 1,
              children: [
                {
                  label: "summarizeSpawnDemand",
                  total: 2,
                  self: 2,
                  calls: 1,
                  children: []
                }
              ]
            },
            {
              label: "report",
              total: 0,
              self: 0,
              calls: 1,
              children: []
            }
          ]
        }
      }
    });
  });

  it("captures report cpu after the first report write completes", () => {
    const testGlobal = globalThis as typeof globalThis & { RawMemory: RawMemory };
    const storedSegments: Record<string, string> = {};

    testGlobal.RawMemory = {
      segments: new Proxy(storedSegments, {
        set(target, property, value) {
          target[String(property)] = String(value);
          cpuUsed += 2;
          return true;
        }
      }) as unknown as RawMemory["segments"],
      setActiveSegments: vi.fn()
    } as unknown as RawMemory;

    const world = observeWorld();
    const plan = createColonyPlan(world);
    const profiler = createCpuProfiler();

    const planSpan = beginCpuSpan(profiler, "plan");
    cpuUsed = 3;
    endCpuSpan(profiler, planSpan);

    recordTelemetry(world, plan, {
      harvestedEnergyBySourceId: {
        "source-1": 4
      }
    }, profiler);

    testGlobal.Game.time = 26;
    const nextWorld = observeWorld();
    const nextPlan = createColonyPlan(nextWorld);

    recordTelemetry(nextWorld, nextPlan, {
      harvestedEnergyBySourceId: {
        "source-1": 4
      }
    }, createCpuProfiler());

    expect(JSON.parse(storedSegments[telemetrySegmentId]!)).toMatchObject({
      telemetry: {
        cpuGameTime: 25,
        cpu: {
          used: 5,
          profile: [
            {
              label: "plan",
              total: 3,
              self: 3,
              calls: 1,
              children: []
            },
            {
              label: "report",
              total: 2,
              self: 2,
              calls: 1,
              children: []
            }
          ]
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
        progressTotal: 45000,
        pos: {
          x: 20,
          y: 20,
          roomName: "W0N0"
        }
      },
      energyAvailable: 300,
      energyCapacityAvailable: 300
    } as unknown as Room,
    pos: {
      x: 10,
      y: 10,
      roomName: "W0N0"
    } as RoomPosition
  } as unknown as StructureSpawn;
}

function makeSource(id: string): Source {
  return {
    id,
    energy: 3000,
    energyCapacity: 3000,
    ticksToRegeneration: 300,
    pos: {
      x: 5,
      y: 10,
      roomName: "W0N0"
    },
    room: {
      name: "W0N0"
    } as Room
  } as Source;
}
