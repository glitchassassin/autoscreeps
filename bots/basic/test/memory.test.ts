import { beforeEach, describe, expect, it } from "vitest";
import { cleanupDeadCreeps } from "../src/state/reconcile-creeps";
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
          role: "worker",
          working: false,
          homeRoom: "W0N0"
        },
        missing: {
          role: "worker",
          working: true,
          homeRoom: "W0N0"
        }
      },
      telemetry: {
        creepDeaths: 0,
        firstOwnedSpawnTick: null,
        rcl2Tick: null,
        rcl3Tick: null
      }
    } as unknown as Memory;
  });

  it("removes memory for creeps that no longer exist", () => {
    cleanupDeadCreeps();

    expect(Memory.creeps.alive).toBeDefined();
    expect(Memory.creeps.missing).toBeUndefined();
    expect(Memory.telemetry?.creepDeaths).toBe(1);
  });
});
