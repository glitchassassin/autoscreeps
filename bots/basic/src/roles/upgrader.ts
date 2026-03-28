import { harvestNearestSource, moveToTarget, updateWorkingState } from "../creep-utils";

export function runUpgrader(creep: Creep): void {
  updateWorkingState(creep);

  if (!creep.memory.working) {
    harvestNearestSource(creep);
    return;
  }

  const controller = creep.room.controller;
  if (!controller) {
    return;
  }

  const result = creep.upgradeController(controller);
  if (result === ERR_NOT_IN_RANGE) {
    moveToTarget(creep, controller);
  }
}
