import { beforeEach, describe, expect, it, vi } from "vitest";
import { harvestNearestSource } from "../src/creep-utils";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("harvestNearestSource", () => {
  beforeEach(() => {
    installScreepsGlobals();
  });

  it("records the selected source id on the creep", () => {
    const source = { id: "source-a" } as Source;
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
    pos: {
      findClosestByPath: vi.fn(() => source)
    },
    harvest: vi.fn(() => OK),
    moveTo: vi.fn()
  } as unknown as Creep;
}
