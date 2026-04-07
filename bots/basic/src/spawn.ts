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

const bodyPlans: Record<WorkerRole, Array<{ cost: number; body: BodyPartConstant[] }>> = {
  harvester: [
    { cost: 200, body: ["work", "carry", "move"] },
    { cost: 300, body: ["work", "work", "carry", "move"] },
    { cost: 450, body: ["work", "work", "work", "carry", "move", "move"] },
    { cost: 550, body: ["work", "work", "work", "work", "carry", "move", "move"] }
  ],
  courier: [
    { cost: 150, body: ["carry", "carry", "move"] },
    { cost: 300, body: ["carry", "carry", "carry", "carry", "move", "move"] },
    { cost: 450, body: ["carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move"] },
    { cost: 600, body: ["carry", "carry", "carry", "carry", "carry", "carry", "carry", "carry", "move", "move", "move", "move"] }
  ],
  worker: [
    { cost: 200, body: ["work", "carry", "move"] },
    { cost: 300, body: ["work", "carry", "carry", "move", "move"] },
    { cost: 400, body: ["work", "work", "carry", "carry", "move", "move"] },
    { cost: 550, body: ["work", "work", "carry", "carry", "carry", "move", "move", "move"] }
  ]
};

const roleOrder: WorkerRole[] = ["harvester", "courier", "worker"];

export function chooseBody(role: WorkerRole, availableEnergy: number): BodyPartConstant[] | null {
  let selected: BodyPartConstant[] | null = null;

  for (const plan of bodyPlans[role]) {
    if (plan.cost <= availableEnergy) {
      selected = plan.body;
    }
  }

  return selected;
}

export function createSpawnRequest(spawn: StructureSpawn): SpawnRequest | null {
  if (spawn.spawning) {
    return null;
  }

  const nextRole = summarizeSpawnDemand(spawn.room).nextRole;
  if (!nextRole) {
    return null;
  }

  const body = chooseBody(nextRole, spawn.room.energyAvailable);
  if (!body) {
    return null;
  }

  return {
    body,
    name: `${nextRole}-${Game.time}`,
    memory: {
      role: nextRole,
      working: false,
      homeRoom: spawn.room.name
    }
  };
}

export function runSpawnManager(spawn: StructureSpawn): ScreepsReturnCode | null {
  const request = createSpawnRequest(spawn);
  if (!request) {
    return null;
  }

  const result = spawn.spawnCreep(request.body, request.name, { memory: request.memory });

  if (result === OK) {
    console.log(`[spawn] ${spawn.name} started ${request.memory.role} ${request.name}`);
  }

  return result;
}

export function summarizeSpawnDemand(room: Room | null = findPrimaryRoom()): SpawnDemandSummary {
  return summarizeSpawnDemandForRoom(room);
}

export function summarizeSpawnDemandForRoom(room: Room | null): SpawnDemandSummary {
  if (room && isPreRcl3OwnedRoom(room)) {
    return summarizePreRcl3Demand(room);
  }

  const unmetDemand: Record<WorkerRole, number> = {
    harvester: 0,
    courier: 0,
    worker: 0
  };
  let nextRole: WorkerRole | null = null;
  let totalUnmetDemand = 0;
  const desiredCreeps = determineDesiredCreeps(room);

  for (const role of roleOrder) {
    const deficit = Math.max(desiredCreeps[role] - countRole(role, room?.name), 0);
    unmetDemand[role] = deficit;
    totalUnmetDemand += deficit;

    if (nextRole === null && deficit > 0) {
      nextRole = role;
    }
  }

  return {
    unmetDemand,
    nextRole,
    totalUnmetDemand
  };
}

function determineDesiredCreeps(room: Room | null): Record<WorkerRole, number> {
  const sourceCount = Math.max(countSources(room), 1);
  const controllerLevel = room?.controller?.my ? room.controller.level : 1;
  const extensionTasks = countExtensionTasks(room);
  const backlogEnergy = countSourceBacklog(room);
  const harvesters = countRole("harvester", room?.name);
  const couriers = countRole("courier", room?.name);
  const workers = countRole("worker", room?.name);
  const desired: Record<WorkerRole, number> = {
    harvester: 1,
    courier: 0,
    worker: 0
  };

  if (harvesters > 0) {
    desired.courier = 1;
  }
  if (couriers > 0) {
    desired.harvester = Math.min(sourceCount, 2);
  }
  if (harvesters >= Math.min(sourceCount, 2) && couriers > 0) {
    desired.worker = 1;
  }
  if (workers > 0 && (backlogEnergy >= 150 || controllerLevel >= 2 || extensionTasks > 0)) {
    desired.courier = Math.max(desired.courier, Math.min(sourceCount, 2));
  }
  if (workers > 0 && (controllerLevel >= 2 || extensionTasks > 0)) {
    desired.worker = 2;
  }

  return desired;
}

