import { runWorker } from "./roles/worker";

export function executeCreepRoles(): void {
  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.role === "worker") {
      runWorker(creep);
    }
  }
}
