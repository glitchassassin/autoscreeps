import { canWithdrawEnergy, findWithdrawTarget } from "./energy";
import { updateWorkingState } from "./working-state";
import { calculateBuildEnergy, calculateUpgradeEnergy, calculateWithdrawEnergy, createEnergyAccountingContext, reserveBuildEnergy, reserveUpgradeEnergy, reserveWithdrawEnergy, type EnergyAccountingContext } from "../energy-accounting";
import { adjustRememberedCreepEnergy, recordBuiltEnergy, recordUpgradedEnergy, recordWithdrawnEnergy } from "../../state/telemetry";

export function runBuilder(creep: Creep, energyContext: EnergyAccountingContext = createEnergyAccountingContext()): void {
  updateWorkingState(creep);

  if (!creep.memory.working) {
    refillEnergy(creep, energyContext);
    return;
  }

  const target = findBuildTarget(creep);
  if (target) {
    buildSite(creep, target, energyContext);
    return;
  }

  upgradeController(creep, energyContext);
}

function refillEnergy(creep: Creep, energyContext: EnergyAccountingContext): void {
  const withdrawTarget = findWithdrawTarget(creep);
  if (!withdrawTarget) {
    return;
  }

  if (!canWithdrawEnergy(withdrawTarget)) {
    creep.moveTo(withdrawTarget, { visualizePathStyle: { stroke: "#ffaa00" } });
    return;
  }

  const withdrawnEnergy = calculateWithdrawEnergy(energyContext, creep, withdrawTarget);
  const result = creep.withdraw(withdrawTarget, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(withdrawTarget, { visualizePathStyle: { stroke: "#ffaa00" } });
    return;
  }
  if (result !== OK) {
    return;
  }

  reserveWithdrawEnergy(energyContext, withdrawTarget, withdrawnEnergy);
  recordWithdrawnEnergy(withdrawnEnergy);
  adjustRememberedCreepEnergy(creep, withdrawnEnergy);
}

function findBuildTarget(creep: Creep): ConstructionSite | null {
  const targets = creep.room.find(FIND_MY_CONSTRUCTION_SITES);
  if (targets.length === 0) {
    return null;
  }

  return creep.pos.findClosestByPath(targets) ?? targets[0] ?? null;
}

function buildSite(creep: Creep, target: ConstructionSite, energyContext: EnergyAccountingContext): void {
  const builtEnergy = calculateBuildEnergy(energyContext, creep, target);
  const result = creep.build(target);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
    return;
  }
  if (result !== OK) {
    return;
  }

  reserveBuildEnergy(energyContext, target, builtEnergy);
  recordBuiltEnergy(builtEnergy);
  adjustRememberedCreepEnergy(creep, -builtEnergy);
}

function upgradeController(creep: Creep, energyContext: EnergyAccountingContext): void {
  const controller = creep.room.controller;
  if (!controller?.my) {
    return;
  }

  const upgradedEnergy = calculateUpgradeEnergy(energyContext, creep, controller);
  const result = creep.upgradeController(controller);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller, { visualizePathStyle: { stroke: "#ffffff" } });
    return;
  }
  if (result !== OK) {
    return;
  }

  reserveUpgradeEnergy(energyContext, controller, upgradedEnergy);
  recordUpgradedEnergy(upgradedEnergy);
  adjustRememberedCreepEnergy(creep, -upgradedEnergy);
}
