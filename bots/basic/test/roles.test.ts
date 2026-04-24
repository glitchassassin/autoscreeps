import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBuilder } from "../src/execution/roles/builder";
import { runHarvester } from "../src/execution/roles/harvester";
import { runRecoveryWorker } from "../src/execution/roles/recovery-worker";
import { runRunner } from "../src/execution/roles/runner";
import { runUpgrader } from "../src/execution/roles/upgrader";
import { createEnergyLedgerState } from "../src/state/telemetry";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("role execution", () => {
  beforeEach(() => {
    installScreepsGlobals();

    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory };
    testGlobal.Memory = {
      creeps: {},
      telemetry: {
        creepDeaths: 0,
        energy: createEnergyLedgerState(),
        firstOwnedSpawnTick: null,
        rcl2Tick: null,
        rcl3Tick: null,
        errors: []
      }
    } as unknown as Memory;
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
    const creep = makeCreep({ role: "harvester", activeWorkParts: 2, freeCapacity: 0, harvestResult: OK });

    expect(runHarvester(creep, {
      creepName: "harvester-1",
      role: "harvester",
      sourceId: "source-1"
    })).toEqual({
      sourceId: "source-1",
      harvestedEnergy: 4
    });
    expect(creep.harvest).toHaveBeenCalledWith(source);
    expect(Memory.telemetry?.energy).toMatchObject({
      harvested: 4,
      harvestedBySourceId: {
        "source-1": 4
      },
      dropped: 4
    });
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
    expect(Memory.telemetry?.energy?.transferred).toBe(50);
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
    expect(Memory.telemetry?.energy?.pickedUp).toBe(50);
    expect(Memory.telemetry?.runnerStateTicks?.pickupSucceeded).toBe(1);
  });

  it("runners record failed pathing while moving to pickup", () => {
    const resource = { resourceType: RESOURCE_ENERGY, amount: 50, pos: { x: 10, y: 10, roomName: "W0N0" } } as Resource<ResourceConstant>;
    const creep = makeCreep({
      role: "runner",
      working: false,
      pickupResult: ERR_NOT_IN_RANGE,
      moveToResult: ERR_NO_PATH,
      roomFind: vi.fn((type: FindConstant) => type === FIND_DROPPED_RESOURCES ? [resource] : [])
    });

    runRunner(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(resource, { visualizePathStyle: { stroke: "#ffaa00" } });
    expect(Memory.telemetry?.runnerMovement?.pickup.failedToPath).toBe(1);
    expect(Memory.telemetry?.runnerMovement?.total.failedToPath).toBe(1);
    expect(Memory.telemetry?.runnerMovement?.pickup.stuck).toBe(0);
  });

  it("runners record tired ticks without recording stuck ticks", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    const resource = { resourceType: RESOURCE_ENERGY, amount: 50, pos: { x: 10, y: 10, roomName: "W0N0" } } as Resource<ResourceConstant>;
    const creep = makeCreep({
      role: "runner",
      working: false,
      pickupResult: ERR_NOT_IN_RANGE,
      moveToResult: ERR_TIRED,
      roomFind: vi.fn((type: FindConstant) => type === FIND_DROPPED_RESOURCES ? [resource] : [])
    });

    runRunner(creep);
    testGlobal.Game.time = 2;
    runRunner(creep);

    expect(Memory.telemetry?.runnerMovement?.pickup.tired).toBe(2);
    expect(Memory.telemetry?.runnerMovement?.pickup.stuck).toBe(0);
    expect(creep.memory.lastRunnerMove).toBeUndefined();
  });

  it("runners record stuck ticks after a successful move command that does not move", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    const resource = { resourceType: RESOURCE_ENERGY, amount: 50, pos: { x: 10, y: 10, roomName: "W0N0" } } as Resource<ResourceConstant>;
    const creep = makeCreep({
      role: "runner",
      working: false,
      pickupResult: ERR_NOT_IN_RANGE,
      moveToResult: OK,
      x: 5,
      y: 5,
      roomFind: vi.fn((type: FindConstant) => type === FIND_DROPPED_RESOURCES ? [resource] : [])
    });

    runRunner(creep);
    testGlobal.Game.time = 2;
    runRunner(creep);

    expect(Memory.telemetry?.runnerMovement?.pickup.tired).toBe(0);
    expect(Memory.telemetry?.runnerMovement?.pickup.failedToPath).toBe(0);
    expect(Memory.telemetry?.runnerMovement?.pickup.stuck).toBe(1);
    expect(Memory.telemetry?.runnerMovement?.total.stuck).toBe(1);
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
    expect(Memory.telemetry?.runnerStateTicks?.idleNoDeliveryTarget).toBe(1);
  });

  it("upgraders upgrade the controller once they have energy", () => {
    const controller = { my: true, pos: { x: 15, y: 15, roomName: "W0N0" } } as StructureController;
    const creep = makeCreep({ role: "upgrader", energy: 50, activeWorkParts: 1, controller });

    runUpgrader(creep);

    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
    expect(Memory.telemetry?.energy?.upgraded).toBe(1);
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

  it("builders withdraw from a full spawn while gathering", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    const spawn = makeSpawn({ freeCapacity: 0, storedEnergy: 300 });
    const creep = makeCreep({ role: "builder", working: false, energy: 0 });
    testGlobal.Game.spawns = { Spawn1: spawn } as Game["spawns"];

    runBuilder(creep);

    expect(creep.withdraw).toHaveBeenCalledWith(spawn, RESOURCE_ENERGY);
    expect(Memory.telemetry?.energy?.withdrawn).toBe(50);
  });

  it("builders move to the spawn while waiting for it to fill", () => {
    const testGlobal = globalThis as typeof globalThis & { Game: Game };
    const spawn = makeSpawn({ freeCapacity: 300, storedEnergy: 0 });
    const creep = makeCreep({ role: "builder", working: false, energy: 0 });
    testGlobal.Game.spawns = { Spawn1: spawn } as Game["spawns"];

    runBuilder(creep);

    expect(creep.withdraw).not.toHaveBeenCalled();
    expect(creep.moveTo).toHaveBeenCalledWith(spawn, { visualizePathStyle: { stroke: "#ffaa00" } });
  });

  it("builders build the closest owned construction site while working", () => {
    const site = makeConstructionSite("extension", 20, 20);
    const creep = makeCreep({
      role: "builder",
      working: true,
      energy: 50,
      activeWorkParts: 1,
      roomFind: vi.fn((type: FindConstant) => type === FIND_MY_CONSTRUCTION_SITES ? [site] : [])
    });

    runBuilder(creep);

    expect(creep.build).toHaveBeenCalledWith(site);
    expect(Memory.telemetry?.energy?.built).toBe(5);
  });

  it("builders move toward out-of-range construction sites", () => {
    const site = makeConstructionSite("extension", 20, 20);
    const creep = makeCreep({
      role: "builder",
      working: true,
      energy: 50,
      activeWorkParts: 1,
      buildResult: ERR_NOT_IN_RANGE,
      roomFind: vi.fn((type: FindConstant) => type === FIND_MY_CONSTRUCTION_SITES ? [site] : [])
    });

    runBuilder(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(site, { visualizePathStyle: { stroke: "#ffffff" } });
  });

  it("builders upgrade only when no construction target exists", () => {
    const controller = { my: true, pos: { x: 15, y: 15, roomName: "W0N0" } } as StructureController;
    const creep = makeCreep({ role: "builder", working: true, energy: 50, activeWorkParts: 1, controller });

    runBuilder(creep);

    expect(creep.build).not.toHaveBeenCalled();
    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
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

function makeConstructionSite(structureType: BuildableStructureConstant, x: number, y: number): ConstructionSite {
  return {
    id: `${structureType}-${x}-${y}` as Id<ConstructionSite>,
    structureType,
    progress: 0,
    progressTotal: 3000,
    pos: { x, y, roomName: "W0N0" }
  } as ConstructionSite;
}

function makeCreep(input: {
  role: WorkerRole;
  working?: boolean;
  energy?: number;
  activeWorkParts?: number;
  harvestResult?: ScreepsReturnCode;
  pickupResult?: ScreepsReturnCode;
  transferResult?: ScreepsReturnCode;
  buildResult?: ScreepsReturnCode;
  moveToResult?: ScreepsReturnCode;
  freeCapacity?: number;
  controller?: StructureController;
  roomFind?: (type: FindConstant) => unknown[];
  findClosestByPath?: (targets: object[] | number) => unknown;
  x?: number;
  y?: number;
  roomName?: string;
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
      x: input.x ?? 5,
      y: input.y ?? 5,
      roomName: input.roomName ?? "W0N0",
      findClosestByPath: vi.fn((targets: object[] | number) => input.findClosestByPath?.(targets) ?? (Array.isArray(targets) ? targets[0] ?? null : null))
    } as unknown as RoomPosition,
    store: {
      [RESOURCE_ENERGY]: input.energy ?? 0,
      getFreeCapacity: vi.fn(() => input.freeCapacity ?? Math.max(0, 50 - (input.energy ?? 0)))
    },
    harvest: vi.fn(() => input.harvestResult ?? OK),
    transfer: vi.fn(() => input.transferResult ?? OK),
    pickup: vi.fn(() => input.pickupResult ?? OK),
    withdraw: vi.fn(() => OK),
    build: vi.fn(() => input.buildResult ?? OK),
    upgradeController: vi.fn(() => OK),
    moveTo: vi.fn(() => input.moveToResult ?? OK),
    getActiveBodyparts: vi.fn((part: BodyPartConstant) => part === WORK ? input.activeWorkParts ?? 0 : 0)
  } as unknown as Creep;
}
