import { findPickupTarget, findWithdrawTarget } from "./energy";

export function runUpgrader(creep: Creep): void {
  if (creep.store[RESOURCE_ENERGY] === 0) {
    refillEnergy(creep);
    return;
  }

  upgradeController(creep);
}

function refillEnergy(creep: Creep): void {
  const withdrawTarget = findWithdrawTarget(creep);
  if (withdrawTarget) {
    const result = creep.withdraw(withdrawTarget, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(withdrawTarget, { visualizePathStyle: { stroke: "#ffaa00" } });
    }
    return;
  }

  const pickupTarget = findPickupTarget(creep);
  if (!pickupTarget) {
    return;
  }

  const result = creep.pickup(pickupTarget);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(pickupTarget, { visualizePathStyle: { stroke: "#ffaa00" } });
  }
}

function upgradeController(creep: Creep): void {
  const controller = creep.room.controller;
  if (!controller?.my) {
    return;
  }

  const result = creep.upgradeController(controller);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, { visualizePathStyle: { stroke: "#ffffff" } });
  }
}
