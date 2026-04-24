import { findDeliveryTarget } from "./energy";
import { updateWorkingState } from "./working-state";
import { calculateDroppedHarvestEnergy, calculateHarvestedEnergy, calculateTransferEnergy, createEnergyAccountingContext, reserveHarvestedEnergy, reserveTransferEnergy, type EnergyAccountingContext } from "../energy-accounting";
import { adjustRememberedCreepEnergy, recordDroppedEnergy, recordHarvestedEnergy, recordTransferredEnergy } from "../../state/telemetry";

export function runRecoveryWorker(creep: Creep, energyContext: EnergyAccountingContext = createEnergyAccountingContext()): void {
  updateWorkingState(creep);

  if (creep.memory.working) {
    deliverToSpawn(creep, energyContext);
    return;
  }

  harvestNearestSource(creep, energyContext);
}

function harvestNearestSource(creep: Creep, energyContext: EnergyAccountingContext): void {
  const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE) ?? creep.pos.findClosestByPath(FIND_SOURCES);
  if (!source) {
    return;
  }

  const result = creep.harvest(source);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
    return;
  }
  if (result !== OK) {
    return;
  }

  const harvestedEnergy = calculateHarvestedEnergy(energyContext, creep, source);
  const droppedEnergy = calculateDroppedHarvestEnergy(creep, harvestedEnergy);
  reserveHarvestedEnergy(energyContext, source, harvestedEnergy);
  recordHarvestedEnergy(source.id, harvestedEnergy);
  recordDroppedEnergy(droppedEnergy);
  adjustRememberedCreepEnergy(creep, harvestedEnergy - droppedEnergy);
}

function deliverToSpawn(creep: Creep, energyContext: EnergyAccountingContext): void {
  const target = findDeliveryTarget(creep);
  if (!target || !("spawnCreep" in target)) {
    return;
  }

  const transferredEnergy = calculateTransferEnergy(energyContext, creep, target);
  const result = creep.transfer(target, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
    return;
  }
  if (result !== OK) {
    return;
  }

  reserveTransferEnergy(energyContext, target, transferredEnergy);
  recordTransferredEnergy(transferredEnergy);
  adjustRememberedCreepEnergy(creep, -transferredEnergy);
}
