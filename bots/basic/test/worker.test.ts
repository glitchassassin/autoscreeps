import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWorker } from "../src/execution/roles/worker";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("runWorker", () => {
  beforeEach(() => {
    installScreepsGlobals();
  });

  it("harvests from the nearest active source while gathering", () => {
    const source = { id: "source-1", pos: { x: 10, y: 10, roomName: "W0N0" } } as Source;
    const creep = makeWorker({
      working: false,
      energy: 0,
      freeCapacity: 50,
      nearestSource: source,
      harvestResult: OK
    });

    runWorker(creep);

    expect(creep.harvest).toHaveBeenCalledWith(source);
    expect(creep.upgradeController).not.toHaveBeenCalled();
  });

  it("moves to the source when harvest is out of range", () => {
    const source = { id: "source-1", pos: { x: 10, y: 10, roomName: "W0N0" } } as Source;
    const creep = makeWorker({
      working: false,
      energy: 0,
      freeCapacity: 50,
      nearestSource: source,
      harvestResult: ERR_NOT_IN_RANGE
    });

    runWorker(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(source, { visualizePathStyle: { stroke: "#ffaa00" } });
  });

  it("upgrades the controller once the worker is full", () => {
    const controller = { my: true, pos: { x: 15, y: 15, roomName: "W0N0" } } as StructureController;
    const creep = makeWorker({
      working: false,
      energy: 50,
      freeCapacity: 0,
      nearestSource: null,
      controller,
      upgradeResult: OK
    });

    runWorker(creep);

    expect(creep.memory.working).toBe(true);
    expect(creep.upgradeController).toHaveBeenCalledWith(controller);
    expect(creep.harvest).not.toHaveBeenCalled();
  });

  it("moves to the controller when upgrade is out of range", () => {
    const controller = { my: true, pos: { x: 15, y: 15, roomName: "W0N0" } } as StructureController;
    const creep = makeWorker({
      working: true,
      energy: 50,
      freeCapacity: 0,
      nearestSource: null,
      controller,
      upgradeResult: ERR_NOT_IN_RANGE
    });

    runWorker(creep);

    expect(creep.moveTo).toHaveBeenCalledWith(controller, { visualizePathStyle: { stroke: "#ffffff" } });
  });
});

function makeWorker(input: {
  working: boolean;
  energy: number;
  freeCapacity: number;
  nearestSource: Source | null;
  controller?: StructureController;
  harvestResult?: ScreepsReturnCode;
  upgradeResult?: ScreepsReturnCode;
}): Creep {
  return {
    memory: {
      role: "worker",
      working: input.working,
      homeRoom: "W0N0"
    },
    room: {
      name: "W0N0",
      controller: input.controller ?? null
    } as Room,
    pos: {
      findClosestByPath: vi.fn((target: Source[] | number) => {
        if (Array.isArray(target)) {
          return target[0] ?? null;
        }

        return input.nearestSource;
      })
    } as unknown as RoomPosition,
    store: {
      [RESOURCE_ENERGY]: input.energy,
      getFreeCapacity: vi.fn(() => input.freeCapacity)
    },
    harvest: vi.fn(() => input.harvestResult ?? OK),
    upgradeController: vi.fn(() => input.upgradeResult ?? OK),
    moveTo: vi.fn()
  } as unknown as Creep;
}
