import { canWithdrawEnergy, findWithdrawTarget } from "./energy";
import { updateWorkingState } from "./working-state";

export function runBuilder(creep: Creep): void {
  updateWorkingState(creep);

  if (!creep.memory.working) {
    refillEnergy(creep);
    return;
  }

  const target = findBuildTarget(creep);
  if (target) {
    buildSite(creep, target);
    return;
  }

  upgradeController(creep);
}

function refillEnergy(creep: Creep): void {
  const withdrawTarget = findWithdrawTarget(creep);
  if (!withdrawTarget) {
    return;
  }

  if (!canWithdrawEnergy(withdrawTarget)) {
    creep.moveTo(withdrawTarget, { visualizePathStyle: { stroke: "#ffaa00" } });
    return;
  }

  const result = creep.withdraw(withdrawTarget, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(withdrawTarget, { visualizePathStyle: { stroke: "#ffaa00" } });
  }
}

function findBuildTarget(creep: Creep): ConstructionSite | null {
  const targets = creep.room.find(FIND_MY_CONSTRUCTION_SITES);
  if (targets.length === 0) {
    return null;
  }

  return creep.pos.findClosestByPath(targets) ?? targets[0] ?? null;
}

function buildSite(creep: Creep, target: ConstructionSite): void {
  const result = creep.build(target);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
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
