import { countActiveBodyParts } from "../../core/body-parts";
import type { CreepPlan } from "../../core/types";

export type HarvesterExecution = {
  sourceId: string;
  harvestedEnergy: number;
};

export function runHarvester(creep: Creep, plan: CreepPlan | undefined): HarvesterExecution | null {
  if (!plan?.sourceId) {
    return null;
  }

  const source = resolveSource(plan.sourceId);
  if (!source) {
    return null;
  }

  const result = creep.harvest(source);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
    return null;
  }
  if (result !== OK) {
    return null;
  }

  return {
    sourceId: source.id,
    harvestedEnergy: Math.min(countActiveBodyParts(creep, WORK) * 2, source.energy)
  };
}

function resolveSource(sourceId: string): Source | null {
  if (typeof Game.getObjectById === "function") {
    return Game.getObjectById<Source>(sourceId) ?? null;
  }

  for (const room of Object.values(Game.rooms)) {
    const source = room.find(FIND_SOURCES).find((candidate) => candidate.id === sourceId);
    if (source) {
      return source;
    }
  }

  return null;
}
