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
  creep.moveTo(target, {
    visualizePathStyle: { stroke: "#f2d492" }
  });
}

export function harvestNearestSource(creep: Creep): void {
  const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE) ?? creep.pos.findClosestByPath(FIND_SOURCES);

  if (!source) {
    return;
  }

  const result = creep.harvest(source);
  if (result === ERR_NOT_IN_RANGE) {
    moveToTarget(creep, source);
  }
}