function summarizePreRcl3Demand(room: Room): SpawnDemandSummary {
  const unmetDemand: Record<WorkerRole, number> = {
    harvester: 0,
    courier: 0,
    worker: 0
  };
  const sourceCount = Math.max(countSources(room), 1);
  const sourceBacklog = countSourceBacklog(room);
  const harvesterWorkTarget = sourceCount * 2;
  const workerWorkTarget = sourceCount * 3 + Math.floor(sourceBacklog / 300);
  const currentHarvesterWork = countRoleWork("harvester", room.name);
  const currentWorkerWork = countRoleWork("worker", room.name);
  const harvesterWorkPerCreep = estimateRoleWorkPerSpawn("harvester", room);
  const workerWorkPerCreep = estimateRoleWorkPerSpawn("worker", room);
  const harvesterWorkDeficit = Math.max(harvesterWorkTarget - currentHarvesterWork, 0);
  const workerWorkDeficit = Math.max(workerWorkTarget - currentWorkerWork, 0);

  unmetDemand.harvester = Math.ceil(harvesterWorkDeficit / harvesterWorkPerCreep);
  unmetDemand.worker = Math.ceil(workerWorkDeficit / workerWorkPerCreep);

  return {
    unmetDemand,
    nextRole: harvesterWorkDeficit > 0 ? "harvester" : workerWorkDeficit > 0 ? "worker" : null,
    totalUnmetDemand: unmetDemand.harvester + unmetDemand.worker
  };
}

function countRole(role: WorkerRole, roomName?: string): number {
  let total = 0;

  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.role === role && (!roomName || creep.memory.homeRoom === roomName)) {
      total += 1;
    }
  }

  return total;
}

function countRoleWork(role: WorkerRole, roomName?: string): number {
  let total = 0;

  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.role !== role || (roomName && creep.memory.homeRoom !== roomName)) {
      continue;
    }

    total += countWorkParts(creep);
  }

  return total;
}

function findPrimaryRoom(): Room | null {
  const firstSpawn = Object.values(Game.spawns ?? {})[0];
  if (firstSpawn) {
    return firstSpawn.room;
  }

  for (const room of Object.values(Game.rooms ?? {})) {
    if (room.controller?.my) {
      return room;
    }
  }

  return null;
}

function countSources(room: Room | null): number {
  if (!room || typeof room.find !== "function") {
    return 2;
  }

  return room.find(FIND_SOURCES).length;
}

function countExtensionTasks(room: Room | null): number {
  if (!room || typeof room.find !== "function") {
    return 0;
  }

  return room.find(FIND_MY_CONSTRUCTION_SITES, {
    filter: (site) => site.structureType === STRUCTURE_EXTENSION
  }).length;
}

function countSourceBacklog(room: Room | null): number {
  if (!room || typeof room.find !== "function") {
    return 0;
  }

  const sources = room.find(FIND_SOURCES);
  const drops = room.find(FIND_DROPPED_RESOURCES, {
    filter: (resource) => resource.resourceType === RESOURCE_ENERGY && resource.amount > 0
  });
  let total = 0;

  for (const drop of drops) {
    if (sources.some((source) => positionsAreNear(drop.pos, source.pos))) {
      total += drop.amount;
    }
  }

  return total;
}

function positionsAreNear(position: RoomPosition, target: RoomPosition): boolean {
  return position.roomName === target.roomName && Math.max(Math.abs(position.x - target.x), Math.abs(position.y - target.y)) <= 1;
}

function estimateRoleWorkPerSpawn(role: WorkerRole, room: Room): number {
  const body = chooseBody(role, room.energyCapacityAvailable) ?? chooseBody(role, room.energyAvailable);
  return Math.max(countBodyPart(body, WORK), 1);
}

function countWorkParts(creep: Creep): number {
  if (Array.isArray(creep.body)) {
    return creep.body.filter((part) => part.type === WORK && (part.hits === undefined || part.hits > 0)).length;
  }

  return fallbackRoleWorkParts(creep.memory.role);
}

function countBodyPart(body: BodyPartConstant[] | null, part: BodyPartConstant): number {
  if (!body) {
    return 0;
  }

  return body.filter((bodyPart) => bodyPart === part).length;
}

function fallbackRoleWorkParts(role: WorkerRole): number {
  if (role === "harvester") {
    return 2;
  }
  if (role === "worker") {
    return 1;
  }

  return 0;
}

function isPreRcl3OwnedRoom(room: Room | null): boolean {
  return Boolean(room?.controller?.my && room.controller.level < 3);
}
