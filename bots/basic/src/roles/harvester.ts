import { harvestNearestSource, positionsAreNear } from "../creep-utils";

export function runHarvester(creep: Creep): void {
  creep.memory.working = false;
  harvestNearestSource(creep);

  const source = creep.memory.sourceId ? Game.getObjectById(creep.memory.sourceId) : null;
  if (!source || !positionsAreNear(creep.pos, source.pos)) {
    return;
  }

  if (creep.store[RESOURCE_ENERGY] === 0) {
    return;
  }

  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0 && source.energy > 0) {
    return;
  }

  creep.drop(RESOURCE_ENERGY);
}
