import { findClosestConstructionSiteMatching, findClosestEnergyDrop, harvestNearestSource, isSourceAdjacentPosition, moveToTarget, pickupEnergyDrop, positionsAreNear, updateWorkingState } from "../creep-utils";
import { summarizeSpawnDemandForRoom } from "../spawn";
import { recordTelemetryAction, recordTelemetryTargetFailure, recordTelemetryTaskSelection } from "../telemetry-state";

const workerBuildRangeThreshold = 3;
type EnergyFeedTarget = StructureSpawn | StructureExtension;

export function runWorker(creep: Creep): void {
  if (isPreRcl3OwnedRoom(creep.room)) {
    runDirectSpendWorker(creep);
    return;
  }

  updateWorkingState(creep);

  if (creep.memory.working && tryPickupNearbyHandoffEnergy(creep)) {
    return;
  }

  if (!creep.memory.working) {
    const handoffDrop = findClosestEnergyDrop(creep, (resource) => !isSourceAdjacentPosition(creep.room, resource.pos));
    if (handoffDrop) {
      pickupEnergyDrop(creep, handoffDrop);
      return;
    }

    const sourceDrop = findClosestEnergyDrop(creep, (resource) => isSourceAdjacentPosition(creep.room, resource.pos));
    if (!sourceDrop) {
      recordTelemetryTargetFailure(creep, "no_source_drop");
      return;
    }

    pickupEnergyDrop(creep, sourceDrop);
    return;
  }

  if (!isPreRcl3OwnedRoom(creep.room)) {
    const constructionSite = findNearbyBuildTarget(creep);
    if (constructionSite) {
      recordTelemetryTaskSelection(creep.memory.role, "build");
      const result = creep.build(constructionSite);
      recordTelemetryAction(creep, "build", result, {
        targetType: constructionSite.structureType,
        targetKey: constructionSite.id
      });
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(creep, constructionSite);
      }
      if (result !== ERR_INVALID_TARGET) {
        return;
      }
    }
  }

  const controller = creep.room.controller;
  if (!controller) {
    recordTelemetryTargetFailure(creep, "no_controller");
    return;
  }

  recordTelemetryTaskSelection(creep.memory.role, "upgrade");
  const result = creep.upgradeController(controller);
  recordTelemetryAction(creep, "upgrade", result, {
    targetType: "controller",
    targetKey: controller.id
  });
  if (result === ERR_NOT_IN_RANGE) {
    moveToTarget(creep, controller);
  }
}

function tryPickupNearbyHandoffEnergy(creep: Creep): boolean {
  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
    return false;
  }

  const nearbyDrop = findClosestEnergyDrop(
    creep,
    (resource) => !isSourceAdjacentPosition(creep.room, resource.pos) && positionsAreNear(creep.pos, resource.pos)
  );

  if (!nearbyDrop) {
    return false;
  }

  pickupEnergyDrop(creep, nearbyDrop);
  return true;
}

function runDirectSpendWorker(creep: Creep): void {
  updateWorkingState(creep);

  if (!creep.memory.working) {
    harvestNearestSource(creep);
    return;
  }

  if (shouldPrioritizeSpawnFeed(creep.room)) {
    const energyTarget = findQueueAwareEnergyTarget(creep);
    if (energyTarget) {
      recordTelemetryTaskSelection(creep.memory.role, "feed");
      const result = creep.transfer(energyTarget, RESOURCE_ENERGY);
      recordTelemetryAction(creep, "transfer", result, {
        targetType: energyTarget.structureType,
        targetKey: energyTarget.id
      });
      if (result === ERR_NOT_IN_RANGE) {
        moveToTarget(creep, energyTarget);
      }
      if (result === OK || result === ERR_NOT_IN_RANGE) {
        return;
      }
    }
  }

  const controller = creep.room.controller;
  if (!controller) {
    recordTelemetryTargetFailure(creep, "no_controller");
    return;
  }

  recordTelemetryTaskSelection(creep.memory.role, "upgrade");
  const result = creep.upgradeController(controller);
  recordTelemetryAction(creep, "upgrade", result, {
    targetType: "controller",
    targetKey: controller.id
  });
  if (result === ERR_NOT_IN_RANGE) {
    moveToTarget(creep, controller);
  }
}

function findNearbyBuildTarget(creep: Creep): ConstructionSite | null {
  const constructionSite = findClosestConstructionSiteMatching(
    creep,
    (site) => site.structureType === STRUCTURE_SPAWN || site.structureType === STRUCTURE_EXTENSION
  );
  if (!constructionSite) {
    return null;
  }

  return positionRange(creep.pos, constructionSite.pos) <= workerBuildRangeThreshold ? constructionSite : null;
}

function positionRange(left: RoomPosition, right: RoomPosition): number {
  if (left.roomName !== right.roomName) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function isPreRcl3OwnedRoom(room: Room): boolean {
  return Boolean(room.controller?.my && room.controller.level < 3);
}

function shouldPrioritizeSpawnFeed(room: Room): boolean {
  return summarizeSpawnDemandForRoom(room).totalUnmetDemand > 0;
}

function findQueueAwareEnergyTarget(creep: Creep): EnergyFeedTarget | null {
  const structures = creep.room.find(FIND_MY_STRUCTURES, {
    filter: (structure): structure is EnergyFeedTarget => {
      if (structure.structureType !== STRUCTURE_SPAWN && structure.structureType !== STRUCTURE_EXTENSION) {
        return false;
      }

      return structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    }
  });

  return creep.pos.findClosestByPath(structures);
}
