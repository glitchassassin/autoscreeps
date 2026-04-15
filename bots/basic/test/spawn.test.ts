import { beforeEach, describe, expect, it, vi } from "vitest";
import { createColonyPlan } from "../src/planning/colony-plan";
import { executeSpawnPlan } from "../src/execution/spawn";
import { chooseBody, summarizeSpawnDemand } from "../src/planning/spawn-plan";
import { createSitePlans } from "../src/planning/site-plan";
import type { WorldSnapshot } from "../src/core/types";
import { observeWorld } from "../src/world/observe";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("spawn manager", () => {
  beforeEach(() => {
    installScreepsGlobals();
    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory };

    testGlobal.Memory = {
      creeps: {}
    } as Memory;

    testGlobal.Game = {
      creeps: {},
      constructionSites: {},
      getObjectById: vi.fn(() => null),
      spawns: {},
      rooms: {},
      time: 123
    } as unknown as Game;
  });

  it("builds repeated role-specific bodies", () => {
    expect(chooseBody("recovery-worker", 150)).toBeNull();
    expect(chooseBody("recovery-worker", 300)).toEqual([WORK, CARRY, MOVE]);
    expect(chooseBody("harvester", 300)).toEqual([WORK, WORK, MOVE]);
    expect(chooseBody("harvester", 500)).toEqual([WORK, WORK, WORK, WORK, MOVE, MOVE]);
    expect(chooseBody("harvester", 650)).toEqual([WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE]);
    expect(chooseBody("runner", 300)).toEqual([CARRY, MOVE, CARRY, MOVE, CARRY, MOVE]);
    expect(chooseBody("upgrader", 600)).toEqual([WORK, CARRY, MOVE, WORK, CARRY, MOVE, WORK, CARRY, MOVE]);
  });

  it("spawns a recovery worker first while the colony is recovering", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    const spawn = makeSpawn();
    testGlobal.Game.spawns = { [spawn.name]: spawn } as Game["spawns"];
    testGlobal.Game.rooms = { W0N0: spawn.room } as Game["rooms"];
    const plan = createColonyPlan(observeWorld());

    expect(plan.spawn.request).toMatchObject({
      spawnName: "Spawn1",
      name: "recovery-worker-123",
      memory: {
        role: "recovery-worker",
        working: false,
        homeRoom: "W0N0"
      }
    });
    expect(plan.spawn.bootstrapRoomName).toBeNull();
  });

  it("requests a bootstrap spawn site when the room is owned but no spawn exists", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    testGlobal.Game.rooms = {
      W0N0: makeOwnedRoom()
    } as Game["rooms"];

    expect(createColonyPlan(observeWorld()).spawn).toMatchObject({
      bootstrapRoomName: "W0N0",
      request: null
    });
  });

  it("prioritizes hauling demand before upgraders in normal mode", () => {
    const world = makeDemandWorld({
      creeps: [
        makeDemandCreepSnapshot("harvester-a", "harvester", { activeWorkParts: 2, bodyCost: 250 }),
        makeDemandCreepSnapshot("runner-a", "runner", { activeCarryParts: 1, bodyCost: 100 })
      ]
    });

    expect(summarizeSpawnDemand(world, "normal", createSitePlans(world))).toEqual({
      inputs: {
        harvest: {
          requiredWorkParts: 10,
          coveredWorkParts: 2,
          plannedWorkPartsPerCreep: 4,
          targetCount: 4,
          coverage: 0.2
        },
        haul: {
          requiredCarryParts: 6,
          coveredCarryParts: 1,
          plannedCarryPartsPerCreep: 5,
          targetCount: 2,
          coverage: 1 / 6
        },
        upgrade: {
          surplusBudgetEpt: 18,
          coveredNetEpt: 0,
          plannedNetEptPerCreep: 2.512676056338028,
          targetCount: 8,
          coverage: 0
        }
      },
      unmetDemand: {
        "recovery-worker": 0,
        harvester: 3,
        runner: 1,
        upgrader: 8
      },
      nextRole: "runner",
      totalUnmetDemand: 12
    });
  });

  it("delegates to spawnCreep for the planned recovery worker", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    const spawn = makeSpawn();
    testGlobal.Game.spawns = { [spawn.name]: spawn } as Game["spawns"];
    testGlobal.Game.rooms = { W0N0: spawn.room } as Game["rooms"];
    const plan = createColonyPlan(observeWorld()).spawn;

    const result = executeSpawnPlan(plan);

    expect(result).toBe(OK);
    expect(spawn.spawnCreep).toHaveBeenCalledWith(
      [WORK, CARRY, MOVE],
      "recovery-worker-123",
      {
        memory: {
          role: "recovery-worker",
          working: false,
          homeRoom: "W0N0"
        }
      }
    );
  });

  it("places a bootstrap spawn site before the first spawn exists", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    const room = makeOwnedRoom();
    testGlobal.Game.rooms = {
      W0N0: room
    } as Game["rooms"];

    const result = executeSpawnPlan(createColonyPlan(observeWorld()).spawn);

    expect(result).toBe(OK);
    expect(room.createConstructionSite).toHaveBeenCalledWith(7, 7, STRUCTURE_SPAWN);
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
      find: vi.fn((type: FindConstant) => {
        if (type === FIND_SOURCES) {
          return [makeSource("source-1"), makeSource("source-2")];
        }

        return [];
      }),
      controller: {
        my: true,
        level: 1,
        pos: {
          x: 10,
          y: 10,
          roomName: "W0N0"
        }
      }
    } as unknown as Room,
    pos: {
      x: 10,
      y: 10,
      roomName: "W0N0"
    } as RoomPosition,
    spawnCreep: vi.fn(() => OK)
  } as unknown as StructureSpawn;
}

