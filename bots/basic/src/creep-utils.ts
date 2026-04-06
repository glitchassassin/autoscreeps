import { recordTelemetryAction, recordTelemetryTargetFailure } from "./telemetry-state";

type MoveTarget = RoomPosition | { pos: RoomPosition };

export function updateWorkingState(creep: Creep): void {
  if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
    creep.memory.working = true;
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
  const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE) ?? creep.pos.findClosestByPath(FIND_SOURCES);

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
