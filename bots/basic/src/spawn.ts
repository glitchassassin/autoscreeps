type SpawnRequest = {
  body: BodyPartConstant[];
  memory: CreepMemory;
  name: string;
  admission: TelemetrySpawnAdmissionState | null;
};

const preRcl3BodyCostCapByRole: Partial<Record<WorkerRole, number>> = {
  harvester: 300,
  courier: 300,
  worker: 300
};

const preRcl3Courier3SourceBacklogThreshold = 700;
const preRcl3Courier3LatencyThreshold = 200;
const preRcl3Courier3PostRcl2GraceTicks = 50;
const preRcl3BacklogCourierTarget = 3;

export type SpawnDemandSummary = {
  unmetDemand: Record<WorkerRole, number>;
  nextRole: WorkerRole | null;
  totalUnmetDemand: number;
};

export type SpawnBankPressure = {
  nextRole: WorkerRole | null;
  totalUnmetDemand: number;
  queueHeadCost: number | null;
  waitingForEnergy: boolean;
};

export type ExtraWorkerGateReason = "source_backlog" | "loaded_courier" | "courier_parity";

export type ExtraWorkerGateState = {
  applicable: boolean;
  blocked: boolean;
  openReasons: ExtraWorkerGateReason[];
  baseWorkerTarget: number;
  parityWorkerTarget: number;
  gatedWorkerTarget: number;
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

type BodyPlan = { cost: number; body: BodyPartConstant[] };

export function chooseBody(role: WorkerRole, availableEnergy: number): BodyPartConstant[] | null {
  return chooseBodyPlan(role, availableEnergy)?.body ?? null;
}

export function createSpawnRequest(spawn: StructureSpawn): SpawnRequest | null {
  if (spawn.spawning) {
    return null;
  }

  const demand = summarizeSpawnDemand(spawn.room);
  const nextRole = demand.nextRole;
  if (!nextRole) {
    return null;
  }

  const fullAffordabilityCost = determineQueueHeadFullAffordabilityCost(spawn.room, nextRole);
  if (fullAffordabilityCost !== null && spawn.room.energyAvailable < fullAffordabilityCost) {
    return null;
  }

  const body = chooseSpawnBody(nextRole, spawn.room);
  if (!body) {
    return null;
  }

  return {
    body,
    name: `${nextRole}-${Game.time}`,
    admission: buildSpawnAdmissionSnapshot(spawn.room),
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
    recordSpawnAdmission(request.memory.role, request.admission);
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

export function inspectSpawnBankPressure(room: Room | null): SpawnBankPressure {
  const demand = summarizeSpawnDemandForRoom(room);
  const queueHeadCost = room && demand.nextRole ? determineQueueHeadFullAffordabilityCost(room, demand.nextRole) : null;

  return {
    nextRole: demand.nextRole,
    totalUnmetDemand: demand.totalUnmetDemand,
    queueHeadCost,
    waitingForEnergy: Boolean(
      room
      && demand.totalUnmetDemand > 0
      && queueHeadCost !== null
      && room.energyAvailable < queueHeadCost
    )
  };
}

export function inspectPreRcl3ExtraWorkerGate(room: Room | null): ExtraWorkerGateState | null {
  if (!room || !isPreRcl3OwnedRoom(room)) {
    return null;
  }

  const context = createPreRcl3DemandContext(room);
  const baseDesired = determinePreRcl3BaseDesiredCreeps(context);
  const desiredCourierTarget = determinePreRcl3BacklogCourierTargetCount(context, baseDesired.courier);
  return resolvePreRcl3ExtraWorkerGate(context, baseDesired.worker, desiredCourierTarget);
}

function buildSpawnAdmissionSnapshot(room: Room): TelemetrySpawnAdmissionState | null {
  if (!isPreRcl3OwnedRoom(room)) {
    return null;
  }

  const context = createPreRcl3DemandContext(room);
  const baseDesired = determinePreRcl3BaseDesiredCreeps(context);
  const desiredCourierTarget = determinePreRcl3BacklogCourierTargetCount(context, baseDesired.courier);
  const extraWorkerGate = resolvePreRcl3ExtraWorkerGate(context, baseDesired.worker, desiredCourierTarget);

  return {
    gameTime: Game.time,
    sourceBacklog: countSourceBacklog(room),
    loadedCouriers: countLoadedCouriers(room.name),
    roleCounts: {
      harvester: countRole("harvester", room.name),
      courier: countRole("courier", room.name),
      worker: countRole("worker", room.name)
    },
    openReasons: [...extraWorkerGate.openReasons],
    spawnWaitingWithSourceBacklogTicks: context.spawnWaitingWithSourceBacklogTicks,
    sourceDropToBankLatencyAvg: context.sourceDropToBankLatencyAvg,
    withinCourier3Window: context.withinCourier3Window,
    courier3PriorityActive: isPreRcl3Courier3PriorityActive(context)
  };
}

function recordSpawnAdmission(role: WorkerRole, admission: TelemetrySpawnAdmissionState | null): void {
  if (!admission) {
    return;
  }

  const admissions = ensureTelemetrySpawnAdmissions();

  if (role === "courier" && admissions.firstCourier3 === null && admission.roleCounts.courier >= 2) {
    admissions.firstCourier3 = admission;
  }

  if (role === "worker" && admissions.firstWorker4 === null && admission.roleCounts.worker >= 3) {
    admissions.firstWorker4 = admission;
  }
}

function ensureTelemetrySpawnAdmissions(): TelemetrySpawnAdmissionsState {
  Memory.telemetry ??= {
    creepDeaths: 0,
    firstOwnedSpawnTick: null,
    rcl2Tick: null,
    rcl3Tick: null
  };
  Memory.telemetry.spawnAdmissions ??= {
    firstCourier3: null,
    firstWorker4: null
  };

  return Memory.telemetry.spawnAdmissions;
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
  const desiredCreeps = determinePreRcl3DesiredCreeps(room);
  const unmetDemand: Record<WorkerRole, number> = {
    harvester: 0,
    courier: 0,
    worker: 0
  };
  let nextRole: WorkerRole | null = null;
  let totalUnmetDemand = 0;

  for (const role of roleOrder) {
    const deficit = Math.max(desiredCreeps[role] - countRole(role, room.name), 0);
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

function determinePreRcl3DesiredCreeps(room: Room): Record<WorkerRole, number> {
  const context = createPreRcl3DemandContext(room);
  const desired = determinePreRcl3BaseDesiredCreeps(context);
  desired.courier = determinePreRcl3BacklogCourierTargetCount(context, desired.courier);

  const extraWorkerGate = resolvePreRcl3ExtraWorkerGate(context, desired.worker, desired.courier);

  if (extraWorkerGate.openReasons.length > 0) {
    desired.worker = Math.max(desired.worker, extraWorkerGate.gatedWorkerTarget);
  }

  return desired;
}

type PreRcl3DemandContext = {
  gameTime: number;
  room: Room;
  sourceCount: number;
  activeHarvestingSourceCount: number;
  sourceBacklog: number;
  controllerLevel: number;
  harvesters: number;
  couriers: number;
  workers: number;
  fullSourceSitterCount: number;
  spawnRefillCovered: boolean;
  loadedCouriers: number;
  workerSpendParityTarget: number;
  spawnWaitingWithSourceBacklogTicks: number;
  sourceDropToBankLatencyAvg: number | null;
  rcl2Tick: number | null;
  withinCourier3Window: boolean;
  courier3Started: boolean;
  worker4Started: boolean;
};

function createPreRcl3DemandContext(room: Room): PreRcl3DemandContext {
  const sourceCount = Math.max(countSources(room), 1);
  const telemetryLoop = Memory.telemetry?.loop;
  const rcl2Tick = Memory.telemetry?.rcl2Tick ?? null;

  return {
    gameTime: Game.time,
    room,
    sourceCount,
    activeHarvestingSourceCount: countActiveHarvestingSources(room),
    sourceBacklog: countSourceBacklog(room),
    controllerLevel: room.controller?.level ?? 1,
    harvesters: countRole("harvester", room.name),
    couriers: countRole("courier", room.name),
    workers: countRole("worker", room.name),
    fullSourceSitterCount: Math.min(sourceCount, 2),
    spawnRefillCovered: room.energyAvailable >= room.energyCapacityAvailable,
    loadedCouriers: countLoadedCouriers(room.name),
    workerSpendParityTarget: Math.max(2, Math.min(countRoleWorkParts("harvester", room.name), 4)),
    spawnWaitingWithSourceBacklogTicks: telemetryLoop?.spawnWaitingWithSourceBacklogTicks ?? 0,
    sourceDropToBankLatencyAvg: averageLatency(
      telemetryLoop?.sourceDropToBankLatencyTotal,
      telemetryLoop?.sourceDropToBankLatencySamples
    ),
    rcl2Tick,
    withinCourier3Window: rcl2Tick === null || Game.time <= rcl2Tick + preRcl3Courier3PostRcl2GraceTicks,
    courier3Started: Memory.telemetry?.spawnAdmissions?.firstCourier3 != null,
    worker4Started: Memory.telemetry?.spawnAdmissions?.firstWorker4 != null
  };
}

function determinePreRcl3BaseDesiredCreeps(context: PreRcl3DemandContext): Record<WorkerRole, number> {
  const desired: Record<WorkerRole, number> = {
    harvester: 1,
    courier: 0,
    worker: 0
  };

  if (context.harvesters > 0) {
    desired.courier = 1;
  }
  if (context.couriers > 0) {
    desired.harvester = context.fullSourceSitterCount;
  }
  if (context.couriers > 0 && context.activeHarvestingSourceCount >= context.fullSourceSitterCount) {
    desired.worker = 1;
  }
  if (context.workers > 0 && (context.sourceBacklog >= 150 || context.controllerLevel >= 2)) {
    desired.courier = Math.max(desired.courier, context.fullSourceSitterCount);
  }
  if (context.workers > 0 && (context.sourceBacklog >= 300 || context.controllerLevel >= 2)) {
    desired.worker = 2;
  }

  return desired;
}

function determinePreRcl3BacklogCourierTargetCount(
  context: PreRcl3DemandContext,
  baseCourierTarget: number
): number {
  if (isPreRcl3Courier3PriorityActive(context)) {
    return Math.max(baseCourierTarget, preRcl3BacklogCourierTarget);
  }

  return baseCourierTarget;
}

function isPreRcl3Courier3PriorityActive(context: PreRcl3DemandContext): boolean {
  const latencyPressure = hasPreRcl3Courier3LatencyPressure(context);

  if (!latencyPressure || context.sourceBacklog < preRcl3Courier3SourceBacklogThreshold || context.workers < 3) {
    return false;
  }

  if (context.courier3Started) {
    return true;
  }

  return (
    context.couriers >= context.fullSourceSitterCount
    && !context.worker4Started
    && context.withinCourier3Window
    && context.loadedCouriers > 0
  );
}

function hasPreRcl3Courier3LatencyPressure(context: PreRcl3DemandContext): boolean {
  return context.sourceDropToBankLatencyAvg !== null
    && context.sourceDropToBankLatencyAvg >= preRcl3Courier3LatencyThreshold;
}

function resolvePreRcl3ExtraWorkerGate(
  context: PreRcl3DemandContext,
  baseWorkerTarget: number,
  desiredCourierTarget: number
): ExtraWorkerGateState {
  const openReasons: ExtraWorkerGateReason[] = [];

  if (context.sourceBacklog >= 300) {
    openReasons.push("source_backlog");
  }
  if (context.loadedCouriers > 0) {
    openReasons.push("loaded_courier");
  }

  const applicable = baseWorkerTarget >= 2 && context.workerSpendParityTarget > baseWorkerTarget;
  const gateOpen = context.workers > 0 && context.spawnRefillCovered && openReasons.length > 0;
  let gatedWorkerTarget = baseWorkerTarget;

  if (gateOpen) {
    gatedWorkerTarget = Math.max(gatedWorkerTarget, Math.min(baseWorkerTarget + 1, context.workerSpendParityTarget));

    const needsBacklogCourierBeforeWorker4 = (
      desiredCourierTarget > context.fullSourceSitterCount
      && context.sourceBacklog >= preRcl3Courier3SourceBacklogThreshold
      && context.couriers < desiredCourierTarget
    );

    if (!needsBacklogCourierBeforeWorker4 && !context.courier3Started) {
      if (desiredCourierTarget > context.fullSourceSitterCount && context.couriers >= desiredCourierTarget) {
        openReasons.push("courier_parity");
      }
      gatedWorkerTarget = context.workerSpendParityTarget;
    }
  }

  return {
    applicable,
    blocked: applicable && gatedWorkerTarget < context.workerSpendParityTarget,
    openReasons: gateOpen ? openReasons : [],
    baseWorkerTarget,
    parityWorkerTarget: context.workerSpendParityTarget,
    gatedWorkerTarget
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

function chooseSpawnBody(role: WorkerRole, room: Room): BodyPartConstant[] | null {
  return chooseSpawnBodyForEnergy(role, room.energyAvailable, room.controller?.my ? room.controller.level : undefined);
}

function determineQueueHeadFullAffordabilityCost(room: Room, role: WorkerRole): number | null {
  const controllerLevel = room.controller?.my ? room.controller.level : undefined;
  const fullPlan = chooseSpawnBodyPlan(role, room.energyCapacityAvailable, controllerLevel);
  return fullPlan?.cost ?? null;
}

function chooseSpawnBodyForEnergy(
  role: WorkerRole,
  availableEnergy: number,
  controllerLevel?: number
): BodyPartConstant[] | null {
  return chooseSpawnBodyPlan(role, availableEnergy, controllerLevel)?.body ?? null;
}

function chooseBodyPlan(role: WorkerRole, availableEnergy: number): BodyPlan | null {
  let selected: BodyPlan | null = null;

  for (const plan of bodyPlans[role]) {
    if (plan.cost <= availableEnergy) {
      selected = plan;
    }
  }

  return selected;
}

function chooseSpawnBodyPlan(role: WorkerRole, availableEnergy: number, controllerLevel?: number): BodyPlan | null {
  const effectiveEnergy = controllerLevel !== undefined && controllerLevel < 3
    ? Math.min(availableEnergy, preRcl3BodyCostCapByRole[role] ?? availableEnergy)
    : availableEnergy;

  return chooseBodyPlan(role, effectiveEnergy);
}

function countActiveHarvestingSources(room: Room): number {
  const sourcesById = new Map(room.find(FIND_SOURCES).map((source) => [source.id, source]));
  const activeSources = new Set<string>();

  for (const creep of Object.values(Game.creeps)) {
    if (
      creep.memory.homeRoom !== room.name
      || creep.memory.working
      || (creep.memory.role !== "harvester" && creep.memory.role !== "worker")
      || !creep.memory.sourceId
    ) {
      continue;
    }

    const source = sourcesById.get(creep.memory.sourceId);
    if (source && positionsAreNear(creep.pos, source.pos)) {
      activeSources.add(source.id);
    }
  }

  return activeSources.size;
}

function countLoadedCouriers(roomName: string): number {
  let total = 0;

  for (const creep of Object.values(Game.creeps)) {
    if (
      creep.memory.homeRoom === roomName
      && creep.memory.role === "courier"
      && creep.memory.working
      && getStoredEnergy(creep) > 0
    ) {
      total += 1;
    }
  }

  return total;
}

function countRoleWorkParts(role: WorkerRole, roomName?: string): number {
  let total = 0;

  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.role !== role || (roomName && creep.memory.homeRoom !== roomName)) {
      continue;
    }

    total += creep.body.filter((part) => part.type === WORK && part.hits > 0).length;
  }

  return total;
}

function getStoredEnergy(creep: Creep): number {
  return typeof creep.store?.[RESOURCE_ENERGY] === "number" ? creep.store[RESOURCE_ENERGY] : 0;
}

function averageLatency(total: number | undefined, samples: number | undefined): number | null {
  if (typeof total !== "number" || typeof samples !== "number" || samples <= 0) {
    return null;
  }

  return total / samples;
}

function isPreRcl3OwnedRoom(room: Room | null): boolean {
  return Boolean(room?.controller?.my && room.controller.level < 3);
}