function makeOwnedRoom(): Room {
  return {
    name: "W0N0",
    energyAvailable: 0,
    energyCapacityAvailable: 0,
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_SOURCES) {
        return [makeSource("source-1"), makeSource("source-2")];
      }

      return [];
    }),
    controller: {
      my: true,
      level: 1,
      pos: {
        x: 10,
        y: 10,
        roomName: "W0N0"
      }
    } as StructureController,
    createConstructionSite: vi.fn(() => OK)
  } as unknown as Room;
}

function makeSource(id: string): Source {
  return {
    id,
    energy: 3000,
    energyCapacity: 3000,
    ticksToRegeneration: 300,
    pos: {
      x: id === "source-1" ? 5 : 15,
      y: 10,
      roomName: "W0N0"
    },
    room: {
      name: "W0N0"
    } as Room
  } as Source;
}

function makeDemandWorld(input: { creeps: WorldSnapshot["creeps"] }): WorldSnapshot {
  return {
    gameTime: 1,
    primarySpawnName: "Spawn1",
    primarySpawnConstructionSiteCount: 0,
    primarySpawnSpawning: false,
    primaryRoomName: "W0N0",
    primaryRoomEnergyAvailable: 600,
    primaryRoomEnergyCapacityAvailable: 600,
    primarySpawnToControllerPathLength: 10,
    primaryController: {
      level: 2,
      progress: 0,
      progressTotal: 45000
    },
    maxOwnedControllerLevel: 2,
    totalCreeps: input.creeps.length,
    creepsByRole: {
      "recovery-worker": input.creeps.filter((creep) => creep.role === "recovery-worker").length,
      harvester: input.creeps.filter((creep) => creep.role === "harvester").length,
      runner: input.creeps.filter((creep) => creep.role === "runner").length,
      upgrader: input.creeps.filter((creep) => creep.role === "upgrader").length
    },
    creeps: input.creeps,
    sources: [
      {
        sourceId: "source-1",
        roomName: "W0N0",
        x: 5,
        y: 10,
        energy: 3000,
        energyCapacity: 3000,
        ticksToRegeneration: 300,
        pathLengthToPrimarySpawn: 5
      },
      {
        sourceId: "source-2",
        roomName: "W0N0",
        x: 15,
        y: 10,
        energy: 3000,
        energyCapacity: 3000,
        ticksToRegeneration: 300,
        pathLengthToPrimarySpawn: 5
      }
    ]
  };
}

function makeDemandCreepSnapshot(
  name: string,
  role: WorkerRole,
  input: { activeWorkParts?: number; activeCarryParts?: number; bodyCost: number }
): WorldSnapshot["creeps"][number] {
  return {
    name,
    role,
    homeRoom: "W0N0",
    roomName: "W0N0",
    working: false,
    activeWorkParts: input.activeWorkParts ?? 0,
    activeCarryParts: input.activeCarryParts ?? 0,
    storeEnergy: 0,
    freeCapacity: 50,
    bodyCost: input.bodyCost
  };
}
