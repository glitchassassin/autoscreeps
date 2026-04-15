import type { TickResult } from "./types";
import { executeCreepRoles } from "../execution/creeps";
import { executeSpawnPlan } from "../execution/spawn";
import { createColonyPlan } from "../planning/colony-plan";
import { cleanupDeadCreeps } from "../state/reconcile-creeps";
import { observeWorld } from "../world/observe";

export function runTick(): TickResult {
  cleanupDeadCreeps();

  const world = observeWorld();
  const plan = createColonyPlan(world);

  executeSpawnPlan(plan.spawn);
  const execution = executeCreepRoles(plan);

  return {
    world,
    plan,
    execution
  };
}
