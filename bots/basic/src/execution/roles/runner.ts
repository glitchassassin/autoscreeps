import { findDeliveryTarget, findPickupTarget } from "./energy";
import { updateWorkingState } from "./working-state";
import { moveToRunnerDeliveryTarget } from "../traffic";
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
  const target = findPickupTarget(creep);
  if (!target) {
    recordRunnerState("idleNoPickupTarget");
    return;
  }

  const pickedUpEnergy = calculatePickupEnergy(energyContext, creep, target);
  const result = creep.pickup(target);
  if (result === ERR_NOT_IN_RANGE) {
    recordRunnerState("movingToPickup");
    moveRunnerTo(creep, target, "pickup", "#ffaa00");
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
    moveRunnerTo(creep, target, "delivery", "#ffffff");
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

function moveRunnerTo(creep: Creep, target: RoomObject, kind: RunnerMovementKind, stroke: string): void {
  const result = kind === "delivery"
    ? moveToRunnerDeliveryTarget(creep, target, stroke)
    : creep.moveTo(target, { visualizePathStyle: { stroke } });
  if (result === ERR_NO_PATH) {
    recordRunnerMovementTick(kind, "failedToPath");
    return;
  }
  if (result === ERR_TIRED) {
    recordRunnerMovementTick(kind, "tired");
    return;
  }
  if (result !== OK) {
    return;
  }

  creep.memory.lastRunnerMove = {
    kind,
    x: creep.pos.x,
    y: creep.pos.y,
    roomName: creep.pos.roomName,
    tick: getGameTime()
  };
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
