import type { ColonyPlan, WorldSnapshot } from "../core/types";
import { createSpawnPlan } from "./spawn-plan";

export function createColonyPlan(world: WorldSnapshot): ColonyPlan {
  return {
    spawn: createSpawnPlan(world)
  };
}
