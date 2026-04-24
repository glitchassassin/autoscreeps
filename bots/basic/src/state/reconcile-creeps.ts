import { recordCreepDeath } from "./telemetry";

export function cleanupDeadCreeps(): void {
  Memory.creeps ??= {};

  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      recordCreepDeath(1, Memory.creeps[name].lastEnergy ?? 0);
      delete Memory.creeps[name];
    }
  }
}
