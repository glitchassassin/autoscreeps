import { beforeEach, describe, expect, it, vi } from "vitest";
import { harvestNearestSource, updateWorkingState } from "../src/creep-utils";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("harvestNearestSource", () => {
  beforeEach(() => {
    installScreepsGlobals();
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game = {
      creeps: {},
      getObjectById: vi.fn(() => null)
    } as unknown as Game;
  });

  it("records the selected source id on the creep", () => {
    const source = { id: "source-a", pos: { x: 10, y: 10, roomName: "W0N0" } } as Source;
    const creep = makeCreep(source);

    harvestNearestSource(creep);

    expect(creep.memory.sourceId).toBe("source-a");
    expect(creep.harvest).toHaveBeenCalledWith(source);
  });

  it("clears the source id when no source can be found", () => {
    const creep = makeCreep(null);
    creep.memory.sourceId = "stale-source" as Id<Source>;

    harvestNearestSource(creep);

    expect(creep.memory.sourceId).toBeUndefined();
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("ignores spend-mode source claims when selecting a source", () => {
    const sourceA = { id: "source-a", pos: { x: 10, y: 10, roomName: "W0N0" } } as Source;
    const sourceB = { id: "source-b", pos: { x: 20, y: 20, roomName: "W0N0" } } as Source;
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      workerA: {
        memory: {
          role: "worker",
          working: true,
          homeRoom: "W0N0",
          sourceId: sourceA.id
        }
      } as unknown as Creep
    };

    const creep = makeCreep([sourceA, sourceB]);

    harvestNearestSource(creep);

    expect(creep.memory.sourceId).toBe(sourceA.id);
    expect(creep.harvest).toHaveBeenCalledWith(sourceA);
  });
});

describe("updateWorkingState", () => {
  beforeEach(() => {
    installScreepsGlobals();
  });

  it("clears the remembered source while spending energy", () => {
    const creep = {
      memory: {
        role: "worker",
        working: true,
        homeRoom: "W0N0",
        sourceId: "source-a"
      },
      store: {
        energy: 50,
        getFreeCapacity: vi.fn(() => 0)
      }
    } as unknown as Creep;

    updateWorkingState(creep);

    expect(creep.memory.working).toBe(true);
    expect(creep.memory.sourceId).toBeUndefined();
  });
});

function makeCreep(source: Source | Source[] | null): Creep {
  const sources = Array.isArray(source) ? source : source ? [source] : [];

  return {
    memory: {
      role: "harvester",
      working: false,
      homeRoom: "W0N0"
    },
    room: {
      name: "W0N0",
      find: vi.fn((type: number) => {
        if (type === FIND_SOURCES_ACTIVE || type === FIND_SOURCES) {
          return sources;
        }

        return [];
      })
    },
    pos: {
      x: 10,
      y: 11,
      roomName: "W0N0",
      findClosestByPath: vi.fn((value: Source[] | number) => {
        if (Array.isArray(value)) {
          return value[0] ?? null;
        }

        return sources[0] ?? null;
      })
    },
    harvest: vi.fn(() => OK),
    moveTo: vi.fn()
  } as unknown as Creep;
}
