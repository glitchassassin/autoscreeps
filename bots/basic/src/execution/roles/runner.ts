import { findDeliveryTarget, findPickupTargets, type EnergyPickupTarget } from "./energy";
import { updateWorkingState } from "./working-state";
import { moveToRunnerDeliveryTarget, moveToRunnerPickupTarget } from "../traffic";
import { calculatePickupEnergy, calculateTransferEnergy, createEnergyAccountingContext, reservePickupEnergy, reserveTransferEnergy, type EnergyAccountingContext } from "../energy-accounting";
import { adjustRememberedCreepEnergy, recordPickedUpEnergy, recordRunnerMovementTick, recordRunnerState, recordTransferredEnergy } from "../../state/telemetry";

export function runRunner(creep: Creep, energyContext: EnergyAccountingContext = createEnergyAccountingContext()): void {
  recordPreviousRunnerMoveOutcome(creep);
  updateWorkingState(creep);

  if (creep.memory.working) {
    deliverEnergy(creep, energyContext);
    return;
  }

  pickupEnergy(creep, energyContext);
}

function pickupEnergy(creep: Creep, energyContext: EnergyAccountingContext): void {
  const target = findReservablePickupTarget(creep, energyContext);
  if (!target) {
    recordRunnerState("idleNoPickupTarget");
    return;
  }

  const pickedUpEnergy = calculatePickupEnergy(energyContext, creep, target);
  if (pickedUpEnergy <= 0) {
    recordRunnerState("idleNoPickupTarget");
    return;
  }

  const result = creep.pickup(target);
  if (result === ERR_NOT_IN_RANGE) {
    recordRunnerState("movingToPickup");
    const moveResult = moveRunnerTo(creep, target, "pickup", "#ffaa00", energyContext);
    if (moveResult === OK || moveResult === ERR_TIRED) {
      reservePickupEnergy(energyContext, target, pickedUpEnergy);
    }
    return;
  }
  if (result !== OK) {
    recordRunnerState("pickupFailed");
    return;
  }

  recordRunnerState("pickupSucceeded");
  reservePickupEnergy(energyContext, target, pickedUpEnergy);
  recordPickedUpEnergy(pickedUpEnergy);
  adjustRememberedCreepEnergy(creep, pickedUpEnergy);
}

function deliverEnergy(creep: Creep, energyContext: EnergyAccountingContext): void {
  const target = findDeliveryTarget(creep);
  if (!target) {
    recordRunnerState("idleNoDeliveryTarget");
    return;
  }

  const transferredEnergy = calculateTransferEnergy(energyContext, creep, target);
  const result = creep.transfer(target, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) {
    recordRunnerState("movingToDelivery");
    moveRunnerTo(creep, target, "delivery", "#ffffff", energyContext);
    return;
  }
  if (result !== OK) {
    recordRunnerState("transferFailed");
    return;
  }

  recordRunnerState("transferSucceeded");
  reserveTransferEnergy(energyContext, target, transferredEnergy);
  recordTransferredEnergy(transferredEnergy);
  adjustRememberedCreepEnergy(creep, -transferredEnergy);
}

function moveRunnerTo(
  creep: Creep,
  target: RoomObject,
  kind: RunnerMovementKind,
  stroke: string,
  energyContext: EnergyAccountingContext
): ReturnType<Creep["moveTo"]> {
  const result = kind === "delivery"
    ? moveToRunnerDeliveryTarget(creep, target, stroke)
    : moveToRunnerPickupTarget(creep, target as EnergyPickupTarget, stroke, energyContext);
  if (result === ERR_NO_PATH) {
    recordRunnerMovementTick(kind, "failedToPath");
    return result;
  }
  if (result === ERR_TIRED) {
    recordRunnerMovementTick(kind, "tired");
    return result;
  }
  if (result !== OK) {
    return result;
  }

  creep.memory.lastRunnerMove = {
    kind,
    x: creep.pos.x,
    y: creep.pos.y,
    roomName: creep.pos.roomName,
    tick: getGameTime()
  };
  return result;
}

function recordPreviousRunnerMoveOutcome(creep: Creep): void {
  const previousMove = creep.memory.lastRunnerMove;
  if (!previousMove) {
    return;
  }

  delete creep.memory.lastRunnerMove;
  if (previousMove.tick !== getGameTime() - 1) {
    return;
  }
  if (creep.pos.roomName !== previousMove.roomName) {
    return;
  }
  if (creep.pos.x !== previousMove.x || creep.pos.y !== previousMove.y) {
    return;
  }

  recordRunnerMovementTick(previousMove.kind, "stuck");
}

function getGameTime(): number {
  return typeof Game === "undefined" ? 0 : Game.time;
}

function findReservablePickupTarget(creep: Creep, energyContext: EnergyAccountingContext): EnergyPickupTarget | null {
  const targets = findPickupTargets(creep).filter((target) => calculatePickupEnergy(energyContext, creep, target) > 0);
  if (targets.length === 0) {
    return null;
  }

  return creep.pos.findClosestByPath(targets) ?? targets.toSorted(comparePickupTargets)[0] ?? null;
}

function comparePickupTargets(left: EnergyPickupTarget, right: EnergyPickupTarget): number {
  return right.amount - left.amount
    || left.pos.roomName.localeCompare(right.pos.roomName)
    || left.pos.y - right.pos.y
    || left.pos.x - right.pos.x;
}
