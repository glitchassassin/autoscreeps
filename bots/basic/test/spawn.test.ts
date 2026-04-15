import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSpawnPlan } from "../src/execution/spawn";
import { chooseBody, createSpawnPlan, summarizeSpawnDemand } from "../src/planning/spawn-plan";
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
      spawns: {},
      rooms: {},
      time: 123
    } as unknown as Game;
  });

  it("builds repeated tutorial worker bodies", () => {
    expect(chooseBody("worker", 150)).toBeNull();
    expect(chooseBody("worker", 300)).toEqual([WORK, CARRY, MOVE]);
    expect(chooseBody("worker", 600)).toEqual([WORK, CARRY, MOVE, WORK, CARRY, MOVE, WORK, CARRY, MOVE]);
  });

  it("spawns workers until the target count is met", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    const spawn = makeSpawn();
    testGlobal.Game.spawns = { [spawn.name]: spawn } as Game["spawns"];
    const plan = createSpawnPlan(observeWorld());

    expect(plan.request).toMatchObject({
      spawnName: "Spawn1",
      name: "worker-123",
      memory: {
        role: "worker",
        working: false,
        homeRoom: "W0N0"
      }
    });
    expect(plan.bootstrapRoomName).toBeNull();
  });

  it("requests a bootstrap spawn site when the room is owned but no spawn exists", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    testGlobal.Game.rooms = {
      W0N0: makeOwnedRoom()
    } as Game["rooms"];

    expect(createSpawnPlan(observeWorld())).toMatchObject({
      bootstrapRoomName: "W0N0",
      request: null
    });
  });

  it("reports no demand once five workers exist", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    testGlobal.Game.creeps = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [`worker-${index}`, makeWorkerCreep("W0N0")])
    ) as Record<string, Creep>;

    expect(summarizeSpawnDemand(observeWorld())).toEqual({
      unmetDemand: { worker: 0 },
      nextRole: null,
      totalUnmetDemand: 0
    });
  });

  it("delegates to spawnCreep when a worker should be spawned", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    const spawn = makeSpawn();
    testGlobal.Game.spawns = { [spawn.name]: spawn } as Game["spawns"];
    const plan = createSpawnPlan(observeWorld());

    const result = executeSpawnPlan(plan);

    expect(result).toBe(OK);
    expect(spawn.spawnCreep).toHaveBeenCalledWith(
      [WORK, CARRY, MOVE],
      "worker-123",
      {
        memory: {
          role: "worker",
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

    const result = executeSpawnPlan(createSpawnPlan(observeWorld()));

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
      controller: {
        my: true,
        level: 1
      }
    } as Room,
    spawnCreep: vi.fn(() => OK)
  } as unknown as StructureSpawn;
}

function makeWorkerCreep(homeRoom: string): Creep {
  return {
    memory: {
      role: "worker",
      working: false,
      homeRoom
    }
  } as Creep;
}

function makeOwnedRoom(): Room {
  return {
    name: "W0N0",
    energyAvailable: 0,
    energyCapacityAvailable: 0,
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
