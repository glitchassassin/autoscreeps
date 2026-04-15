import type { ColonyPlan, WorldSnapshot } from "../core/types";
import { determineColonyMode } from "./mode";
import { createCreepPlans, createSitePlans } from "./site-plan";
import { createSpawnPlan } from "./spawn-plan";

export function createColonyPlan(world: WorldSnapshot): ColonyPlan {
  const mode = determineColonyMode(world);
  const sites = createSitePlans(world);

  return {
    mode,
    spawn: createSpawnPlan(world, mode, sites),
    sites,
    creeps: createCreepPlans(world, sites)
  };
}
