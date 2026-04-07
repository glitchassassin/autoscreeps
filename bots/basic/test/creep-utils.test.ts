import { beforeEach, describe, expect, it, vi } from "vitest";
import { harvestNearestSource } from "../src/creep-utils";
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
});

function makeCreep(source: Source | null): Creep {
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
          return source ? [source] : [];
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

        return source;
      })
    },
    harvest: vi.fn(() => OK),
    moveTo: vi.fn()
  } as unknown as Creep;
}
