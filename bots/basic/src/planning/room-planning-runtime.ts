import type { WorldSnapshot } from "../core/types";
import type { CpuProfiler } from "../telemetry/cpu-profiler";
import { measureCpu } from "../telemetry/cpu-profiler";
import { planRamparts, type RampartPlan } from "./rampart-plan";
import { planRoads, type RoadPlan } from "./road-plan";
import type { RoomPlanningObject, RoomPlanningPolicy, RoomPlanningRoomData } from "./room-plan";
import { createRoomStampPlanningJob, type PlanningBudget, type RoomStampPlanningJob, type RoomStampPlan } from "./stamp-placement";
import { planRoomStructures, type RoomStructurePlan } from "./structure-plan";
import { planSourceSinkStructures, type SourceSinkStructurePlan } from "./source-sink-structure-plan";

export const roomPlannerVersion = 1;

const defaultPolicy: RoomPlanningPolicy = "normal";
const minimumCpuBucket = 5000;
const cpuBudgetPerTick = 3;
const tickLimitReserve = 2;

export type RoomPlanningStage =
  | "stamp"
  | "roads"
  | "sourceSink"
  | "ramparts"
  | "structures"
  | "persist"
  | "complete"
  | "failed";

export type RoomPlanningTelemetry = {
  activeRoomName: string | null;
  activePolicy: RoomPlanningPolicy | null;
  activeStage: string | null;
  activeTicksSpent: number;
  completedCount: number;
  failedCount: number;
  lastFailure: {
    roomName: string;
    message: string;
    failedAt: number;
  } | null;
};

type RoomPlanningHeap = {
  jobs: Map<string, RoomPlanningJob>;
  completedCount: number;
  failedCount: number;
  lastFailure: RoomPlanningTelemetry["lastFailure"];
};

type RoomPlanningJob = {
  key: string;
  roomName: string;
  policy: RoomPlanningPolicy;
  requestedAt: number;
  updatedAt: number;
  ticksSpent: number;
  stage: RoomPlanningStage;
  room: RoomPlanningRoomData;
  stampJob: RoomStampPlanningJob;
  stampPlan: RoomStampPlan | null;
  roadPlan: RoadPlan | null;
  sourceSinkPlan: SourceSinkStructurePlan | null;
  rampartPlan: RampartPlan | null;
  structurePlan: RoomStructurePlan | null;
};

type AutoscreepsGlobal = typeof globalThis & {
  __autoscreepsRoomPlanningHeap?: RoomPlanningHeap;
};

export function advanceRoomPlanning(world: WorldSnapshot, profiler?: CpuProfiler): void {
  measureCpu(profiler, "roomPlanning", () => advanceRoomPlanningUnprofiled(world));
}

export function getRoomPlanningTelemetry(): RoomPlanningTelemetry {
  const heap = getHeap();
  const active = [...heap.jobs.values()][0] ?? null;

  return {
    activeRoomName: active?.roomName ?? null,
    activePolicy: active?.policy ?? null,
    activeStage: active ? describeStage(active) : null,
    activeTicksSpent: active?.ticksSpent ?? 0,
    completedCount: heap.completedCount + countMemoryPlanningStatus("complete"),
    failedCount: heap.failedCount + countMemoryPlanningStatus("failed"),
    lastFailure: heap.lastFailure ?? findLastMemoryFailure()
  };
}

export function resetRoomPlanningHeap(): void {
  delete (globalThis as AutoscreepsGlobal).__autoscreepsRoomPlanningHeap;
}

export function createRoomPlanningRoomData(room: Room): RoomPlanningRoomData {
  if (!room.controller?.my) {
    throw new Error(`Room '${room.name}' is not owned.`);
  }

  const sources = room.find(FIND_SOURCES);
  if (sources.length !== 2) {
    throw new Error(`Room '${room.name}' must have exactly two sources for room planning.`);
  }

  const objects: RoomPlanningObject[] = [
    createObject(room.controller, "controller"),
    ...sources.map((source) => createObject(source, "source")),
    ...findMinerals(room).map((mineral) => ({
      ...createObject(mineral, "mineral"),
      mineralType: mineral.mineralType
    })),
    ...findDeposits(room).map((deposit) => ({
      ...createObject(deposit, "deposit"),
      depositType: deposit.depositType
    }))
  ];

  return {
    roomName: room.name,
    terrain: readTerrain(room.name),
    objects: objects.sort(compareObjects)
  };
}

