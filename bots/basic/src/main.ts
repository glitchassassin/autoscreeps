import { cleanupDeadCreeps } from "./memory";
import { runWorker } from "./roles/worker";
import { runSpawnManager } from "./spawn";
import { recordBotError } from "./telemetry-state";
import { recordTelemetry } from "./telemetry";

export function runTick(): StructureSpawn | null {
  cleanupDeadCreeps();

  const primarySpawn = Object.values(Game.spawns)[0] ?? null;
  if (primarySpawn) {
    runSpawnManager(primarySpawn);
  }

  for (const creep of Object.values(Game.creeps)) {
    runWorker(creep);
  }

  return primarySpawn;
}

export const loop = (): void => {
  let primarySpawn: StructureSpawn | null = null;

  try {
    primarySpawn = runTick();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    recordBotError(message);
  }

  recordTelemetry(primarySpawn);
};
