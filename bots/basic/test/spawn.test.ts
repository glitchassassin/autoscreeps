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

    expect(request?.memory.role).toBe("courier");
  });

  it("spawns a second harvester once the first courier exists", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2),
      courierA: makeCreep("courier", 0)
    };

    const spawn = makeSpawn();
    const request = createSpawnRequest(spawn);

    expect(request?.memory.role).toBe("harvester");
  });

  it("spawns a worker once both source sitters are active", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-a",
        pos: { x: 10, y: 11, roomName: "W0N0" }
      }),
      harvesterB: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-b",
        pos: { x: 20, y: 21, roomName: "W0N0" }
      }),
      courierA: makeCreep("courier", 0)
    };

    const spawn = makeSpawn();
    const request = createSpawnRequest(spawn);

    expect(request?.memory.role).toBe("worker");
  });

  it("summarizes unmet demand across dynamic roles", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-a",
        pos: { x: 10, y: 11, roomName: "W0N0" }
      }),
      harvesterB: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-b",
        pos: { x: 20, y: 21, roomName: "W0N0" }
      }),
      courierA: makeCreep("courier", 0),
      workerA: makeCreep("worker", 1)
    };

    expect(summarizeSpawnDemand(makeSpawn().room)).toEqual({
      unmetDemand: {
        harvester: 0,
        courier: 0,
        worker: 0
      },
      nextRole: null,
      totalUnmetDemand: 0
    });
  });

  it("adds a second courier when backlog remains after the first worker", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-a",
        pos: { x: 10, y: 11, roomName: "W0N0" }
      }),
      harvesterB: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-b",
        pos: { x: 20, y: 21, roomName: "W0N0" }
      }),
      courierA: makeCreep("courier", 0),
      workerA: makeCreep("worker", 1)
    };

    const spawn = makeSpawn({ droppedResources: [makeDroppedEnergy(200, { x: 9, y: 10, roomName: "W0N0" })] });

    expect(summarizeSpawnDemand(spawn.room)).toEqual({
      unmetDemand: {
        harvester: 0,
        courier: 1,
        worker: 0
      },
      nextRole: "courier",
      totalUnmetDemand: 1
    });
  });

  it("expands pre-RCL3 worker demand once source sitters, runners, bank coverage, and reserve are in place", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-a",
        pos: { x: 10, y: 11, roomName: "W0N0" }
      }),
      harvesterB: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-b",
        pos: { x: 20, y: 21, roomName: "W0N0" }
      }),
      courierA: makeCreep("courier", 0, { storedEnergy: 50 }),
      courierB: makeCreep("courier", 0),
      workerA: makeCreep("worker", 1),
      workerB: makeCreep("worker", 1)
    };

    expect(summarizeSpawnDemand(makeSpawn().room)).toEqual({
      unmetDemand: {
        harvester: 0,
        courier: 0,
        worker: 2
      },
      nextRole: "worker",
      totalUnmetDemand: 2
    });
  });

  it("prefers courier three before worker four when source backlog stays high", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-a",
        pos: { x: 10, y: 11, roomName: "W0N0" }
      }),
      harvesterB: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-b",
        pos: { x: 20, y: 21, roomName: "W0N0" }
      }),
      courierA: makeCreep("courier", 0),
      courierB: makeCreep("courier", 0),
      workerA: makeCreep("worker", 1),
      workerB: makeCreep("worker", 1),
      workerC: makeCreep("worker", 1)
    };

    const spawn = makeSpawn({
      droppedResources: [
        makeDroppedEnergy(320, { x: 9, y: 10, roomName: "W0N0" }),
        makeDroppedEnergy(300, { x: 19, y: 20, roomName: "W0N0" })
      ]
    });

    expect(summarizeSpawnDemand(spawn.room)).toEqual({
      unmetDemand: {
        harvester: 0,
        courier: 1,
        worker: 0
      },
      nextRole: "courier",
      totalUnmetDemand: 1
    });
  });

  it("allows worker four once courier three exists under high backlog", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-a",
        pos: { x: 10, y: 11, roomName: "W0N0" }
      }),
      harvesterB: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-b",
        pos: { x: 20, y: 21, roomName: "W0N0" }
      }),
      courierA: makeCreep("courier", 0),
      courierB: makeCreep("courier", 0),
      courierC: makeCreep("courier", 0),
      workerA: makeCreep("worker", 1),
      workerB: makeCreep("worker", 1),
      workerC: makeCreep("worker", 1)
    };

    const spawn = makeSpawn({
      droppedResources: [
        makeDroppedEnergy(320, { x: 9, y: 10, roomName: "W0N0" }),
        makeDroppedEnergy(300, { x: 19, y: 20, roomName: "W0N0" })
      ]
    });

    expect(summarizeSpawnDemand(spawn.room)).toEqual({
      unmetDemand: {
        harvester: 0,
        courier: 0,
        worker: 1
      },
      nextRole: "worker",
      totalUnmetDemand: 1
    });
  });

  it("records the first courier three admission context on spawn start", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-a",
        pos: { x: 10, y: 11, roomName: "W0N0" }
      }),
      harvesterB: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-b",
        pos: { x: 20, y: 21, roomName: "W0N0" }
      }),
      courierA: makeCreep("courier", 0),
      courierB: makeCreep("courier", 0),
      workerA: makeCreep("worker", 1),
      workerB: makeCreep("worker", 1),
      workerC: makeCreep("worker", 1)
    };

    runSpawnManager(makeSpawn({
      droppedResources: [
        makeDroppedEnergy(320, { x: 9, y: 10, roomName: "W0N0" }),
        makeDroppedEnergy(300, { x: 19, y: 20, roomName: "W0N0" })
      ]
    }));

    expect(testGlobal.Memory.telemetry?.spawnAdmissions?.firstCourier3).toEqual({
      gameTime: 123,
      sourceBacklog: 620,
      loadedCouriers: 0,
      roleCounts: {
        harvester: 2,
        courier: 2,
        worker: 3
      },
      openReasons: ["source_backlog"]
    });
  });

  it("records the first worker four admission context on spawn start", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-a",
        pos: { x: 10, y: 11, roomName: "W0N0" }
      }),
      harvesterB: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-b",
        pos: { x: 20, y: 21, roomName: "W0N0" }
      }),
      courierA: makeCreep("courier", 0),
      courierB: makeCreep("courier", 0),
      courierC: makeCreep("courier", 0),
      workerA: makeCreep("worker", 1),
      workerB: makeCreep("worker", 1),
      workerC: makeCreep("worker", 1)
    };

    runSpawnManager(makeSpawn({
      droppedResources: [
        makeDroppedEnergy(320, { x: 9, y: 10, roomName: "W0N0" }),
        makeDroppedEnergy(300, { x: 19, y: 20, roomName: "W0N0" })
      ]
    }));

    expect(testGlobal.Memory.telemetry?.spawnAdmissions?.firstWorker4).toEqual({
      gameTime: 123,
      sourceBacklog: 620,
      loadedCouriers: 0,
      roleCounts: {
        harvester: 2,
        courier: 3,
        worker: 3
      },
      openReasons: ["source_backlog", "courier_parity"]
    });
  });

  it("keeps the extra pre-RCL3 worker demand gated behind spawn-bank coverage", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-a",
        pos: { x: 10, y: 11, roomName: "W0N0" }
      }),
      harvesterB: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-b",
        pos: { x: 20, y: 21, roomName: "W0N0" }
      }),
      courierA: makeCreep("courier", 0),
      courierB: makeCreep("courier", 0),
      workerA: makeCreep("worker", 1),
      workerB: makeCreep("worker", 1)
    };

    expect(summarizeSpawnDemand(makeSpawn({ energyAvailable: 250 }).room)).toEqual({
      unmetDemand: {
        harvester: 0,
        courier: 0,
        worker: 0
      },
      nextRole: null,
      totalUnmetDemand: 0
    });
  });

  it("keeps the extra pre-RCL3 worker demand gated behind actual reserve, not just bank coverage", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-a",
        pos: { x: 10, y: 11, roomName: "W0N0" }
      }),
      harvesterB: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-b",
        pos: { x: 20, y: 21, roomName: "W0N0" }
      }),
      courierA: makeCreep("courier", 0),
      courierB: makeCreep("courier", 0),
      workerA: makeCreep("worker", 1),
      workerB: makeCreep("worker", 1)
    };

    expect(summarizeSpawnDemand(makeSpawn().room)).toEqual({
      unmetDemand: {
        harvester: 0,
        courier: 0,
        worker: 0
      },
      nextRole: null,
      totalUnmetDemand: 0
    });
  });

  it("does not spawn a worker before both source sitters are active", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-a",
        pos: { x: 10, y: 11, roomName: "W0N0" }
      }),
      harvesterB: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-b",
        pos: { x: 25, y: 25, roomName: "W0N0" }
      }),
      courierA: makeCreep("courier", 0)
    };

    expect(summarizeSpawnDemand(makeSpawn().room)).toEqual({
      unmetDemand: {
        harvester: 0,
        courier: 0,
        worker: 0
      },
      nextRole: null,
      totalUnmetDemand: 0
    });
  });

  it("caps pre-RCL3 worker bodies to smaller cadence packets", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      harvesterA: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-a",
        pos: { x: 10, y: 11, roomName: "W0N0" }
      }),
      harvesterB: makeCreep("harvester", 2, {
        working: false,
        sourceId: "source-b",
        pos: { x: 20, y: 21, roomName: "W0N0" }
      }),
      courierA: makeCreep("courier", 0)
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
  droppedResources?: Resource<ResourceConstant>[];
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
        if (type === FIND_DROPPED_RESOURCES) {
          const values = input.droppedResources ?? [];
          return opts?.filter ? values.filter(opts.filter) : values;
        }
        if (type === FIND_MY_CONSTRUCTION_SITES) {
          const values: unknown[] = [];
          return opts?.filter ? values.filter(opts.filter) : values;
        }

        return [];
      })
    },
    spawnCreep: vi.fn(() => OK)
  } as unknown as StructureSpawn;
}

function makeCreep(
  role: WorkerRole,
  workParts: number,
  input: {
    working?: boolean;
    sourceId?: string;
    pos?: { x: number; y: number; roomName: string };
    storedEnergy?: number;
  } = {}
): Creep {
  return {
    memory: {
      role,
      working: input.working ?? true,
      homeRoom: "W0N0",
      sourceId: input.sourceId
    },
    body: Array.from({ length: workParts }, () => ({ type: WORK, hits: 100 })),
    store: {
      [RESOURCE_ENERGY]: input.storedEnergy ?? 0
    },
    pos: input.pos ?? { x: 15, y: 15, roomName: "W0N0" }
  } as unknown as Creep;
}

function makeDroppedEnergy(amount: number, pos: { x: number; y: number; roomName: string }): Resource<ResourceConstant> {
  return {
    id: `${pos.x}-${pos.y}`,
    amount,
    pos,
    resourceType: RESOURCE_ENERGY
  } as Resource<ResourceConstant>;
}
