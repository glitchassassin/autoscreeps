import { harvestNearestSource, moveToTarget, updateWorkingState } from "../creep-utils";
import { recordTelemetryAction, recordTelemetryTargetFailure } from "../telemetry-state";

export function runUpgrader(creep: Creep): void {
  updateWorkingState(creep);

  if (!creep.memory.working) {
    harvestNearestSource(creep);
    return;
  }

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
