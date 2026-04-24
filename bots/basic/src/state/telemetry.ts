let fallbackTelemetryState: TelemetryMemoryState | null = null;

export function ensureTelemetryState(): TelemetryMemoryState {
  if (typeof Memory === "undefined") {
    fallbackTelemetryState ??= createTelemetryState();
    ensureEnergyLedgerState(fallbackTelemetryState);
    ensureRunnerStateTicksState(fallbackTelemetryState);
    ensureRunnerMovementState(fallbackTelemetryState);
    return fallbackTelemetryState;
  }

  Memory.telemetry ??= createTelemetryState();
  Memory.telemetry.errors ??= [];
  ensureEnergyLedgerState(Memory.telemetry);
  ensureRunnerStateTicksState(Memory.telemetry);
  ensureRunnerMovementState(Memory.telemetry);
  return Memory.telemetry;
}

export function recordBotError(message: string): void {
  const state = ensureTelemetryState();
  state.errors ??= [];
  state.errors.push(message);
}

export function recordCreepDeath(count = 1, carriedEnergy = 0): void {
  const state = ensureTelemetryState();
  const ledger = ensureEnergyLedgerState(state);
  state.creepDeaths += count;
  ledger.lostOnCreepDeath += carriedEnergy;
}

export function recordHarvestedEnergy(sourceId: string, amount: number): void {
  if (amount <= 0) {
    return;
  }

  const ledger = ensureEnergyLedgerState(ensureTelemetryState());
  ledger.harvested += amount;
  ledger.harvestedBySourceId[sourceId] = (ledger.harvestedBySourceId[sourceId] ?? 0) + amount;
}

export function recordDroppedEnergy(amount: number): void {
  recordEnergyLedgerAmount("dropped", amount);
}

export function recordPickedUpEnergy(amount: number): void {
  recordEnergyLedgerAmount("pickedUp", amount);
}

export function recordWithdrawnEnergy(amount: number): void {
  recordEnergyLedgerAmount("withdrawn", amount);
}

export function recordTransferredEnergy(amount: number): void {
  recordEnergyLedgerAmount("transferred", amount);
}

export function recordSpawnedBodyCost(amount: number): void {
  recordEnergyLedgerAmount("spawnedBodyCost", amount);
}

export function recordUpgradedEnergy(amount: number): void {
  recordEnergyLedgerAmount("upgraded", amount);
}

export function recordBuiltEnergy(amount: number): void {
  recordEnergyLedgerAmount("built", amount);
}

export function recordRunnerState(state: keyof RunnerStateTicksMemoryState): void {
  const ticks = ensureRunnerStateTicksState(ensureTelemetryState());
  ticks[state] += 1;
}

export function recordRunnerMovementTick(kind: RunnerMovementKind, state: keyof RunnerMovementTicksMemoryState): void {
  const movement = ensureRunnerMovementState(ensureTelemetryState());
  movement[kind][state] += 1;
  movement.total[state] += 1;
}

export function rememberLiveCreepEnergy(): void {
  if (typeof Game === "undefined") {
    return;
  }

  for (const creep of Object.values(Game.creeps)) {
    rememberCreepEnergy(creep);
  }
}

export function rememberCreepEnergy(creep: Creep): void {
  creep.memory.lastEnergy = getCreepEnergy(creep);
}

export function adjustRememberedCreepEnergy(creep: Creep, delta: number): void {
  const current = creep.memory.lastEnergy ?? getCreepEnergy(creep);
  creep.memory.lastEnergy = Math.max(0, current + delta);
}

function createTelemetryState(): TelemetryMemoryState {
  return {
    creepDeaths: 0,
    energy: createEnergyLedgerState(),
    runnerStateTicks: createRunnerStateTicksState(),
    runnerMovement: createRunnerMovementState(),
    firstOwnedSpawnTick: null,
    rcl2Tick: null,
    rcl3Tick: null,
    errors: []
  };
}

