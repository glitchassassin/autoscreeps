import { beforeEach, describe, expect, it, vi } from "vitest";
import { createColonyPlan } from "../src/planning/colony-plan";
import { executeSpawnPlan } from "../src/execution/spawn";
import { chooseBody, summarizeSpawnDemand } from "../src/planning/spawn-plan";
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

  it("reports normal-mode role deficits once harvester and runner exist", () => {
    expect(summarizeSpawnDemand({
      creepsByRole: {
        "recovery-worker": 0,
        harvester: 1,
        runner: 1,
        upgrader: 0
      }
    }, "normal", 2)).toEqual({
      unmetDemand: {
        "recovery-worker": 0,
        harvester: 1,
        runner: 0,
        upgrader: 1
      },
      nextRole: "upgrader",
      totalUnmetDemand: 2
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
