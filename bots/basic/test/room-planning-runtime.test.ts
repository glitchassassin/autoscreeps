import { beforeEach, describe, expect, it, vi } from "vitest";
import { runTick } from "../src/core/run-tick";
import {
  advanceRoomPlanning,
  getRoomPlanningTelemetry,
  resetRoomPlanningHeap,
  roomPlannerVersion
} from "../src/planning/room-planning-runtime";
import { planCompleteRoom } from "../src/planning/room-plan";
import { createRoomStampPlanningJob, planRoomStamps, type PlanningBudget } from "../src/planning/stamp-placement";
import { installScreepsGlobals } from "./helpers/install-globals";
import { loadBotarena212RoomPlanningFixture } from "./helpers/room-planning-fixture";
import { installTestPathFinder } from "./helpers/test-pathfinder";

const fixture = loadBotarena212RoomPlanningFixture();
const roomName = "E11N1";
const fixtureRoom = fixture.map.getRoom(roomName)!;

describe("multi-tick room planning", () => {
  beforeEach(() => {
    installScreepsGlobals();
    installTestPathFinder(new Map([[roomName, fixtureRoom.terrain]]));
    resetRoomPlanningHeap();

    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory; Room: typeof Room };
    testGlobal.Memory = {
      creeps: {},
      rooms: {}
    } as unknown as Memory;
    testGlobal.Room = {
      Terrain: class {
        get(x: number, y: number): number {
          return Number(fixtureRoom.terrain[y * 50 + x]);
        }
      }
    } as unknown as typeof Room;
    testGlobal.Game = {
      creeps: {},
      constructionSites: {},
      getObjectById: vi.fn(() => null),
      spawns: {},
      rooms: {
        [roomName]: createFixtureGameRoom(fixtureRoom)
      },
      cpu: createCpu(10000, () => 0),
      time: 100
    } as unknown as Game;
  });

  it("keeps synchronous complete planning output unchanged", () => {
    const plan = planCompleteRoom({
      roomName,
      policy: "normal",
      map: fixture.map
    });

    expect(plan.structurePlan.structures.length).toBeGreaterThan(0);
    expect(plan.structurePlan.structures.filter((structure) => structure.type === "extension")).toHaveLength(60);
    expect(plan.structurePlan.structures.filter((structure) => structure.type === "spawn")).toHaveLength(3);
  }, 20_000);

  it("advances stamp search across multiple budgeted calls", () => {
    const expected = planRoomStamps(fixtureRoom, "normal");
    const job = createRoomStampPlanningJob(fixtureRoom, "normal");
    let result = job.advance(createCallBudget(1));

    expect(result).toBeNull();
    for (let tick = 0; tick < 200 && result === null; tick += 1) {
      result = job.advance(createCallBudget(50));
    }

    expect(result).toEqual(expected);
  }, 20_000);

  it("skips automatic planning when the CPU bucket is below the threshold", () => {
    setCpu(createCpu(4999, () => 0));

    advanceRoomPlanning(createWorld());

    expect(Memory.rooms?.[roomName]?.planning).toBeUndefined();
    expect(getRoomPlanningTelemetry().activeRoomName).toBeNull();
  });

  it("keeps in-progress scheduler state in heap and restarts after heap reset", () => {
    let used = 0;
    setCpu(createCpu(10000, () => {
      used += 0.25;
      return used;
    }));

    advanceRoomPlanning(createWorld());
    const activeBeforeReset = getRoomPlanningTelemetry();

    expect(activeBeforeReset.activeRoomName).toBe(roomName);
    expect(activeBeforeReset.activeTicksSpent).toBe(1);
    expect(Memory.rooms?.[roomName]?.planning).toBeUndefined();

    resetRoomPlanningHeap();
    expect(getRoomPlanningTelemetry().activeRoomName).toBeNull();

    advanceRoomPlanning(createWorld({ gameTime: 101 }));
    const activeAfterReset = getRoomPlanningTelemetry();

    expect(activeAfterReset.activeRoomName).toBe(roomName);
    expect(activeAfterReset.activeTicksSpent).toBe(1);
  }, 20_000);

  it("persists completed structure plans to room memory", () => {
    advanceRoomPlanning(createWorld());

    const planning = Memory.rooms?.[roomName]?.planning;
    expect(planning).toMatchObject({
      version: roomPlannerVersion,
      policy: "normal",
      status: "complete",
      requestedAt: 100,
      completedAt: 100
    });
    expect(planning?.structures?.length).toBeGreaterThan(0);
    expect(planning?.structures?.filter((structure) => structure.type === "extension")).toHaveLength(60);
    expect(getRoomPlanningTelemetry().completedCount).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it("runs room planning after spawn and creep execution in the tick loop", () => {
    const events: string[] = [];
    const room = createFixtureGameRoom(fixtureRoom);
    const source = room.find(FIND_SOURCES)[0] as Source;
    const spawn = {
      name: "Spawn1",
      spawning: null,
      room,
      pos: { x: 25, y: 25, roomName } as RoomPosition,
      spawnCreep: vi.fn(() => {
        events.push("spawn");
        return OK;
      })
    } as unknown as StructureSpawn;
    const creep = createIdleCreep(roomName, events);

    (Game as unknown as {
      spawns: Record<string, StructureSpawn>;
      creeps: Record<string, Creep>;
      rooms: Record<string, Room>;
      getObjectById: (id: string) => Source | null;
    }).spawns = { Spawn1: spawn };
    (Game as unknown as { creeps: Record<string, Creep> }).creeps = { harvesterA: creep };
    (Game as unknown as { rooms: Record<string, Room> }).rooms = { [roomName]: room };
    (Game as unknown as { getObjectById: (id: string) => Source | null }).getObjectById = vi.fn((id: string) => id === source.id ? source : null);
    let recordedPlanning = false;
    setCpu(createCpu(10000, () => {
      if (!recordedPlanning) {
        events.push("planning");
        recordedPlanning = true;
      }
      return 0;
    }));

    runTick();

    expect(events).toEqual(["spawn", "planning"]);
    expect(Memory.rooms?.[roomName]?.planning?.status).toBe("complete");
  }, 20_000);
});

function createCallBudget(maxCalls: number): PlanningBudget {
  let calls = 0;
  return {
    shouldYield(): boolean {
      calls += 1;
      return calls > maxCalls;
    }
  };
}

function createWorld(options: { gameTime?: number } = {}) {
  return {
    gameTime: options.gameTime ?? 100,
    primarySpawnName: null,
    primarySpawnConstructionSiteCount: 0,
    primarySpawnSpawning: null,
    primaryRoomName: roomName,
    primaryRoomEnergyAvailable: 0,
    primaryRoomEnergyCapacityAvailable: 0,
    primarySpawnToControllerPathLength: null,
    primaryController: { level: 1, progress: 0, progressTotal: 200 },
    maxOwnedControllerLevel: 1,
    totalCreeps: 0,
    creepsByRole: {
      "recovery-worker": 0,
      harvester: 0,
      runner: 0,
      upgrader: 0
    },
    creeps: [],
    sources: []
  };
}

function createFixtureGameRoom(room: NonNullable<ReturnType<typeof fixture.map.getRoom>>): Room {
  const controller = room.objects.find((object) => object.type === "controller")!;
  const sources = room.objects.filter((object) => object.type === "source");
  const minerals = room.objects.filter((object) => object.type === "mineral");

  return {
    name: room.roomName,
    energyAvailable: 300,
    energyCapacityAvailable: 300,
    controller: {
      id: controller.id,
      my: true,
      level: 1,
      progress: 0,
      progressTotal: 200,
      pos: createPosition(controller.x, controller.y, room.roomName)
    },
    find: vi.fn((type: FindConstant) => {
      if (type === FIND_SOURCES) {
        return sources.map((source) => ({
          id: source.id,
          energy: 3000,
          energyCapacity: 3000,
          ticksToRegeneration: 300,
          pos: createPosition(source.x, source.y, room.roomName),
          room: { name: room.roomName }
        }));
      }
      if (type === FIND_MINERALS) {
        return minerals.map((mineral) => ({
          id: mineral.id,
          mineralType: mineral.mineralType ?? "H",
          pos: createPosition(mineral.x, mineral.y, room.roomName)
        }));
      }
      if (type === FIND_DEPOSITS) {
        return [];
      }
      return [];
    })
  } as unknown as Room;
}

function createPosition(x: number, y: number, roomName: string): RoomPosition {
  return {
    x,
    y,
    roomName,
    findPathTo: vi.fn(() => [])
  } as unknown as RoomPosition;
}

function createCpu(bucket: number, getUsed: () => number): CPU {
  return {
    bucket,
    limit: 20,
    tickLimit: 500,
    getUsed: vi.fn(getUsed)
  } as unknown as CPU;
}

function setCpu(cpu: CPU): void {
  (Game as unknown as { cpu: CPU }).cpu = cpu;
}

function createIdleCreep(roomName: string, events: string[]): Creep {
  return {
    name: "harvesterA",
    memory: { role: "harvester", homeRoom: roomName },
    body: [{ type: WORK, hits: 100 }, { type: MOVE, hits: 100 }],
    room: { name: roomName },
    store: { [RESOURCE_ENERGY]: 0, getFreeCapacity: vi.fn(() => 50) },
    getActiveBodyparts: vi.fn((part: BodyPartConstant) => part === WORK ? 1 : 0),
    harvest: vi.fn(() => {
      events.push("creep");
      return OK;
    }),
    moveTo: vi.fn(() => OK),
    pos: {
      x: 10,
      y: 10,
      roomName,
      isNearTo: vi.fn(() => true)
    }
  } as unknown as Creep;
}