export function createEnergyLedgerState(): EnergyLedgerMemoryState {
  return {
    harvested: 0,
    harvestedBySourceId: {},
    dropped: 0,
    pickedUp: 0,
    withdrawn: 0,
    transferred: 0,
    spawnedBodyCost: 0,
    upgraded: 0,
    built: 0,
    lostOnCreepDeath: 0
  };
}

export function createRunnerStateTicksState(): RunnerStateTicksMemoryState {
  return {
    idleNoPickupTarget: 0,
    movingToPickup: 0,
    pickupSucceeded: 0,
    pickupFailed: 0,
    idleNoDeliveryTarget: 0,
    movingToDelivery: 0,
    transferSucceeded: 0,
    transferFailed: 0
  };
}

export function createRunnerMovementState(): RunnerMovementMemoryState {
  return {
    pickup: createRunnerMovementTicksState(),
    delivery: createRunnerMovementTicksState(),
    total: createRunnerMovementTicksState()
  };
}

function createRunnerMovementTicksState(): RunnerMovementTicksMemoryState {
  return {
    failedToPath: 0,
    tired: 0,
    stuck: 0
  };
}

export function ensureEnergyLedgerState(state: TelemetryMemoryState): EnergyLedgerMemoryState {
  state.energy ??= createEnergyLedgerState();
  state.energy.harvested ??= 0;
  state.energy.harvestedBySourceId ??= {};
  state.energy.dropped ??= 0;
  state.energy.pickedUp ??= 0;
  state.energy.withdrawn ??= 0;
  state.energy.transferred ??= 0;
  state.energy.spawnedBodyCost ??= 0;
  state.energy.upgraded ??= 0;
  state.energy.built ??= 0;
  state.energy.lostOnCreepDeath ??= 0;
  return state.energy;
}

export function ensureRunnerStateTicksState(state: TelemetryMemoryState): RunnerStateTicksMemoryState {
  state.runnerStateTicks ??= createRunnerStateTicksState();
  state.runnerStateTicks.idleNoPickupTarget ??= 0;
  state.runnerStateTicks.movingToPickup ??= 0;
  state.runnerStateTicks.pickupSucceeded ??= 0;
  state.runnerStateTicks.pickupFailed ??= 0;
  state.runnerStateTicks.idleNoDeliveryTarget ??= 0;
  state.runnerStateTicks.movingToDelivery ??= 0;
  state.runnerStateTicks.transferSucceeded ??= 0;
  state.runnerStateTicks.transferFailed ??= 0;
  return state.runnerStateTicks;
}

export function ensureRunnerMovementState(state: TelemetryMemoryState): RunnerMovementMemoryState {
  state.runnerMovement ??= createRunnerMovementState();
  state.runnerMovement.pickup ??= createRunnerMovementTicksState();
  state.runnerMovement.delivery ??= createRunnerMovementTicksState();
  state.runnerMovement.total ??= createRunnerMovementTicksState();
  ensureRunnerMovementTicksState(state.runnerMovement.pickup);
  ensureRunnerMovementTicksState(state.runnerMovement.delivery);
  ensureRunnerMovementTicksState(state.runnerMovement.total);
  return state.runnerMovement;
}

function ensureRunnerMovementTicksState(state: RunnerMovementTicksMemoryState): void {
  state.failedToPath ??= 0;
  state.tired ??= 0;
  state.stuck ??= 0;
}

function recordEnergyLedgerAmount(field: Exclude<keyof EnergyLedgerMemoryState, "harvestedBySourceId">, amount: number): void {
  if (amount <= 0) {
    return;
  }

  const ledger = ensureEnergyLedgerState(ensureTelemetryState());
  ledger[field] += amount;
}

function getCreepEnergy(creep: Creep): number {
  return creep.store?.[RESOURCE_ENERGY] ?? 0;
}
