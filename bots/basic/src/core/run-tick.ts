import type { TickResult } from "./types";
import { executeCreepRoles } from "../execution/creeps";
import { executeSpawnPlan } from "../execution/spawn";
import { createColonyPlan } from "../planning/colony-plan";
import { cleanupDeadCreeps } from "../state/reconcile-creeps";
import type { CpuProfiler } from "../telemetry/cpu-profiler";
import { measureCpu } from "../telemetry/cpu-profiler";
import { observeWorld } from "../world/observe";

export function runTick(profiler?: CpuProfiler): TickResult {
  measureCpu(profiler, "cleanup", () => cleanupDeadCreeps());

  const world = measureCpu(profiler, "observe", () => observeWorld());
  const plan = measureCpu(profiler, "plan", () => createColonyPlan(world));

  measureCpu(profiler, "spawn", () => executeSpawnPlan(plan.spawn));
  const execution = measureCpu(profiler, "creeps", () => executeCreepRoles(plan));

  return {
    world,
    plan,
    execution
  };
}
