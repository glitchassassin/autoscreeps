import { beforeEach, describe, expect, it, vi } from "vitest";
import { chooseBody, createSpawnRequest, runSpawnManager } from "../src/spawn";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("spawn manager", () => {
  beforeEach(() => {
    installScreepsGlobals();
    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory };

    testGlobal.Memory = {
      creeps: {}
    } as unknown as Memory;

    testGlobal.Game = {
      creeps: {},
      spawns: {},
      time: 123
    } as unknown as Game;
  });

  it("picks the best body it can afford", () => {
    expect(chooseBody(150)).toBeNull();
    expect(chooseBody(300)).toEqual([WORK, WORK, CARRY, MOVE]);
    expect(chooseBody(700)).toEqual([WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE]);
  });

  it("spawns harvesters before upgraders", () => {
    const spawn = makeSpawn();

    const request = createSpawnRequest(spawn);

    expect(request?.memory.role).toBe("harvester");
    expect(request?.name).toBe("harvester-123");
  });

  it("spawns an upgrader once harvesters are covered", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: { memory: { role: "harvester" } } as Creep,
      harvesterB: { memory: { role: "harvester" } } as Creep
    };

    const spawn = makeSpawn();
    const request = createSpawnRequest(spawn);

    expect(request?.memory.role).toBe("upgrader");
  });

  it("passes the planned body and memory into spawnCreep", () => {
    const spawn = makeSpawn();

    runSpawnManager(spawn);

    expect(spawn.spawnCreep).toHaveBeenCalledWith(
      [WORK, WORK, CARRY, MOVE],
      "harvester-123",
      {
        memory: {
          role: "harvester",
          working: false,
          homeRoom: "W0N0"
        }
      }
    );
  });
});

function makeSpawn(): StructureSpawn {
  return {
    name: "Spawn1",
    spawning: null,
    room: {
      name: "W0N0",
      energyAvailable: 300
    },
    spawnCreep: vi.fn(() => OK)
  } as unknown as StructureSpawn;
}
