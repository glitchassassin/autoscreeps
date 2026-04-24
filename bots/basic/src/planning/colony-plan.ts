import type { ColonyPlan, WorldSnapshot } from "../core/types";
import { createConstructionPlan } from "./construction-plan";
import { determineColonyMode } from "./mode";
import { createCreepPlans, createSitePlans } from "./site-plan";
import { createSpawnPlan } from "./spawn-plan";

export function createColonyPlan(world: WorldSnapshot): ColonyPlan {
  const mode = determineColonyMode(world);
  const sites = createSitePlans(world);
  const construction = createConstructionPlan(world);

  return {
    mode,
    spawn: createSpawnPlan(world, mode, sites, construction),
    construction,
    sites,
    creeps: createCreepPlans(world, sites)
  };
}
