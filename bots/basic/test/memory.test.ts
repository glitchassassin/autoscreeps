import { beforeEach, describe, expect, it } from "vitest";
import { cleanupDeadCreeps } from "../src/memory";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("cleanupDeadCreeps", () => {
  beforeEach(() => {
    installScreepsGlobals();
    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory };

    testGlobal.Game = {
      creeps: {
        alive: {} as Creep
      },
      spawns: {},
      time: 1
    } as unknown as Game;

    testGlobal.Memory = {
      creeps: {
        alive: {
          role: "harvester",
          working: false,
          homeRoom: "W0N0"
        },
        missing: {
          role: "upgrader",
          working: true,
          homeRoom: "W0N0"
        }
      }
    } as unknown as Memory;
  });

  it("removes memory for creeps that no longer exist", () => {
    cleanupDeadCreeps();

    expect(Memory.creeps.alive).toBeDefined();
    expect(Memory.creeps.missing).toBeUndefined();
  });
});
