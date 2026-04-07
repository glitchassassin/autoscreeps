import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureBootstrapExtensions, ensureBootstrapSpawn } from "../src/bootstrap";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("ensureBootstrapSpawn", () => {
  beforeEach(() => {
    installScreepsGlobals();
    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory };

    testGlobal.Memory = {
      creeps: {}
    } as unknown as Memory;
  });

  it("creates a spawn site for an owned room with no spawn", () => {
    const createConstructionSite = vi.fn(() => OK);
    const room = makeRoom({
      controller: {
        my: true,
        pos: { x: 25, y: 25 }
      },
      createConstructionSite
    });

    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    testGlobal.Game = {
      rooms: {
        W5N5: room
      },
      creeps: {},
      spawns: {},
      time: 1
    } as unknown as Game;

    ensureBootstrapSpawn();

    expect(createConstructionSite).toHaveBeenCalledWith(25, 24, STRUCTURE_SPAWN, "W5N5-bootstrap");
  });

  it("does not create a site when a spawn already exists", () => {
    const createConstructionSite = vi.fn(() => OK);
    const room = makeRoom({
      controller: {
        my: true,
        pos: { x: 25, y: 25 }
      },
      spawns: [{} as StructureSpawn],
      createConstructionSite
    });

    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    testGlobal.Game = {
      rooms: {
        W5N5: room
      },
      creeps: {},
      spawns: {},
      time: 1
    } as unknown as Game;

    ensureBootstrapSpawn();

    expect(createConstructionSite).not.toHaveBeenCalled();
  });

  it("keeps searching beyond the initial nearby offsets", () => {
    const createConstructionSite = vi.fn((x: number, y: number) => (x === 29 && y === 25 ? OK : ERR_INVALID_TARGET));
    const blockedTiles = new Set([
      "25,23",
      "27,25",
      "25,27",
      "23,25",
      "27,23",
      "27,27",
      "23,27",
      "23,23",
      "25,22",
      "28,25",
      "25,28",
      "22,25"
    ]);
    const room = makeRoom({
      controller: {
        my: true,
        pos: { x: 25, y: 25 }
      },
      blockedTiles,
      createConstructionSite
    });

    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    testGlobal.Game = {
      rooms: {
        W5N5: room
      },
      creeps: {},
      spawns: {},
      time: 1
    } as unknown as Game;

    ensureBootstrapSpawn();

    expect(createConstructionSite).toHaveBeenCalledWith(29, 25, STRUCTURE_SPAWN, "W5N5-bootstrap");
  });
});

describe("ensureBootstrapExtensions", () => {
  beforeEach(() => {
    installScreepsGlobals();
    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory };

    testGlobal.Memory = {
      creeps: {}
    } as unknown as Memory;
  });

  it("does not create extension sites before RCL3", () => {
    const createConstructionSite = vi.fn(() => OK);
    const room = makeRoom({
      controller: {
        my: true,
        level: 2,
        pos: { x: 25, y: 25 }
      },
      spawns: [{ pos: { x: 25, y: 24 } } as StructureSpawn],
      createConstructionSite
    });

    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    testGlobal.Game = {
      rooms: {
        W5N5: room
      },
      creeps: {
        courierA: { memory: { role: "courier", homeRoom: "W5N5" } } as unknown as Creep,
        workerA: { memory: { role: "worker", homeRoom: "W5N5" } } as unknown as Creep,
        harvesterA: { memory: { role: "harvester", homeRoom: "W5N5" } } as unknown as Creep,
        harvesterB: { memory: { role: "harvester", homeRoom: "W5N5" } } as unknown as Creep
      },
      spawns: {},
      time: 1
    } as unknown as Game;

    ensureBootstrapExtensions();

    expect(createConstructionSite).not.toHaveBeenCalled();
  });
});

function makeRoom(input: {
  controller: { my: boolean; pos: { x: number; y: number }; level?: number };
  spawns?: StructureSpawn[];
  blockedTiles?: Set<string>;
  createConstructionSite: ReturnType<typeof vi.fn>;
}): Room {
  return {
    name: "W5N5",
    controller: input.controller as StructureController,
    energyAvailable: 300,
    energyCapacityAvailable: 300,
    createConstructionSite: input.createConstructionSite,
    getTerrain: () => ({
      get: (x: number, y: number) => (input.blockedTiles?.has(`${x},${y}`) ? TERRAIN_MASK_WALL : 0)
    }),
    find: (type: number, opts?: { filter?: (value: ConstructionSite | Structure) => boolean }) => {
      if (type === FIND_MY_SPAWNS) {
        return input.spawns ?? [];
      }
      if (type === FIND_MY_CONSTRUCTION_SITES) {
        const sites = [] as ConstructionSite[];
        return opts?.filter ? sites.filter(opts.filter as (site: ConstructionSite) => boolean) : sites;
      }
      if (type === FIND_MY_STRUCTURES) {
        const structures = input.spawns ?? [];
        return opts?.filter ? structures.filter(opts.filter as (structure: Structure) => boolean) : structures;
      }
      return [];
    }
  } as unknown as Room;
}
