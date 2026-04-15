import { findDeliveryTarget, findPickupTarget } from "./energy";
import { updateWorkingState } from "./working-state";

export function runRunner(creep: Creep): void {
  updateWorkingState(creep);

  if (creep.memory.working) {
    deliverEnergy(creep);
    return;
  }

  pickupEnergy(creep);
}

function pickupEnergy(creep: Creep): void {
  const target = findPickupTarget(creep);
  if (!target) {
    return;
  }

  const result = creep.pickup(target);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: "#ffaa00" } });
  }
}

function deliverEnergy(creep: Creep): void {
  const target = findDeliveryTarget(creep);
  if (!target) {
    return;
  }

  const result = creep.transfer(target, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
  }
}
