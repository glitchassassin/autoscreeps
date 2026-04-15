import { beforeEach, describe, expect, it, vi } from "vitest";
import { runHarvester } from "../src/execution/roles/harvester";
import { runRecoveryWorker } from "../src/execution/roles/recovery-worker";
import { runRunner } from "../src/execution/roles/runner";
import { runUpgrader } from "../src/execution/roles/upgrader";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("role execution", () => {
  beforeEach(() => {
    installScreepsGlobals();

    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    testGlobal.Game = {
      creeps: {},
      spawns: {},
      rooms: {},
      getObjectById: vi.fn(() => null),
      time: 1
    } as unknown as Game;
  });

  it("harvesters follow their planned source assignment and report harvested energy", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    const source = { id: "source-1", energy: 8, pos: { x: 10, y: 10, roomName: "W0N0" } } as Source;
    testGlobal.Game.getObjectById = vi.fn(() => source) as typeof Game.getObjectById;
    const creep = makeCreep({ role: "harvester", activeWorkParts: 2, harvestResult: OK });

    expect(runHarvester(creep, {
      creepName: "harvester-1",
      role: "harvester",
      sourceId: "source-1"
    })).toEqual({
      sourceId: "source-1",
      harvestedEnergy: 4
    });
    expect(creep.harvest).toHaveBeenCalledWith(source);
  });

  it("recovery workers harvest and feed the spawn directly", () => {
    const spawn = makeSpawn({ freeCapacity: 300 });
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    testGlobal.Game.spawns = { Spawn1: spawn } as Game["spawns"];
    const source = { id: "source-1", pos: { x: 10, y: 10, roomName: "W0N0" } } as Source;
    const creep = makeCreep({
      role: "recovery-worker",
      working: true,
      energy: 50,
      findClosestByPath: vi.fn((targets: object[] | number) => Array.isArray(targets) ? targets[0] ?? null : source)
    });

    runRecoveryWorker(creep);

    expect(creep.transfer).toHaveBeenCalledWith(spawn, RESOURCE_ENERGY);
  });

  it("runners collect dropped energy while gathering", () => {
    const resource = { resourceType: RESOURCE_ENERGY, amount: 50, pos: { x: 10, y: 10, roomName: "W0N0" } } as Resource<ResourceConstant>;
    const creep = makeCreep({
      role: "runner",
      working: false,
      roomFind: vi.fn((type: FindConstant) => type === FIND_DROPPED_RESOURCES ? [resource] : [])
    });

    runRunner(creep);

    expect(creep.pickup).toHaveBeenCalledWith(resource);
  });

  it("runners do not deliver directly to upgraders when the spawn is full", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    const spawn = makeSpawn({ freeCapacity: 0, storedEnergy: 300 });
    const upgrader = makeCreep({ role: "upgrader", energy: 0 });
    const creep = makeCreep({ role: "runner", working: true, energy: 50 });
    testGlobal.Game.spawns = { Spawn1: spawn } as Game["spawns"];
    testGlobal.Game.creeps = {
      runner1: creep,
      upgrader1: upgrader
    } as Game["creeps"];

    runRunner(creep);

    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("upgraders upgrade the controller once they have energy", () => {
    const controller = { my: true, pos: { x: 15, y: 15, roomName: "W0N0" } } as StructureController;
    const creep = makeCreep({ role: "upgrader", energy: 50, controller });

    runUpgrader(creep);

    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
  });

  it("upgraders only withdraw from a full spawn", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    const spawn = makeSpawn({ freeCapacity: 50, storedEnergy: 250 });
    const resource = { resourceType: RESOURCE_ENERGY, amount: 50, pos: { x: 10, y: 10, roomName: "W0N0" } } as Resource<ResourceConstant>;
    const creep = makeCreep({
      role: "upgrader",
      energy: 0,
      roomFind: vi.fn((type: FindConstant) => type === FIND_DROPPED_RESOURCES ? [resource] : [])
    });
    testGlobal.Game.spawns = { Spawn1: spawn } as Game["spawns"];

    runUpgrader(creep);

    expect(creep.withdraw).not.toHaveBeenCalled();
    expect(creep.pickup).not.toHaveBeenCalled();
  });
});

function makeSpawn(input: { freeCapacity: number; storedEnergy?: number }): StructureSpawn {
  return {
    name: "Spawn1",
    room: {
      name: "W0N0"
    } as Room,
    store: {
      [RESOURCE_ENERGY]: input.storedEnergy ?? 0,
      getFreeCapacity: vi.fn(() => input.freeCapacity)
    },
    spawnCreep: vi.fn()
  } as unknown as StructureSpawn;
}

function makeCreep(input: {
  role: WorkerRole;
  working?: boolean;
  energy?: number;
  activeWorkParts?: number;
  harvestResult?: ScreepsReturnCode;
  controller?: StructureController;
  roomFind?: (type: FindConstant) => unknown[];
  findClosestByPath?: (targets: object[] | number) => unknown;
}): Creep {
  return {
    name: `${input.role}-1`,
    body: Array.from({ length: input.activeWorkParts ?? 0 }, () => ({ type: WORK, hits: 100 } as BodyPartDefinition)),
    memory: {
      role: input.role,
      ...(input.working !== undefined ? { working: input.working } : {}),
      homeRoom: "W0N0"
    },
    room: {
      name: "W0N0",
      controller: input.controller ?? null,
      find: vi.fn((type: FindConstant) => input.roomFind?.(type) ?? [])
    } as unknown as Room,
    pos: {
      findClosestByPath: vi.fn((targets: object[] | number) => input.findClosestByPath?.(targets) ?? (Array.isArray(targets) ? targets[0] ?? null : null))
    } as unknown as RoomPosition,
    store: {
      [RESOURCE_ENERGY]: input.energy ?? 0,
      getFreeCapacity: vi.fn(() => Math.max(0, 50 - (input.energy ?? 0)))
    },
    harvest: vi.fn(() => input.harvestResult ?? OK),
    transfer: vi.fn(() => OK),
    pickup: vi.fn(() => OK),
    withdraw: vi.fn(() => OK),
    upgradeController: vi.fn(() => OK),
    moveTo: vi.fn(),
    getActiveBodyparts: vi.fn((part: BodyPartConstant) => part === WORK ? input.activeWorkParts ?? 0 : 0)
  } as unknown as Creep;
}
