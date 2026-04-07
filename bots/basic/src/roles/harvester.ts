import { harvestNearestSource, moveToTarget, positionsAreNear, updateWorkingState } from "../creep-utils";
import { recordTelemetryAction, recordTelemetryTargetFailure } from "../telemetry-state";

type EnergyTarget = StructureSpawn | StructureExtension | StructureTower;

export function runHarvester(creep: Creep): void {
  if (isPreRcl3OwnedRoom(creep.room)) {
    runDirectSupplyHarvester(creep);
    return;
  }

  creep.memory.working = false;
  harvestNearestSource(creep);

  const source = creep.memory.sourceId ? Game.getObjectById(creep.memory.sourceId) : null;
  if (!source || !positionsAreNear(creep.pos, source.pos)) {
    return;
  }

  if (creep.store[RESOURCE_ENERGY] === 0) {
    return;
  }

  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && source.energy > 0) {
    return;
  }

  creep.drop(RESOURCE_ENERGY);
}

function runDirectSupplyHarvester(creep: Creep): void {
  updateWorkingState(creep);

  if (!creep.memory.working) {
    harvestNearestSource(creep);
    return;
  }

  const energyTarget = findEnergyTarget(creep);
  if (energyTarget) {
    const result = creep.transfer(energyTarget, RESOURCE_ENERGY);
    recordTelemetryAction(creep, "transfer", result, {
      targetType: energyTarget.structureType,
      targetKey: energyTarget.id
    });
    if (result === ERR_NOT_IN_RANGE) {
      moveToTarget(creep, energyTarget);
    }
    return;
  }

  recordTelemetryTargetFailure(creep, "no_energy_target");

  const controller = creep.room.controller;
  if (!controller) {
    recordTelemetryTargetFailure(creep, "no_controller");
    return;
  }

  const result = creep.upgradeController(controller);
  recordTelemetryAction(creep, "upgrade", result, {
    targetType: "controller",
    targetKey: controller.id
  });
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

function isPreRcl3OwnedRoom(room: Room): boolean {
  return Boolean(room.controller?.my && room.controller.level < 3);
}