function advanceRoomPlanningUnprofiled(world: WorldSnapshot): void {
  if (!canSpendCpu()) {
    return;
  }

  const roomName = world.primaryRoomName;
  if (roomName === null) {
    return;
  }

  const room = Game.rooms[roomName];
  if (!room?.controller?.my) {
    return;
  }

  const heap = getHeap();
  const key = createJobKey(roomName, defaultPolicy);
  const memory = getRoomPlanningMemory(roomName);
  if (memory?.version === roomPlannerVersion && memory.policy === defaultPolicy && (memory.status === "complete" || memory.status === "failed")) {
    return;
  }

  let job = heap.jobs.get(key);
  if (!job) {
    try {
      const planningRoom = createRoomPlanningRoomData(room);
      job = createJob(key, planningRoom, defaultPolicy, world.gameTime);
      heap.jobs.set(key, job);
    } catch (error) {
      persistFailure(heap, roomName, defaultPolicy, world.gameTime, 0, error);
      return;
    }
  }

  const budget = createCpuBudget();
  job.ticksSpent += 1;
  job.updatedAt = world.gameTime;

  try {
    advanceJob(job, budget);
    if (job.stage === "persist" && job.structurePlan) {
      persistComplete(job, world.gameTime);
      heap.jobs.delete(key);
      heap.completedCount += 1;
    }
  } catch (error) {
    heap.jobs.delete(key);
    persistFailure(heap, job.roomName, job.policy, world.gameTime, job.ticksSpent, error);
  }
}

function advanceJob(job: RoomPlanningJob, budget: PlanningBudget): void {
  if (job.stage === "stamp") {
    const stampPlan = job.stampJob.advance(budget);
    if (stampPlan === null) {
      return;
    }
    job.stampPlan = stampPlan;
    job.stage = "roads";
  }

  if (job.stage === "roads") {
    if (budget.shouldYield()) return;
    job.roadPlan = planRoads(job.room, requireValue(job.stampPlan, "stamp plan"));
    job.stage = "sourceSink";
  }

  if (job.stage === "sourceSink") {
    if (budget.shouldYield()) return;
    job.sourceSinkPlan = planSourceSinkStructures(job.room, requireValue(job.stampPlan, "stamp plan"), requireValue(job.roadPlan, "road plan"));
    job.stage = "ramparts";
  }

  if (job.stage === "ramparts") {
    if (budget.shouldYield()) return;
    job.rampartPlan = planRamparts(
      job.room,
      requireValue(job.stampPlan, "stamp plan"),
      requireValue(job.roadPlan, "road plan"),
      requireValue(job.sourceSinkPlan, "source/sink plan")
    );
    job.stage = "structures";
  }

  if (job.stage === "structures") {
    if (budget.shouldYield()) return;
    job.structurePlan = planRoomStructures(
      job.room,
      requireValue(job.stampPlan, "stamp plan"),
      requireValue(job.roadPlan, "road plan"),
      requireValue(job.sourceSinkPlan, "source/sink plan"),
      requireValue(job.rampartPlan, "rampart plan")
    );
    job.stage = "persist";
  }
}

function createJob(key: string, room: RoomPlanningRoomData, policy: RoomPlanningPolicy, gameTime: number): RoomPlanningJob {
  return {
    key,
    roomName: room.roomName,
    policy,
    requestedAt: gameTime,
    updatedAt: gameTime,
    ticksSpent: 0,
    stage: "stamp",
    room,
    stampJob: createRoomStampPlanningJob(room, policy, {
      validateCompleteLayout: (stampPlan) => canCreateCompleteRoomPlan(room, stampPlan)
    }),
    stampPlan: null,
    roadPlan: null,
    sourceSinkPlan: null,
    rampartPlan: null,
    structurePlan: null
  };
}

function canCreateCompleteRoomPlan(room: RoomPlanningRoomData, stampPlan: RoomStampPlan): boolean {
  try {
    const roadPlan = planRoads(room, stampPlan);
    const sourceSinkPlan = planSourceSinkStructures(room, stampPlan, roadPlan);
    const rampartPlan = planRamparts(room, stampPlan, roadPlan, sourceSinkPlan);
    planRoomStructures(room, stampPlan, roadPlan, sourceSinkPlan, rampartPlan);
    return true;
  } catch {
    return false;
  }
}

function persistComplete(job: RoomPlanningJob, gameTime: number): void {
  const memory = ensureRoomPlanningMemory(job.roomName);
  memory.version = roomPlannerVersion;
  memory.policy = job.policy;
  memory.status = "complete";
  memory.requestedAt = job.requestedAt;
  memory.updatedAt = gameTime;
  memory.completedAt = gameTime;
  delete memory.failedAt;
  memory.ticksSpent = job.ticksSpent;
  delete memory.failure;
  memory.structures = requireValue(job.structurePlan, "structure plan").structures.map((structure) => ({
    type: structure.type,
    x: structure.x,
    y: structure.y,
    rcl: structure.rcl,
    label: structure.label,
    ...(structure.removeAtRcl === undefined ? {} : { removeAtRcl: structure.removeAtRcl })
  }));
}

function persistFailure(
  heap: RoomPlanningHeap,
  roomName: string,
  policy: RoomPlanningPolicy,
  gameTime: number,
  ticksSpent: number,
  error: unknown
): void {
  const message = error instanceof Error ? error.message : String(error);
  const memory = ensureRoomPlanningMemory(roomName);
  memory.version = roomPlannerVersion;
  memory.policy = policy;
  memory.status = "failed";
  memory.requestedAt = memory.requestedAt ?? gameTime;
  memory.updatedAt = gameTime;
  memory.failedAt = gameTime;
  delete memory.completedAt;
  memory.ticksSpent = ticksSpent;
  memory.failure = message;
  delete memory.structures;
  heap.failedCount += 1;
  heap.lastFailure = {
    roomName,
    message,
    failedAt: gameTime
  };
}

