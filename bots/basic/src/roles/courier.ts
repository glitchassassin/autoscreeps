import { findClosestConstructionSite, findClosestEnergyDrop, isSourceAdjacentPosition, moveToTarget, pickupEnergyDrop, positionsAreNear, updateWorkingState } from "../creep-utils";
import { inspectSpawnBankPressure } from "../spawn";
import { recordQueueHeadReserveHold, recordTelemetryAction, recordTelemetryTargetFailure } from "../telemetry-state";

type RefillTarget = StructureSpawn | StructureExtension;
type HandoffTarget = { pos: RoomPosition; targetKey: string };

export function runCourier(creep: Creep): void {
  updateWorkingState(creep);

  if (!creep.memory.working) {
    const sourceDrop = findClosestEnergyDrop(creep, (resource) => isSourceAdjacentPosition(creep.room, resource.pos));
    if (!sourceDrop) {
      recordTelemetryTargetFailure(creep, "no_source_drop");
      return;
    }

    pickupEnergyDrop(creep, sourceDrop);
    return;
  }

  const refillTarget = findRefillTarget(creep);
  if (refillTarget) {
    const result = creep.transfer(refillTarget, RESOURCE_ENERGY);
    recordTelemetryAction(creep, "transfer", result, {
      targetType: refillTarget.structureType,
      targetKey: refillTarget.id
    });
    if (result === ERR_NOT_IN_RANGE) {
      moveToTarget(creep, refillTarget);
    }
    return;
  }

  const bankReserveTarget = findBankReserveTarget(creep);
  if (bankReserveTarget) {
    recordQueueHeadReserveHold(creep);
    if (!positionsAreNear(creep.pos, bankReserveTarget.pos)) {
      moveToTarget(creep, bankReserveTarget);
    }
    return;
  }

  const handoffTarget = findHandoffTarget(creep);
  if (!handoffTarget) {
    recordTelemetryTargetFailure(creep, "no_refill_target");
    return;
  }

  if (!positionsAreNear(creep.pos, handoffTarget.pos)) {
    recordTelemetryAction(creep, "transfer", ERR_NOT_IN_RANGE, {
      targetType: "worker_handoff",
      targetKey: handoffTarget.targetKey
    });
    moveToTarget(creep, handoffTarget);
    return;
  }

  const result = creep.drop(RESOURCE_ENERGY);
  recordTelemetryAction(creep, "transfer", result, {
    targetType: "worker_handoff",
    targetKey: handoffTarget.targetKey
  });
}

function findRefillTarget(creep: Creep): RefillTarget | null {
  const targets = creep.room.find(FIND_MY_STRUCTURES, {
    filter: (structure): structure is RefillTarget => {
      if (structure.structureType !== STRUCTURE_SPAWN && structure.structureType !== STRUCTURE_EXTENSION) {
        return false;
      }

      return structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    }
  });

  return creep.pos.findClosestByPath(targets);
}

function findBankReserveTarget(creep: Creep): StructureSpawn | null {
  const spawns = creep.room.find(FIND_MY_SPAWNS);
  const spawn = creep.pos.findClosestByPath(spawns);
  if (!spawn) {
    return null;
  }

  return shouldHoldCourierForQueueHeadReserve(creep, spawn) ? spawn : null;
}

function shouldHoldCourierForQueueHeadReserve(creep: Creep, spawn: StructureSpawn): boolean {
  if (!isPreRcl3OwnedRoom(creep.room)) {
    return false;
  }

  const admissions = Memory.telemetry?.spawnAdmissions;
  if (!admissions?.firstCourier3 || admissions.firstWorker4) {
    return false;
  }

  const pressure = inspectSpawnBankPressure(creep.room);
  return pressure.totalUnmetDemand > 0
    && pressure.queueHeadCost !== null
    && creep.room.energyAvailable >= pressure.queueHeadCost
    && countOtherSpawnAdjacentLoadedCourierEnergy(creep, spawn) < pressure.queueHeadCost;
}

function countOtherSpawnAdjacentLoadedCourierEnergy(creep: Creep, spawn: StructureSpawn): number {
  let total = 0;

  for (const candidate of Object.values(Game.creeps)) {
    if (
      candidate.name === creep.name
      || candidate.memory.homeRoom !== creep.memory.homeRoom
      || candidate.memory.role !== "courier"
      || !candidate.memory.working
      || getStoredEnergy(candidate) <= 0
      || !positionsAreNear(candidate.pos, spawn.pos)
    ) {
      continue;
    }

    total += getStoredEnergy(candidate);
  }

  return total;
}

function findHandoffTarget(creep: Creep): HandoffTarget | null {
  const workers = Object.values(Game.creeps).filter(
    (candidate) => candidate.memory.homeRoom === creep.memory.homeRoom && candidate.memory.role === "worker"
  );

  for (const candidates of [
    workers.filter((worker) => worker.memory.working && worker.store.getFreeCapacity(RESOURCE_ENERGY) > 0),
    workers.filter((worker) => worker.memory.working),
    workers.filter((worker) => worker.store.getFreeCapacity(RESOURCE_ENERGY) > 0),
    workers
  ]) {
    const worker = creep.pos.findClosestByPath(candidates);
    if (worker) {
      return {
        pos: worker.pos,
        targetKey: `${worker.pos.roomName}:${worker.pos.x},${worker.pos.y}`
      };
    }
  }

  const constructionSite = findClosestConstructionSite(creep);
  if (constructionSite) {
    return {
      pos: constructionSite.pos,
      targetKey: constructionSite.id
    };
  }

  const controller = creep.room.controller;
  if (!controller) {
    return null;
  }

  return {
    pos: controller.pos,
    targetKey: controller.id
  };
}

function isPreRcl3OwnedRoom(room: Room): boolean {
  return Boolean(room.controller?.my && room.controller.level < 3);
}

function getStoredEnergy(creep: Creep): number {
  return typeof creep.store?.[RESOURCE_ENERGY] === "number" ? creep.store[RESOURCE_ENERGY] : 0;
}
