import { ensureBootstrapSpawn } from "./bootstrap";
import { cleanupDeadCreeps } from "./memory";
import { runHarvester } from "./roles/harvester";
import { runUpgrader } from "./roles/upgrader";
import { runSpawnManager } from "./spawn";
import { recordTelemetry } from "./telemetry";

const roleHandlers: Record<WorkerRole, (creep: Creep) => void> = {
  harvester: runHarvester,
  upgrader: runUpgrader
};

export function runTick(): void {
  cleanupDeadCreeps();
  ensureBootstrapSpawn();

  const firstSpawn = Object.values(Game.spawns)[0];
  if (firstSpawn) {
    runSpawnManager(firstSpawn);
  }

  for (const creep of Object.values(Game.creeps)) {
    const handler = roleHandlers[creep.memory.role];
    if (handler) {
      handler(creep);
    }
  }

  recordTelemetry(firstSpawn ?? null);
}

export const loop = (): void => {
  runTick();
};
