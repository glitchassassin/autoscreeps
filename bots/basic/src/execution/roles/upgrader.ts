import { canWithdrawEnergy, findWithdrawTarget } from "./energy";
import { moveAwayFromSpawnAccess, moveToWithdrawTarget, moveToWorkTarget } from "../traffic";
import { calculateUpgradeEnergy, calculateWithdrawEnergy, createEnergyAccountingContext, reserveUpgradeEnergy, reserveWithdrawEnergy, type EnergyAccountingContext } from "../energy-accounting";
import { adjustRememberedCreepEnergy, recordUpgradedEnergy, recordWithdrawnEnergy } from "../../state/telemetry";

export function runUpgrader(creep: Creep, energyContext: EnergyAccountingContext = createEnergyAccountingContext()): void {
  if (creep.store[RESOURCE_ENERGY] === 0) {
    refillEnergy(creep, energyContext);
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
    moveAwayFromSpawnAccess(creep, withdrawTarget, "#ffaa00");
    return;
  }

  const withdrawnEnergy = calculateWithdrawEnergy(energyContext, creep, withdrawTarget);
  const result = creep.withdraw(withdrawTarget, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) {
    moveToWithdrawTarget(creep, withdrawTarget, "#ffaa00");
    return;
  }
  if (result !== OK) {
    return;
  }

  reserveWithdrawEnergy(energyContext, withdrawTarget, withdrawnEnergy);
  recordWithdrawnEnergy(withdrawnEnergy);
  adjustRememberedCreepEnergy(creep, withdrawnEnergy);
}

function upgradeController(creep: Creep, energyContext: EnergyAccountingContext): void {
  const controller = creep.room.controller;
  if (!controller?.my) {
    return;
  }

  const upgradedEnergy = calculateUpgradeEnergy(energyContext, creep, controller);
  const result = creep.upgradeController(controller);
  if (result === ERR_NOT_IN_RANGE) {
    moveToWorkTarget(creep, controller, 3, "#ffffff");
    return;
  }
  if (result !== OK) {
    return;
  }

  reserveUpgradeEnergy(energyContext, controller, upgradedEnergy);
  recordUpgradedEnergy(upgradedEnergy);
  adjustRememberedCreepEnergy(creep, -upgradedEnergy);
}
