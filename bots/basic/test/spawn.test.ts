import { beforeEach, describe, expect, it, vi } from "vitest";
import { chooseBody, createSpawnRequest, runSpawnManager, summarizeSpawnDemand } from "../src/spawn";
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
    expect(chooseBody("harvester", 150)).toBeNull();
    expect(chooseBody("worker", 300)).toEqual([WORK, CARRY, CARRY, MOVE, MOVE]);
    expect(chooseBody("courier", 700)).toEqual([CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE]);
  });

  it("spawns a harvester first", () => {
    const spawn = makeSpawn();

    const request = createSpawnRequest(spawn);

    expect(request?.memory.role).toBe("harvester");
    expect(request?.name).toBe("harvester-123");
  });

  it("spawns a courier after the first harvester", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2)
    };

    const spawn = makeSpawn();
    const request = createSpawnRequest(spawn);

    expect(request?.memory.role).toBe("harvester");
  });

  it("spawns a worker once dedicated harvester throughput is covered", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2),
      harvesterB: makeCreep("harvester", 2)
    };

    const spawn = makeSpawn();
    const request = createSpawnRequest(spawn);

    expect(request?.memory.role).toBe("worker");
  });

  it("summarizes unmet demand across dynamic roles", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2),
      harvesterB: makeCreep("harvester", 2),
      workerA: makeCreep("worker", 1)
    };

    expect(summarizeSpawnDemand(makeSpawn().room)).toEqual({
      unmetDemand: {
        harvester: 0,
        courier: 0,
        worker: 5
      },
      nextRole: "worker",
      totalUnmetDemand: 5
    });
  });

  it("keeps one extra affordable worker queued once harvest coverage is met", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2),
      harvesterB: makeCreep("harvester", 2),
      workerA: makeCreep("worker", 1),
      workerB: makeCreep("worker", 1),
      workerC: makeCreep("worker", 1),
      workerD: makeCreep("worker", 1),
      workerE: makeCreep("worker", 1),
      workerF: makeCreep("worker", 1)
    };

    expect(summarizeSpawnDemand(makeSpawn().room)).toEqual({
      unmetDemand: {
        harvester: 0,
        courier: 0,
        worker: 1
      },
      nextRole: "worker",
      totalUnmetDemand: 1
    });
  });

  it("caps pre-RCL3 worker bodies to smaller cadence packets", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2),
      harvesterB: makeCreep("harvester", 2)
    };

    const request = createSpawnRequest(makeSpawn({ energyAvailable: 550, energyCapacityAvailable: 550, controllerLevel: 2 }));

    expect(request?.memory.role).toBe("worker");
    expect(request?.body).toEqual([WORK, CARRY, CARRY, MOVE, MOVE]);
  });

  it("caps pre-RCL3 harvester bodies to smaller cadence packets", () => {
    const request = createSpawnRequest(makeSpawn({ energyAvailable: 550, energyCapacityAvailable: 550, controllerLevel: 2 }));

    expect(request?.memory.role).toBe("harvester");
    expect(request?.body).toEqual([WORK, WORK, CARRY, MOVE]);
  });

  it("waits for the full pre-RCL3 cadence packet before spawning", () => {
    const request = createSpawnRequest(makeSpawn({ energyAvailable: 250, energyCapacityAvailable: 550, controllerLevel: 2 }));

    expect(request).toBeNull();
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

function makeSpawn(input: {
  energyAvailable?: number;
  energyCapacityAvailable?: number;
  controllerLevel?: number;
} = {}): StructureSpawn {
  return {
    name: "Spawn1",
    spawning: null,
    room: {
      name: "W0N0",
      energyAvailable: input.energyAvailable ?? 300,
      energyCapacityAvailable: input.energyCapacityAvailable ?? 300,
      controller: {
        my: true,
        level: input.controllerLevel ?? 1
      },
      find: vi.fn((type: number, opts?: { filter?: (value: unknown) => boolean }) => {
        if (type === FIND_SOURCES) {
          return [
            { id: "source-a", pos: { x: 10, y: 10, roomName: "W0N0" } },
            { id: "source-b", pos: { x: 20, y: 20, roomName: "W0N0" } }
          ] as Source[];
        }
        if (type === FIND_MY_CONSTRUCTION_SITES || type === FIND_DROPPED_RESOURCES) {
          const values: unknown[] = [];
          return opts?.filter ? values.filter(opts.filter) : values;
        }

        return [];
      })
    },
    spawnCreep: vi.fn(() => OK)
  } as unknown as StructureSpawn;
}

function makeCreep(role: WorkerRole, workParts: number): Creep {
  return {
    memory: {
      role,
      homeRoom: "W0N0"
    },
    body: Array.from({ length: workParts }, () => ({ type: WORK, hits: 100 }))
  } as unknown as Creep;
}
