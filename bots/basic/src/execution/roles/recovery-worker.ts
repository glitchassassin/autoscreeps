import { findDeliveryTarget } from "./energy";
import { updateWorkingState } from "./working-state";

export function runRecoveryWorker(creep: Creep): void {
  updateWorkingState(creep);

  if (creep.memory.working) {
    deliverToSpawn(creep);
    return;
  }

  harvestNearestSource(creep);
}

function harvestNearestSource(creep: Creep): void {
  const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE) ?? creep.pos.findClosestByPath(FIND_SOURCES);
  if (!source) {
    return;
  }

  const result = creep.harvest(source);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
  }
}

function deliverToSpawn(creep: Creep): void {
  const target = findDeliveryTarget(creep);
  if (!target || !("spawnCreep" in target)) {
    return;
  }

  const result = creep.transfer(target, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
  }
}
