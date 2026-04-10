import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  moveToTarget: vi.fn(),
  pickupEnergyDrop: vi.fn(),
  recordTelemetryAction: vi.fn(),
  recordTelemetryTargetFailure: vi.fn(),
  inspectSpawnBankPressure: vi.fn()
}));

vi.mock("../src/creep-utils", () => ({
  findClosestConstructionSite: vi.fn(() => null),
  findClosestEnergyDrop: vi.fn(() => null),
  isSourceAdjacentPosition: vi.fn(() => false),
  moveToTarget: mocks.moveToTarget,
  pickupEnergyDrop: mocks.pickupEnergyDrop,
  positionsAreNear: vi.fn((left: RoomPosition | undefined, right: RoomPosition | undefined) => Boolean(
    left
    && right
    && left.roomName === right.roomName
    && Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y)) <= 1
  )),
  updateWorkingState: vi.fn()
}));

vi.mock("../src/telemetry-state", () => ({
  recordTelemetryAction: mocks.recordTelemetryAction,
  recordTelemetryTargetFailure: mocks.recordTelemetryTargetFailure
}));

vi.mock("../src/spawn", () => ({
  inspectSpawnBankPressure: mocks.inspectSpawnBankPressure
}));

import { runCourier } from "../src/roles/courier";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("courier spawn-feed floor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installScreepsGlobals();

    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory };
    testGlobal.Memory = {
      creeps: {},
      telemetry: {
        creepDeaths: 0,
        firstOwnedSpawnTick: null,
        rcl2Tick: 700,
        rcl3Tick: null,
        spawnAdmissions: {
          firstCourier3: {
            gameTime: 780,
            sourceBacklog: 900,
            loadedCouriers: 1,
            roleCounts: {
              harvester: 2,
              courier: 2,
              worker: 3
            },
            openReasons: ["source_backlog", "loaded_courier"],
            spawnWaitingWithSourceBacklogTicks: 120,
            sourceDropToBankLatencyAvg: 300,
            withinCourier3Window: true,
            courier3PriorityActive: true
          },
          firstWorker4: null
        }
      }
    } as unknown as Memory;
    testGlobal.Game = {
      creeps: {},
      rooms: {},
      spawns: {},
      time: 900
    } as unknown as Game;

    mocks.inspectSpawnBankPressure.mockReturnValue({
      nextRole: "worker",
      totalUnmetDemand: 1,
      queueHeadCost: 300,
      waitingForEnergy: false
    });
  });

  it("stages one loaded courier at the spawn instead of handing off when the hard feed floor is active", () => {
    const spawn = makeSpawn();
    const creep = makeCourier("courierA", spawn.room, makePosition(10, 10));
    const worker = makeWorker("workerA", spawn.room, makePosition(20, 20));
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      courierA: creep,
      workerA: worker
    };

    runCourier(creep);

    expect(mocks.moveToTarget).toHaveBeenCalledWith(creep, spawn);
    expect(creep.drop).not.toHaveBeenCalled();
    expect(creep.transfer).not.toHaveBeenCalled();
  });

  it("does not reserve every loaded courier once one courier is already staged at the spawn", () => {
    const spawn = makeSpawn();
    const stagedCourier = makeCourier("courierA", spawn.room, makePosition(15, 14));
    const activeCourier = makeCourier("courierB", spawn.room, makePosition(10, 10));
    const worker = makeWorker("workerA", spawn.room, makePosition(11, 10));
    const testGlobal = globalThis as typeof globalThis & { Game: Game };

    testGlobal.Game.creeps = {
      courierA: stagedCourier,
      courierB: activeCourier,
      workerA: worker
    };

    runCourier(activeCourier);

    expect(mocks.moveToTarget).not.toHaveBeenCalledWith(activeCourier, spawn);
    expect(activeCourier.drop).toHaveBeenCalledWith(RESOURCE_ENERGY);
  });
});

function makeSpawn(): StructureSpawn {
  const spawn = {
    id: "spawn-1",
    name: "Spawn1",
    pos: makePosition(15, 15),
    structureType: STRUCTURE_SPAWN,
    store: {
      getFreeCapacity: vi.fn(() => 0)
    }
  } as unknown as StructureSpawn;

  const room = {
    name: "W0N0",
    energyAvailable: 300,
    energyCapacityAvailable: 300,
    controller: {
      my: true,
      level: 2
    },
    find: vi.fn((type: number, opts?: { filter?: (value: any) => boolean }) => {
      if (type === FIND_MY_SPAWNS) {
        return [spawn];
      }
      if (type === FIND_MY_STRUCTURES) {
        const structures = [spawn] as unknown as Structure[];
        return opts?.filter ? structures.filter(opts.filter) : structures;
      }
      return [];
    })
  } as unknown as Room;

  spawn.room = room;
  return spawn;
}

function makeCourier(name: string, room: Room, pos: RoomPosition): Creep {
  return {
    name,
    memory: {
      role: "courier",
      working: true,
      homeRoom: room.name
    },
    pos,
    room,
    store: {
      [RESOURCE_ENERGY]: 50,
      getFreeCapacity: vi.fn(() => 0)
    },
    transfer: vi.fn(() => OK),
    drop: vi.fn(() => OK),
    pickup: vi.fn(() => OK),
    moveTo: vi.fn(() => OK)
  } as unknown as Creep;
}

function makeWorker(name: string, room: Room, pos: RoomPosition): Creep {
  return {
    name,
    memory: {
      role: "worker",
      working: true,
      homeRoom: room.name
    },
    pos,
    room,
    store: {
      [RESOURCE_ENERGY]: 0,
      getFreeCapacity: vi.fn(() => 50)
    }
  } as unknown as Creep;
}

function makePosition(x: number, y: number): RoomPosition {
  return {
    x,
    y,
    roomName: "W0N0",
    findClosestByPath: vi.fn((targets: Array<{ pos?: RoomPosition; x?: number; y?: number; roomName?: string }>) => {
      if (targets.length === 0) {
        return null;
      }

      return targets.reduce((best, candidate) => {
        const bestPos = (("pos" in best ? best.pos : best) ?? best) as { x: number; y: number };
        const candidatePos = (("pos" in candidate ? candidate.pos : candidate) ?? candidate) as { x: number; y: number };
        const bestRange = Math.max(Math.abs(bestPos.x - x), Math.abs(bestPos.y - y));
        const candidateRange = Math.max(Math.abs(candidatePos.x - x), Math.abs(candidatePos.y - y));
        return candidateRange < bestRange ? candidate : best;
      });
    })
  } as unknown as RoomPosition;
}
