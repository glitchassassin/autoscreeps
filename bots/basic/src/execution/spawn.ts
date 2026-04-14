import type { SpawnPlan } from "../core/types";

export function executeSpawnPlan(plan: SpawnPlan): ScreepsReturnCode | null {
  const request = plan.request;
  if (request === null) {
    return null;
  }

  const spawn = Game.spawns[request.spawnName];
  if (!spawn || spawn.spawning) {
    return null;
  }

  return spawn.spawnCreep(request.body, request.name, { memory: request.memory });
}
