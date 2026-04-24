import type { ColonyPlan, ExecutionSummary } from "../core/types";
import { runBuilder } from "./roles/builder";
import { runHarvester } from "./roles/harvester";
import { runRecoveryWorker } from "./roles/recovery-worker";
import { runRunner } from "./roles/runner";
import { runUpgrader } from "./roles/upgrader";
import { createEnergyAccountingContext } from "./energy-accounting";

export function executeCreepRoles(plan: ColonyPlan): ExecutionSummary {
  const harvestedEnergyBySourceId: Record<string, number> = {};
  const energyContext = createEnergyAccountingContext();

  for (const creep of Object.values(Game.creeps)) {
    const creepPlan = plan.creeps[creep.name];

    switch (creep.memory.role) {
      case "builder":
        runBuilder(creep, energyContext);
        break;
      case "recovery-worker":
        runRecoveryWorker(creep, energyContext);
        break;
      case "harvester": {
        const execution = runHarvester(creep, creepPlan, energyContext);
        if (execution) {
          harvestedEnergyBySourceId[execution.sourceId] = (harvestedEnergyBySourceId[execution.sourceId] ?? 0) + execution.harvestedEnergy;
        }
        break;
      }
      case "runner":
        runRunner(creep, energyContext);
        break;
      case "upgrader":
        runUpgrader(creep, energyContext);
        break;
    }
  }

  return {
    harvestedEnergyBySourceId
  };
}
