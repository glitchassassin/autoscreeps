import { harvestNearestSource, moveToTarget, updateWorkingState } from "../creep-utils";

type EnergyTarget = StructureSpawn | StructureExtension | StructureTower;

export function runHarvester(creep: Creep): void {
  updateWorkingState(creep);

  if (!creep.memory.working) {
    harvestNearestSource(creep);
    return;
  }

  const energyTarget = findEnergyTarget(creep);
  if (energyTarget) {
    const result = creep.transfer(energyTarget, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      moveToTarget(creep, energyTarget);
    }
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

function findEnergyTarget(creep: Creep): EnergyTarget | null {
  const structures = creep.room.find(FIND_MY_STRUCTURES, {
    filter: (structure): structure is EnergyTarget => {
      if (
        structure.structureType !== STRUCTURE_SPAWN &&
        structure.structureType !== STRUCTURE_EXTENSION &&
        structure.structureType !== STRUCTURE_TOWER
      ) {
        return false;
      }

      return structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    }
  });

  return creep.pos.findClosestByPath(structures);
}