function createCpuBudget(): PlanningBudget {
  const cpu = readCpu();
  const start = readCpuUsed(cpu) ?? 0;

  return {
    shouldYield(): boolean {
      const used = readCpuUsed(cpu);
      if (used === null) {
        return false;
      }
      if (used - start >= cpuBudgetPerTick) {
        return true;
      }
      return typeof cpu?.tickLimit === "number" && cpu.tickLimit - used <= tickLimitReserve;
    }
  };
}

function canSpendCpu(): boolean {
  const cpu = readCpu();
  if (!cpu || typeof cpu.bucket !== "number") {
    return false;
  }
  if (cpu.bucket < minimumCpuBucket) {
    return false;
  }
  const used = readCpuUsed(cpu);
  return used === null || typeof cpu.tickLimit !== "number" || cpu.tickLimit - used > tickLimitReserve;
}

function readCpu(): CPU | null {
  return typeof Game === "undefined" || typeof Game.cpu !== "object" || Game.cpu === null ? null : Game.cpu;
}

function readCpuUsed(cpu: CPU | null): number | null {
  if (!cpu || typeof cpu.getUsed !== "function") {
    return null;
  }
  try {
    const used = cpu.getUsed();
    return Number.isFinite(used) ? used : null;
  } catch {
    return null;
  }
}

function getHeap(): RoomPlanningHeap {
  const autoscreepsGlobal = globalThis as AutoscreepsGlobal;
  autoscreepsGlobal.__autoscreepsRoomPlanningHeap ??= {
    jobs: new Map(),
    completedCount: 0,
    failedCount: 0,
    lastFailure: null
  };
  return autoscreepsGlobal.__autoscreepsRoomPlanningHeap;
}

function getRoomPlanningMemory(roomName: string): RoomPlanningMemoryState | undefined {
  return Memory.rooms?.[roomName]?.planning;
}

function ensureRoomPlanningMemory(roomName: string): RoomPlanningMemoryState {
  Memory.rooms ??= {};
  Memory.rooms[roomName] ??= {};
  Memory.rooms[roomName].planning ??= {
    version: roomPlannerVersion,
    policy: defaultPolicy,
    status: "failed",
    requestedAt: Game.time,
    updatedAt: Game.time,
    ticksSpent: 0
  };
  return Memory.rooms[roomName].planning!;
}

function countMemoryPlanningStatus(status: RoomPlanningMemoryState["status"]): number {
  return Object.values(Memory.rooms ?? {}).filter((roomMemory) => roomMemory.planning?.version === roomPlannerVersion && roomMemory.planning.status === status).length;
}

function findLastMemoryFailure(): RoomPlanningTelemetry["lastFailure"] {
  let last: RoomPlanningTelemetry["lastFailure"] = null;
  for (const [roomName, roomMemory] of Object.entries(Memory.rooms ?? {})) {
    const planning = roomMemory.planning;
    if (planning?.version !== roomPlannerVersion || planning.status !== "failed" || planning.failedAt === undefined || !planning.failure) {
      continue;
    }
    if (last === null || planning.failedAt > last.failedAt) {
      last = {
        roomName,
        message: planning.failure,
        failedAt: planning.failedAt
      };
    }
  }
  return last;
}

function describeStage(job: RoomPlanningJob): string {
  return job.stage === "stamp" ? job.stampJob.stage : job.stage;
}

function createJobKey(roomName: string, policy: RoomPlanningPolicy): string {
  return `${roomName}:${policy}:${roomPlannerVersion}`;
}

function readTerrain(roomName: string): string {
  const terrain = new Room.Terrain(roomName);
  let result = "";
  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      result += String(terrain.get(x, y));
    }
  }
  return result;
}

function createObject(object: { id: Id<any>; pos: RoomPosition }, type: string): RoomPlanningObject {
  return {
    id: String(object.id),
    roomName: object.pos.roomName,
    type,
    x: object.pos.x,
    y: object.pos.y
  };
}

function findMinerals(room: Room): Mineral[] {
  return typeof FIND_MINERALS === "undefined" ? [] : room.find(FIND_MINERALS);
}

function findDeposits(room: Room): Deposit[] {
  return typeof FIND_DEPOSITS === "undefined" ? [] : room.find(FIND_DEPOSITS);
}

function compareObjects(left: RoomPlanningObject, right: RoomPlanningObject): number {
  if (left.type !== right.type) {
    return left.type.localeCompare(right.type);
  }
  if (left.x !== right.x) {
    return left.x - right.x;
  }
  if (left.y !== right.y) {
    return left.y - right.y;
  }
  return left.id.localeCompare(right.id);
}

function requireValue<T>(value: T | null, label: string): T {
  if (value === null) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}
