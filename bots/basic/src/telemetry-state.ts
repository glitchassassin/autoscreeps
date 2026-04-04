export function ensureTelemetryState(): TelemetryMemoryState {
  Memory.telemetry ??= {
    creepDeaths: 0,
    firstOwnedSpawnTick: null,
    rcl2Tick: null,
    rcl3Tick: null
  };

  return Memory.telemetry;
}

export function recordCreepDeath(count = 1): void {
  const state = ensureTelemetryState();
  state.creepDeaths += count;
}
