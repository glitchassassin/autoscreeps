export function cleanupDeadCreeps(): void {
  Memory.creeps ??= {};

  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
    }
  }
}
