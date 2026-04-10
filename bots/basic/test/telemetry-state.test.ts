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

  it("attributes bank-low delivery and pickup-to-bank latency on the following tick", () => {
    const creep = installCreep("courierA", "courier", 0, false);

    Memory.telemetry!.drops = {
      "drop-1": {
        firstSeenTick: 1,
        sourceId: "source-1",
        pickupLatencyRecorded: false
      }
    };

    recordTelemetryAction(creep, "pickup", OK, {
      targetType: "drop",
      targetKey: "drop-1",
      dropId: "drop-1"
    });
    observeTelemetryTick();

    setEnergy(creep, 50);
    advanceTick();
    observeTelemetryTick();

    creep.memory.working = true;
    advanceTick();
    recordTelemetryAction(creep, "transfer", OK, {
      targetType: STRUCTURE_SPAWN,
      targetKey: "spawn-1"
    });
    observeTelemetryTick();

    Memory.telemetry!.bank = {
      wasLow: true,
      lowTickStartedAt: 1,
      loadedCourierNames: ["courierA"],
      spawnAdjacentLoadedCourierNames: ["courierA"],
      workerWithEnergyNames: [],
      sourceBacklog: 300
    };

    setEnergy(creep, 0);
    advanceTick();
    observeTelemetryTick();

    expect(ensureTelemetryState().loop).toMatchObject({
      deliveredEnergyByTargetType: {
        [STRUCTURE_SPAWN]: 50
      },
      bankLowDeliveredEnergyByTargetType: {
        [STRUCTURE_SPAWN]: 50
      },
      pickupToBankLatencyTotal: 3,
      pickupToBankLatencySamples: 1,
      sourceDropToBankLatencyTotal: 3,
      sourceDropToBankLatencySamples: 1
    });
  });

  it("tracks bank-low waiting counters and extra-worker gate reasons", () => {
    const sourceA = { id: "source-a", pos: { x: 10, y: 10, roomName: "W0N0" } } as Source;
    const sourceB = { id: "source-b", pos: { x: 20, y: 20, roomName: "W0N0" } } as Source;
    const spawn = {
      name: "Spawn1",
      spawning: null,
      room: {
        name: "W0N0",
        energyAvailable: 300,
        energyCapacityAvailable: 300,
        controller: {
          my: true,
          level: 2
        },
        find: (type: number, opts?: { filter?: (value: any) => boolean }) => {
          if (type === FIND_SOURCES) {
            return [sourceA, sourceB];
          }
          if (type === FIND_MY_STRUCTURES) {
            const structures = [{
              id: "spawn-1",
              structureType: STRUCTURE_SPAWN,
              pos: { x: 15, y: 15, roomName: "W0N0" },
              store: { getFreeCapacity: vi.fn(() => 300) }
            }] as unknown as Structure[];

            return opts?.filter ? structures.filter(opts.filter) : structures;
          }
          if (type === FIND_DROPPED_RESOURCES) {
            const drops = [
              { id: "drop-a", resourceType: RESOURCE_ENERGY, amount: 200, pos: { x: 10, y: 11, roomName: "W0N0" } },
              { id: "drop-b", resourceType: RESOURCE_ENERGY, amount: 180, pos: { x: 20, y: 21, roomName: "W0N0" } }
            ] as Array<Resource<ResourceConstant>>;

            return opts?.filter ? drops.filter(opts.filter) : drops;
          }

          return [];
        }
      }
    } as unknown as StructureSpawn;

    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    testGlobal.Game.rooms.W0N0 = spawn.room;

    const harvesterA = installCreep("harvesterA", "harvester", 0, false, "source-a", 2);
    harvesterA.pos = { x: 10, y: 11, roomName: "W0N0" } as RoomPosition;
    const harvesterB = installCreep("harvesterB", "harvester", 0, false, "source-b", 2);
    harvesterB.pos = { x: 20, y: 21, roomName: "W0N0" } as RoomPosition;
    const courierA = installCreep("courierA", "courier", 50, true);
    courierA.pos = { x: 15, y: 14, roomName: "W0N0" } as RoomPosition;
    installCreep("courierB", "courier", 0, false);
    installCreep("workerA", "worker", 50, true);
    installCreep("workerB", "worker", 50, true);

    Memory.telemetry!.bank = {
      wasLow: true,
      lowTickStartedAt: 5,
      loadedCourierNames: ["courierA"],
      spawnAdjacentLoadedCourierNames: ["courierA"],
      workerWithEnergyNames: ["workerA"],
      sourceBacklog: 380
    };

    observeTelemetryTick(spawn);

    expect(ensureTelemetryState().loop).toMatchObject({
      bankLowObservedTicks: 1,
      spawnWaitingWithLoadedCourierTicks: 1,
      spawnWaitingWithSpawnAdjacentLoadedCourierTicks: 1,
      spawnWaitingWithWorkerEnergyTicks: 1,
      spawnWaitingWithSourceBacklogTicks: 1,
      loadedCourierIdleWhileBankLowTicks: 1,
      extraWorkerGateBlockedTicks: 0,
      extraWorkerGateOpenReasonCounts: {
        source_backlog: 1,
        loaded_courier: 1
      }
    });
  });
});

function installCreep(name: string, role: WorkerRole, energy: number, working: boolean, sourceId?: string, workParts = 1): Creep {
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
    body: role === "courier"
      ? []
      : Array.from({ length: workParts }, () => ({ type: WORK, hits: 100 })),
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
