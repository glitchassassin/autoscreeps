import type { ColonyMode, WorldSnapshot } from "../core/types";

export function determineColonyMode(world: WorldSnapshot): ColonyMode {
  if (world.primarySpawnName === null) {
    return "bootstrap";
  }

  if (world.creepsByRole.harvester === 0 || world.creepsByRole.runner === 0) {
    return "recovery";
  }

  return "normal";
}
