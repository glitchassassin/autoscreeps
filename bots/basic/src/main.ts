import { ensureBootstrapInfrastructure } from "./bootstrap";
import { cleanupDeadCreeps } from "./memory";
import { runCourier } from "./roles/courier";
import { runHarvester } from "./roles/harvester";
import { runWorker } from "./roles/worker";
import { runSpawnManager } from "./spawn";
import { recordTelemetry } from "./telemetry";

const roleHandlers: Record<WorkerRole, (creep: Creep) => void> = {
  harvester: runHarvester,
  courier: runCourier,
  worker: runWorker
};

export function runTick(): void {
  cleanupDeadCreeps();
  ensureBootstrapInfrastructure();

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
