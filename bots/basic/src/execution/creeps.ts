import type { ColonyPlan, ExecutionSummary } from "../core/types";
import { runHarvester } from "./roles/harvester";
import { runRecoveryWorker } from "./roles/recovery-worker";
import { runRunner } from "./roles/runner";
import { runUpgrader } from "./roles/upgrader";

export function executeCreepRoles(plan: ColonyPlan): ExecutionSummary {
  const harvestedEnergyBySourceId: Record<string, number> = {};

  for (const creep of Object.values(Game.creeps)) {
    const creepPlan = plan.creeps[creep.name];

    switch (creep.memory.role) {
      case "recovery-worker":
        runRecoveryWorker(creep);
        break;
      case "harvester": {
        const execution = runHarvester(creep, creepPlan);
        if (execution) {
          harvestedEnergyBySourceId[execution.sourceId] = (harvestedEnergyBySourceId[execution.sourceId] ?? 0) + execution.harvestedEnergy;
        }
        break;
      }
      case "runner":
        runRunner(creep);
        break;
      case "upgrader":
        runUpgrader(creep);
        break;
    }
  }

  return {
    harvestedEnergyBySourceId
  };
}
