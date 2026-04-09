import { recordTelemetryAction, recordTelemetryTargetFailure } from "./telemetry-state";

type MoveTarget = RoomPosition | { pos: RoomPosition };
type EnergyDrop = Resource<ResourceConstant>;

export function updateWorkingState(creep: Creep): void {
  if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
    creep.memory.working = true;
  }

  if (creep.memory.working) {
    delete creep.memory.sourceId;
  }
}

export function moveToTarget(creep: Creep, target: MoveTarget): void {
  const result = creep.moveTo(target, {
    visualizePathStyle: { stroke: "#f2d492" }
  });

  recordTelemetryAction(creep, "move", result, {
    targetType: resolveTargetType(target),
    targetKey: resolveTargetKey(target)
  });
}

export function harvestNearestSource(creep: Creep): void {
  const source = resolveSource(creep);

  if (!source) {
    delete creep.memory.sourceId;
    recordTelemetryTargetFailure(creep, "no_source");
    return;
  }

  creep.memory.sourceId = source.id;

  const result = creep.harvest(source);
  recordTelemetryAction(creep, "harvest", result, {
    targetType: "source",
    targetKey: source.id,
    sourceId: source.id
  });
  if (result === ERR_NOT_IN_RANGE) {
    moveToTarget(creep, source);
  }
}

export function findClosestConstructionSite(creep: Creep): ConstructionSite | null {
  return findClosestConstructionSiteMatching(creep);
}

export function findClosestConstructionSiteMatching(
  creep: Creep,
  filter?: (site: ConstructionSite) => boolean
): ConstructionSite | null {
  const sites = creep.room.find(FIND_MY_CONSTRUCTION_SITES, filter ? { filter } : undefined);
  return creep.pos.findClosestByPath(sites);
}

export function findClosestEnergyDrop(
  creep: Creep,
  filter: (resource: EnergyDrop) => boolean
): EnergyDrop | null {
  const drops = creep.room.find(FIND_DROPPED_RESOURCES, {
    filter: (resource) => resource.resourceType === RESOURCE_ENERGY && resource.amount > 0 && filter(resource)
  }) as EnergyDrop[];

  return creep.pos.findClosestByPath(drops);
}

export function pickupEnergyDrop(creep: Creep, drop: EnergyDrop): ScreepsReturnCode {
  const result = creep.pickup(drop);
  recordTelemetryAction(creep, "pickup", result, {
    targetType: "drop",
    targetKey: drop.id,
    dropId: drop.id
  });
  if (result === ERR_NOT_IN_RANGE) {
    moveToTarget(creep, drop);
  }

  return result;
}

export function isSourceAdjacentPosition(room: Room, position: RoomPosition): boolean {
  const sources = room.find(FIND_SOURCES);
  return sources.some((source) => positionsAreNear(position, source.pos));
}

export function positionsAreNear(position: RoomPosition | undefined, target: RoomPosition | undefined): boolean {
  if (!position || !target || position.roomName !== target.roomName) {
    return false;
  }

  return Math.max(Math.abs(position.x - target.x), Math.abs(position.y - target.y)) <= 1;
}

function resolveSource(creep: Creep): Source | null {
  const rememberedSource = creep.memory.sourceId ? Game.getObjectById(creep.memory.sourceId) : null;
  if (rememberedSource) {
    return rememberedSource;
  }

  const sources = creep.room.find(FIND_SOURCES);
  if (sources.length === 0) {
    return null;
  }

  let selected = sources[0]!;
  let selectedAssignments = countAssignedSourceCreeps(selected.id);
  let selectedRange = linearRange(creep.pos, selected.pos);

  for (const source of sources.slice(1)) {
    const assignments = countAssignedSourceCreeps(source.id);
    const range = linearRange(creep.pos, source.pos);
    if (assignments < selectedAssignments || (assignments === selectedAssignments && range < selectedRange)) {
      selected = source;
      selectedAssignments = assignments;
      selectedRange = range;
    }
  }

  return selected;
}

function countAssignedSourceCreeps(sourceId: Id<Source>): number {
  let total = 0;

  for (const creep of Object.values(Game.creeps)) {
    if (
      (creep.memory.role === "harvester" || creep.memory.role === "worker")
      && !creep.memory.working
      && creep.memory.sourceId === sourceId
    ) {
      total += 1;
    }
  }

  return total;
}

function linearRange(position: RoomPosition, target: RoomPosition): number {
  if (position.roomName !== target.roomName) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.max(Math.abs(position.x - target.x), Math.abs(position.y - target.y));
}

function resolveTargetType(target: MoveTarget): string {
  const typedTarget = target as unknown as { structureType?: unknown };
  if ("structureType" in (target as Record<string, unknown>) && typeof typedTarget.structureType === "string") {
    return typedTarget.structureType;
  }

  return "position";
}

function resolveTargetKey(target: MoveTarget): string | undefined {
  const typedTarget = target as unknown as { id?: unknown; pos?: RoomPosition };
  if ("id" in (target as Record<string, unknown>) && typeof typedTarget.id === "string") {
    return typedTarget.id;
  }

  const position = "pos" in (target as Record<string, unknown>)
    ? typedTarget.pos as RoomPosition
    : target as RoomPosition;

  return `${position.roomName}:${position.x},${position.y}`;
}
