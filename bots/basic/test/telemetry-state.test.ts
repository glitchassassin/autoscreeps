import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureTelemetryState, observeTelemetryTick, recordTelemetryAction } from "../src/telemetry-state";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("telemetry spend attribution", () => {
  beforeEach(() => {
    installScreepsGlobals();
    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory };

    testGlobal.Memory = {
      creeps: {},
      telemetry: {
        creepDeaths: 0,
        firstOwnedSpawnTick: null,
        rcl2Tick: null,
        rcl3Tick: null
      }
    } as unknown as Memory;

    testGlobal.Game = {
      creeps: {},
      rooms: {
        W0N0: {
          find: vi.fn(() => [])
        } as unknown as Room
      },
      spawns: {},
      time: 1,
      getObjectById: vi.fn(() => null)
    } as unknown as Game;
  });

  it("attributes upgrade spend on the following tick", () => {
    const creep = installCreep("creepA", "harvester", 50, true);

    recordTelemetryAction(creep, "upgrade", OK, {
      targetType: "controller",
      targetKey: "controller-1"
    });
    observeTelemetryTick();

    expect(ensureTelemetryState().loop?.energySpentOnUpgrade).toBe(0);

    setEnergy(creep, 48);
    advanceTick();
    observeTelemetryTick();

    expect(ensureTelemetryState().loop?.energySpentOnUpgrade).toBe(2);

    advanceTick();
    observeTelemetryTick();

    expect(ensureTelemetryState().loop?.energySpentOnUpgrade).toBe(2);
  });

  it("attributes build spend on the following tick", () => {
    const creep = installCreep("creepA", "harvester", 50, true);

    recordTelemetryAction(creep, "build", OK, {
      targetType: STRUCTURE_EXTENSION,
      targetKey: "site-1"
    });
    observeTelemetryTick();

    setEnergy(creep, 45);
    advanceTick();
    observeTelemetryTick();

    expect(ensureTelemetryState().loop?.energySpentOnBuild).toBe(5);
  });

  it("attributes delivered transfer energy on the following tick", () => {
    const creep = installCreep("creepA", "harvester", 50, true);

    recordTelemetryAction(creep, "transfer", OK, {
      targetType: STRUCTURE_SPAWN,
      targetKey: "spawn-1"
    });
    observeTelemetryTick();

    setEnergy(creep, 0);
    advanceTick();
    observeTelemetryTick();

    expect(ensureTelemetryState().loop?.deliveredEnergyByTargetType[STRUCTURE_SPAWN]).toBe(50);
  });

  it("attributes harvested energy to the active source on the same tick", () => {
    const creep = installCreep("creepA", "harvester", 0, false, "source-1");

    recordTelemetryAction(creep, "harvest", OK, {
      sourceId: "source-1",
      targetKey: "source-1"
    });
    setEnergy(creep, 4);
    observeTelemetryTick();

    expect(ensureTelemetryState().sources?.["source-1"]?.harvestedEnergy).toBe(4);
  });
});

function installCreep(name: string, role: WorkerRole, energy: number, working: boolean, sourceId?: string): Creep {
  const creep = {
    name,
    memory: {
      role,
      working,
      homeRoom: "W0N0",
      sourceId
    },
    pos: {
      x: 10,
      y: 10,
      roomName: "W0N0"
    },
    store: {
      energy,
      getFreeCapacity: vi.fn(() => 50)
    }
  } as unknown as Creep;

  const testGlobal = globalThis as typeof globalThis & { Game: Game };
  testGlobal.Game.creeps[name] = creep;
  return creep;
}

function setEnergy(creep: Creep, energy: number): void {
  (creep.store as unknown as { energy: number }).energy = energy;
}

function advanceTick(): void {
  const testGlobal = globalThis as typeof globalThis & { Game: Game };
  testGlobal.Game.time += 1;
}
