import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWorker } from "../src/roles/worker";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("runWorker", () => {
  beforeEach(() => {
    installScreepsGlobals();
    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory };

    testGlobal.Game = {
      creeps: {},
      spawns: {},
      time: 1,
      getObjectById: vi.fn(() => null)
    } as unknown as Game;

    testGlobal.Memory = {
      creeps: {},
      telemetry: {
        creepDeaths: 0,
        firstOwnedSpawnTick: null,
        rcl2Tick: null,
        rcl3Tick: null
      }
    } as unknown as Memory;
  });

  it("builds a nearby extension site before upgrading", () => {
    const creep = makeWorker({ sitePos: { x: 12, y: 11, roomName: "W0N0" }, controllerLevel: 3 });

    runWorker(creep);

    expect(creep.build).toHaveBeenCalledTimes(1);
    expect(creep.upgradeController).not.toHaveBeenCalled();
  });

  it("upgrades instead of building before RCL3", () => {
    const creep = makeWorker({ sitePos: { x: 12, y: 11, roomName: "W0N0" }, controllerLevel: 2 });

    runWorker(creep);

    expect(creep.build).not.toHaveBeenCalled();
    expect(creep.upgradeController).toHaveBeenCalledTimes(1);
  });

  it("picks up dropped energy before RCL3 when empty", () => {
    const creep = makeWorker({
      sitePos: { x: 12, y: 11, roomName: "W0N0" },
      controllerLevel: 2,
      energy: 0,
      freeCapacity: 50,
      droppedResources: [
        {
          id: "drop-1",
          amount: 100,
          pos: { x: 12, y: 10, roomName: "W0N0" },
          resourceType: RESOURCE_ENERGY
        } as Resource<ResourceConstant>
      ]
    });

    runWorker(creep);

    expect(creep.pickup).toHaveBeenCalledTimes(1);
    expect(creep.harvest).not.toHaveBeenCalled();
    expect(creep.upgradeController).not.toHaveBeenCalled();
  });

  it("upgrades instead of feeding the spawn before RCL3", () => {
    const creep = makeWorker({ sitePos: { x: 12, y: 11, roomName: "W0N0" }, controllerLevel: 2, spawnFreeCapacity: 300 });

    runWorker(creep);

    expect(creep.transfer).not.toHaveBeenCalled();
    expect(creep.upgradeController).toHaveBeenCalledTimes(1);
  });

  it("falls back to source-adjacent drops when no handoff drop exists", () => {
    const creep = makeWorker({
      sitePos: { x: 12, y: 11, roomName: "W0N0" },
      controllerLevel: 2,
      energy: 0,
      freeCapacity: 50,
      droppedResources: [
        {
          id: "drop-1",
          amount: 100,
          pos: { x: 9, y: 10, roomName: "W0N0" },
          resourceType: RESOURCE_ENERGY
        } as Resource<ResourceConstant>
      ]
    });

    runWorker(creep);

    expect(creep.pickup).toHaveBeenCalledTimes(1);
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("defaults to upgrading when the nearest build site is far away", () => {
    const creep = makeWorker({ sitePos: { x: 20, y: 20, roomName: "W0N0" }, controllerLevel: 3 });

    runWorker(creep);

    expect(creep.build).not.toHaveBeenCalled();
    expect(creep.upgradeController).toHaveBeenCalledTimes(1);
  });
});

function makeWorker(input: {
  sitePos: { x: number; y: number; roomName: string };
  controllerLevel: number;
  energy?: number;
  freeCapacity?: number;
  spawnFreeCapacity?: number;
  workParts?: number;
  droppedResources?: Resource<ResourceConstant>[];
}): Creep {
  const site = {
    id: "site-1",
    pos: input.sitePos,
    structureType: STRUCTURE_EXTENSION
  } as ConstructionSite;
  const spawn = {
    id: "spawn-1",
    pos: { x: 13, y: 11, roomName: "W0N0" },
    structureType: STRUCTURE_SPAWN,
    store: {
      getFreeCapacity: vi.fn(() => input.spawnFreeCapacity ?? 0)
    }
  } as unknown as StructureSpawn;
  const source = {
    id: "source-1",
    pos: { x: 9, y: 9, roomName: "W0N0" }
  } as Source;
  const controller = {
    id: "controller-1",
    pos: { x: 10, y: 10, roomName: "W0N0" },
    my: true,
    level: input.controllerLevel
  } as StructureController;

  return {
    memory: {
      role: "worker",
      working: true,
      homeRoom: "W0N0"
    },
    room: {
      name: "W0N0",
      energyAvailable: 300,
      energyCapacityAvailable: 300,
      controller,
      find: vi.fn((type: number, opts?: { filter?: (value: unknown) => boolean }) => {
        if (type === FIND_MY_CONSTRUCTION_SITES) {
          const sites = [site];
          return opts?.filter ? sites.filter(opts.filter) : sites;
        }
        if (type === FIND_MY_STRUCTURES) {
          const structures = [spawn];
          return opts?.filter ? structures.filter(opts.filter) : structures;
        }
        if (type === FIND_SOURCES || type === FIND_SOURCES_ACTIVE) {
          return [source];
        }
        if (type === FIND_DROPPED_RESOURCES) {
          const resources = input.droppedResources ?? [];
          return opts?.filter ? resources.filter(opts.filter) : resources;
        }

        return [];
      })
    } as unknown as Room,
    pos: {
      x: 11,
      y: 11,
      roomName: "W0N0",
      findClosestByPath: vi.fn((value: unknown[] | number) => Array.isArray(value) ? value[0] ?? null : source)
    },
    store: {
      energy: input.energy ?? 50,
      getFreeCapacity: vi.fn(() => input.freeCapacity ?? 0)
    },
    body: Array.from({ length: input.workParts ?? 1 }, () => ({ type: WORK, hits: 100 })),
    harvest: vi.fn(() => OK),
    pickup: vi.fn(() => OK),
    transfer: vi.fn(() => OK),
    build: vi.fn(() => OK),
    upgradeController: vi.fn(() => OK),
    moveTo: vi.fn()
  } as unknown as Creep;
}
