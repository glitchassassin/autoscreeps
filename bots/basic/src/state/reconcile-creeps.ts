import { recordCreepDeath } from "./telemetry";

export function cleanupDeadCreeps(): void {
  Memory.creeps ??= {};

  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      recordCreepDeath();
      delete Memory.creeps[name];
    }
  }
}
