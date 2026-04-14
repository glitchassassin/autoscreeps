const workerTarget = 5;
const bodyPartPattern: BodyPartConstant[] = ["work", "carry", "move"];
const bodyPartPatternCost = 200;
const maxBodyPatterns = 5;

type SpawnRequest = {
  body: BodyPartConstant[];
  memory: CreepMemory;
  name: string;
};

export type SpawnDemandSummary = {
  unmetDemand: Record<WorkerRole, number>;
  nextRole: WorkerRole | null;
  totalUnmetDemand: number;
};

export function chooseBody(role: WorkerRole, availableEnergy: number): BodyPartConstant[] | null {
  if (role !== "worker") {
    return null;
  }

  const patternCount = Math.min(Math.floor(availableEnergy / bodyPartPatternCost), maxBodyPatterns);
  if (patternCount <= 0) {
    return null;
  }

  return Array.from({ length: patternCount }, () => bodyPartPattern).flat();
}

export function summarizeSpawnDemand(room: Room | null = findPrimaryRoom()): SpawnDemandSummary {
  const workerCount = countWorkers(room?.name);
  const deficit = Math.max(workerTarget - workerCount, 0);

  return {
    unmetDemand: {
      worker: deficit
    },
    nextRole: deficit > 0 ? "worker" : null,
    totalUnmetDemand: deficit
  };
}

export function createSpawnRequest(spawn: StructureSpawn): SpawnRequest | null {
  if (spawn.spawning) {
    return null;
  }

  const demand = summarizeSpawnDemand(spawn.room);
  if (demand.nextRole === null) {
    return null;
  }

  const body = chooseBody(demand.nextRole, spawn.room.energyAvailable);
  if (body === null) {
    return null;
  }

  return {
    body,
    name: `worker-${Game.time}`,
    memory: {
      role: "worker",
      working: false,
      homeRoom: spawn.room.name
    }
  };
}

export function runSpawnManager(spawn: StructureSpawn): ScreepsReturnCode | null {
  const request = createSpawnRequest(spawn);
  if (request === null) {
    return null;
  }

  return spawn.spawnCreep(request.body, request.name, { memory: request.memory });
}

function countWorkers(roomName?: string): number {
  return Object.values(Game.creeps).filter((creep) => {
    if (creep.memory.role !== "worker") {
      return false;
    }

    return roomName === undefined || creep.memory.homeRoom === roomName;
  }).length;
}

function findPrimaryRoom(): Room | null {
  const primarySpawn = Object.values(Game.spawns)[0];
  if (primarySpawn) {
    return primarySpawn.room;
  }

  return Object.values(Game.rooms).find((room) => room.controller?.my) ?? null;
}
