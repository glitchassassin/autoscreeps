import type { TickResult } from "./types";
import { executeConstructionPlan } from "../execution/construction";
import { executeCreepRoles } from "../execution/creeps";
import { executeSpawnPlan } from "../execution/spawn";
import { createColonyPlan } from "../planning/colony-plan";
import { advanceRoomPlanning } from "../planning/room-planning-runtime";
import { cleanupDeadCreeps } from "../state/reconcile-creeps";
import type { CpuProfiler } from "../telemetry/cpu-profiler";
import { measureCpu } from "../telemetry/cpu-profiler";
import { observeWorld } from "../world/observe";

export function runTick(profiler?: CpuProfiler): TickResult {
  measureCpu(profiler, "cleanup", () => cleanupDeadCreeps());

  const world = measureCpu(profiler, "observe", () => observeWorld());
  const plan = measureCpu(profiler, "plan", () => createColonyPlan(world));

  measureCpu(profiler, "spawn", () => executeSpawnPlan(plan.spawn));
  measureCpu(profiler, "construction", () => executeConstructionPlan(plan.construction));
  const execution = measureCpu(profiler, "creeps", () => executeCreepRoles(plan));
  advanceRoomPlanning(world, profiler);

  return {
    world,
    plan,
    execution
  };
}
