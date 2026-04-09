import { findClosestConstructionSiteMatching, findClosestEnergyDrop, isSourceAdjacentPosition, moveToTarget, pickupEnergyDrop, positionsAreNear, updateWorkingState } from "../creep-utils";
import { recordTelemetryAction, recordTelemetryTargetFailure, recordTelemetryTaskSelection } from "../telemetry-state";

const workerBuildRangeThreshold = 3;

export function runWorker(creep: Creep): void {
  if (isPreRcl3OwnedRoom(creep.room)) {
    runBootstrapWorker(creep);
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

function runBootstrapWorker(creep: Creep): void {
  updateWorkingState(creep);

  if (!creep.memory.working) {
    if (tryPickupNearbyHandoffEnergy(creep)) {
      return;
    }

    const handoffDrop = findClosestEnergyDrop(creep, (resource) => !isSourceAdjacentPosition(creep.room, resource.pos));
    if (handoffDrop) {
      pickupEnergyDrop(creep, handoffDrop);
      return;
    }

    const sourceDrop = findClosestEnergyDrop(creep, (resource) => isSourceAdjacentPosition(creep.room, resource.pos));
    if (sourceDrop) {
      pickupEnergyDrop(creep, sourceDrop);
      return;
    }

    recordTelemetryTargetFailure(creep, "no_energy_drop");
    return;
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
