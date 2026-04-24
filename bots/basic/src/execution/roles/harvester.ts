import type { CreepPlan } from "../../core/types";
import { calculateDroppedHarvestEnergy, calculateHarvestedEnergy, createEnergyAccountingContext, reserveHarvestedEnergy, type EnergyAccountingContext } from "../energy-accounting";
import { adjustRememberedCreepEnergy, recordDroppedEnergy, recordHarvestedEnergy } from "../../state/telemetry";
import { createRoomPositionFromSnapshot } from "../../world/source-slots";

export type HarvesterExecution = {
  sourceId: string;
  harvestedEnergy: number;
};

export function runHarvester(
  creep: Creep,
  plan: CreepPlan | undefined,
  energyContext: EnergyAccountingContext = createEnergyAccountingContext()
): HarvesterExecution | null {
  if (!plan?.sourceId) {
    return null;
  }

  const source = resolveSource(plan.sourceId);
  if (!source) {
    return null;
  }

  if (plan.sourceSlot) {
    const slot = createRoomPositionFromSnapshot(plan.sourceSlot);
    if (!creep.pos.isEqualTo(slot)) {
      creep.moveTo(slot, { range: 0, visualizePathStyle: { stroke: "#ffaa00" } });
      return null;
    }
  }

  const result = creep.harvest(source);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
    return null;
  }
  if (result !== OK) {
    return null;
  }

  const harvestedEnergy = calculateHarvestedEnergy(energyContext, creep, source);
  const droppedEnergy = calculateDroppedHarvestEnergy(creep, harvestedEnergy);
  reserveHarvestedEnergy(energyContext, source, harvestedEnergy);
  recordHarvestedEnergy(source.id, harvestedEnergy);
  recordDroppedEnergy(droppedEnergy);
  adjustRememberedCreepEnergy(creep, harvestedEnergy - droppedEnergy);

  return {
    sourceId: source.id,
    harvestedEnergy
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
