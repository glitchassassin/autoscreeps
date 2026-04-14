let fallbackTelemetryState: TelemetryMemoryState | null = null;

export function ensureTelemetryState(): TelemetryMemoryState {
  if (typeof Memory === "undefined") {
    fallbackTelemetryState ??= createTelemetryState();
    return fallbackTelemetryState;
  }

  Memory.telemetry ??= createTelemetryState();
  Memory.telemetry.errors ??= [];
  return Memory.telemetry;
}

export function recordBotError(message: string): void {
  const state = ensureTelemetryState();
  state.errors ??= [];
  state.errors.push(message);
}

export function recordCreepDeath(count = 1): void {
  const state = ensureTelemetryState();
  state.creepDeaths += count;
}

function createTelemetryState(): TelemetryMemoryState {
  return {
    creepDeaths: 0,
    firstOwnedSpawnTick: null,
    rcl2Tick: null,
    rcl3Tick: null,
    errors: []
  };
}
