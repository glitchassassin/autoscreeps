import { inspectPreRcl3ExtraWorkerGate, inspectSpawnBankPressure, type ExtraWorkerGateState } from "./spawn";

let fallbackTelemetryState: TelemetryMemoryState | null = null;

export function ensureTelemetryState(): TelemetryMemoryState {
  if (typeof Memory === "undefined") {
    fallbackTelemetryState ??= {
      creepDeaths: 0,
      firstOwnedSpawnTick: null,
      rcl2Tick: null,
      debugError: null,
      rcl3Tick: null,
      loop: createLoopState(),
      bank: createBankState(),
      spawnAdmissions: createSpawnAdmissionsState(),
      creeps: {},
      drops: {},
      sources: {}
    };

    return fallbackTelemetryState;
  }

  Memory.telemetry ??= {
    creepDeaths: 0,
    firstOwnedSpawnTick: null,
    rcl2Tick: null,
    debugError: null,
    rcl3Tick: null,
    loop: createLoopState(),
    bank: createBankState(),
    spawnAdmissions: createSpawnAdmissionsState(),
    creeps: {},
    drops: {},
    sources: {}
  };

  Memory.telemetry.loop ??= createLoopState();
  Memory.telemetry.bank ??= createBankState();
  Memory.telemetry.spawnAdmissions ??= createSpawnAdmissionsState();
  Memory.telemetry.debugError ??= null;
  Memory.telemetry.creeps ??= {};
  Memory.telemetry.drops ??= {};
  Memory.telemetry.sources ??= {};
  normalizeLoopState(Memory.telemetry.loop);
  normalizeBankState(Memory.telemetry.bank);
  normalizeSpawnAdmissionsState(Memory.telemetry.spawnAdmissions);

  for (const sourceState of Object.values(Memory.telemetry.sources)) {
    sourceState.successfulHarvestTicks ??= 0;
    sourceState.harvestedEnergy ??= 0;
  }

  return Memory.telemetry;
}

export function recordCreepDeath(count = 1): void {
  const state = ensureTelemetryState();
  state.creepDeaths += count;
}

type ObservedTelemetryCreepState = TelemetryCreepRuntimeState & {
  pendingAction?: TelemetryCreepActionState;
};

export function recordTelemetryAction(
  creep: Creep,
  action: TelemetryActionName,
  result: ScreepsReturnCode,
  options: {
    targetType?: string;
    targetKey?: string;
    sourceId?: string;
    dropId?: string;
  } = {}
): void {
  const state = ensureTelemetryState();
  const loop = state.loop!;
  const creepState = ensureCreepRuntimeState(resolveCreepName(creep), creep, state);
  const role = creep.memory.role;

  increment(loop.actionAttempts, `${role}.${action}`);
  updateTargetSelection(creepState, loop, role, options.targetKey ?? null);

  if (result === OK) {
    increment(loop.actionSuccesses, `${role}.${action}`);
    creepState.lastSuccessfulActionTick = Game.time;
    creepState.lastSuccessfulAction = action;

    if (action === "transfer" && options.targetType) {
      increment(loop.transferSuccessByTargetType, options.targetType);
    }

    if (action === "harvest" && options.sourceId) {
      const sourceState = ensureSourceRuntimeState(options.sourceId, state);
      sourceState.successfulHarvestTicks += 1;
    }

    if (action === "pickup") {
      creepState.lastPickupTick = Game.time;
      creepState.lastBankPickupTick ??= Game.time;
      if (options.dropId) {
        const dropState = state.drops?.[options.dropId];
        if (dropState && !dropState.pickupLatencyRecorded) {
          loop.sourceDropPickupLatencyTotal += Game.time - dropState.firstSeenTick;
          loop.sourceDropPickupLatencySamples += 1;
          dropState.pickupLatencyRecorded = true;
        }
        if (dropState) {
          creepState.lastSourcePickupTick ??= Game.time;
          creepState.lastSourceDropFirstSeenTick ??= dropState.firstSeenTick;
        }
      }
    }

    if ((action === "build" || action === "upgrade") && creepState.lastPickupTick !== null) {
      loop.pickupToSpendLatencyTotal += Game.time - creepState.lastPickupTick;
      loop.pickupToSpendLatencySamples += 1;
      creepState.lastPickupTick = null;
      creepState.lastBankPickupTick = null;
      creepState.lastSourcePickupTick = null;
      creepState.lastSourceDropFirstSeenTick = null;
    }
  } else {
    increment(loop.actionFailures, `${role}.${action}.${result}`);
  }

  creepState.currentAction = {
    action,
    result,
    targetType: options.targetType,
    targetKey: options.targetKey,
    sourceId: options.sourceId,
    dropId: options.dropId
  };
}

export function recordTelemetryTargetFailure(creep: Creep, reason: string): void {
  const state = ensureTelemetryState();
  const loop = state.loop!;
  const role = creep.memory.role;

  increment(loop.targetFailures, `${role}.${reason}`);

  if (reason.startsWith("no_")) {
    increment(loop.noTargetTicks, role);
  }
  if (reason === "no_source" || reason === "no_source_drop") {
    increment(loop.noEnergyAvailableTicks, role);
  }
}

export function recordTelemetryTaskSelection(role: string, task: string): void {
  const state = ensureTelemetryState();
  increment(state.loop!.workerTaskSelections, `${role}.${task}`);
}

export function recordQueueHeadReserveHold(creep: Creep): void {
  const state = ensureTelemetryState();
  state.loop!.queueHeadReserveCourierTicks += 1;
  state.loop!.queueHeadReserveHeldEnergyTotal += getCreepEnergy(creep);
}

export function observeTelemetryTick(primarySpawn: StructureSpawn | null = null): void {
  const state = ensureTelemetryState();
  syncDropRuntimeState(state);
  const bankStateAtStart = cloneBankState(state.bank ?? createBankState());
  observeCreeps(state, bankStateAtStart);
  observeSpawnAndSourcePipeline(state, primarySpawn, bankStateAtStart);
  pruneTelemetryState(state);
}

function observeCreeps(state: TelemetryMemoryState, bankStateAtStart: TelemetryBankRuntimeState): void {
  const loop = state.loop!;
  const loadedCouriersAtStart = new Set(bankStateAtStart.loadedCourierNames);
  let loadedCourierIgnoredBankWhileLow = false;

  for (const [creepName, creep] of Object.entries(Game.creeps)) {
    const creepState = ensureCreepRuntimeState(creepName, creep, state) as ObservedTelemetryCreepState;
    const currentAction = creepState.currentAction;
    const pendingAction = creepState.pendingAction;
    const role = creep.memory.role;
    const energy = getCreepEnergy(creep);
    const previousEnergy = creepState.lastEnergy;
    const energyDelta = energy - previousEnergy;

    if (positionsMatch(creep.pos, creepState.lastPos)) {
      creepState.samePositionTicks += 1;
      increment(loop.samePositionTicks, role);
    } else {
      creepState.samePositionTicks = 0;
    }

    if (energy > 0) {
      increment(loop.cargoUtilizationTicks, role);
    }

    if (creepState.lastWorking !== creep.memory.working) {
      increment(loop.workingStateFlips, `${role}.${creepState.lastWorking ? "working_to_gather" : "gather_to_work"}`);
    }

    if (role === "harvester" && creep.memory.sourceId) {
      increment(loop.sourceAssignmentTicks, role);
      const source = Game.getObjectById(creep.memory.sourceId);
      if (source && positionsAreNear(creep.pos, source.pos)) {
        increment(loop.sourceAdjacencyTicks, role);
      }
    }

    if (creep.memory.working && energy > 0 && (!currentAction || !isSpendAction(currentAction.action) || currentAction.result !== OK)) {
      increment(loop.withEnergyNoSpendTicks, role);
    }

    if (energyDelta > 0) {
      add(loop.energyGained, role, energyDelta);

      if (currentAction?.result === OK && currentAction.action === "harvest" && currentAction.sourceId) {
        const sourceState = ensureSourceRuntimeState(currentAction.sourceId, state);
        sourceState.harvestedEnergy += energyDelta;
      }
    }
    if (energyDelta < 0) {
      add(loop.energySpent, role, Math.abs(energyDelta));
    }

    if (pendingAction?.result === OK) {
      const action = pendingAction.action;
      const spentEnergy = Math.max(previousEnergy - energy, 0);

      if (action === "transfer" && pendingAction.targetType && spentEnergy > 0) {
        add(loop.deliveredEnergyByTargetType, pendingAction.targetType, spentEnergy);

        if (bankStateAtStart.wasLow) {
          add(loop.bankLowDeliveredEnergyByTargetType, pendingAction.targetType, spentEnergy);
        }

        if (isBankTargetType(pendingAction.targetType)) {
          if (creepState.lastBankPickupTick !== null) {
            loop.pickupToBankLatencyTotal += Game.time - creepState.lastBankPickupTick;
            loop.pickupToBankLatencySamples += 1;
            creepState.lastBankPickupTick = null;
          }
          if (creepState.lastSourcePickupTick !== null && creepState.lastSourceDropFirstSeenTick !== null) {
            loop.sourceDropToBankLatencyTotal += Game.time - creepState.lastSourceDropFirstSeenTick;
            loop.sourceDropToBankLatencySamples += 1;
            creepState.lastSourcePickupTick = null;
            creepState.lastSourceDropFirstSeenTick = null;
          }
        }
      }
      if (action === "build" && spentEnergy > 0) {
        loop.energySpentOnBuild += spentEnergy;
      }
      if (action === "upgrade" && spentEnergy > 0) {
        loop.energySpentOnUpgrade += spentEnergy;
      }
    }

    if (bankStateAtStart.wasLow && loadedCouriersAtStart.has(creepName) && !isBankDirectedAction(currentAction)) {
      loadedCourierIgnoredBankWhileLow = true;
    }

    increment(loop.phaseTicks, `${role}.${resolvePhase(creepState, creep)}`);

    creepState.lastPos = {
      x: creep.pos.x,
      y: creep.pos.y,
      roomName: creep.pos.roomName
    };
    creepState.lastEnergy = energy;
    creepState.lastWorking = creep.memory.working;
    creepState.pendingAction = currentAction;
    delete creepState.currentAction;
  }

  if (bankStateAtStart.wasLow && loadedCourierIgnoredBankWhileLow) {
    loop.loadedCourierIdleWhileBankLowTicks += 1;
  }
}

function syncDropRuntimeState(state: TelemetryMemoryState): void {
  const nextSeen = new Set<string>();

  for (const room of Object.values(Game.rooms)) {
    const sources = room.find(FIND_SOURCES);
    const drops = room.find(FIND_DROPPED_RESOURCES, {
      filter: (resource) => resource.resourceType === RESOURCE_ENERGY && resource.amount > 0
    });

    for (const drop of drops) {
      if (!sources.some((source) => positionsAreNear(drop.pos, source.pos))) {
        continue;
      }

      nextSeen.add(drop.id);
      state.drops![drop.id] ??= {
        firstSeenTick: Game.time,
        sourceId: nearestSourceId(drop.pos, sources),
        pickupLatencyRecorded: false
      };
    }
  }

  for (const dropId of Object.keys(state.drops!)) {
    if (!nextSeen.has(dropId)) {
      delete state.drops![dropId];
    }
  }
}

function pruneTelemetryState(state: TelemetryMemoryState): void {
  for (const creepName of Object.keys(state.creeps!)) {
    if (!Game.creeps[creepName]) {
      delete state.creeps![creepName];
    }
  }
}

function ensureCreepRuntimeState(creepName: string, creep: Creep, state: TelemetryMemoryState): TelemetryCreepRuntimeState {
  state.creeps![creepName] ??= {
    role: creep.memory.role,
    samePositionTicks: 0,
    lastEnergy: getCreepEnergy(creep),
    lastWorking: creep.memory.working,
    lastSuccessfulActionTick: null,
    lastSuccessfulAction: null,
    lastTarget: null,
    targetSwitches: 0,
    lastPickupTick: null,
    lastBankPickupTick: null,
    lastSourcePickupTick: null,
    lastSourceDropFirstSeenTick: null
  };

  const creepState = state.creeps![creepName]!;
  creepState.role = creep.memory.role;
  return creepState;
}

function ensureSourceRuntimeState(sourceId: string, state: TelemetryMemoryState): TelemetrySourceRuntimeState {
  state.sources![sourceId] ??= {
    successfulHarvestTicks: 0,
    harvestedEnergy: 0
  };

  return state.sources![sourceId]!;
}

type BankObservation = {
  isLow: boolean;
  loadedCourierNames: string[];
  spawnAdjacentLoadedCourierNames: string[];
  spawnAdjacentLoadedCourierEnergy: number;
  spawnAdjacentCourierCanCloseDeficit: boolean;
  workerWithEnergyNames: string[];
  sourceBacklog: number;
  roomEnergyAvailable: number;
  queueHeadCost: number | null;
  extraWorkerGate: ExtraWorkerGateState | null;
};

function normalizeLoopState(loop: TelemetryLoopState): void {
  loop.pickupToBankLatencyTotal ??= 0;
  loop.pickupToBankLatencySamples ??= 0;
  loop.sourceDropToBankLatencyTotal ??= 0;
  loop.sourceDropToBankLatencySamples ??= 0;
  loop.spawnObservedTicks ??= 0;
  loop.spawnIdleTicks ??= 0;
  loop.spawnSpawningTicks ??= 0;
  loop.spawnWaitingForSufficientEnergyTicks ??= 0;
  loop.bankLowObservedTicks ??= 0;
  loop.bankReserveBreachCount ??= 0;
  loop.bankReserveRecoveryLatencyTotal ??= 0;
  loop.bankReserveRecoveryLatencySamples ??= 0;
  loop.spawnWaitingWithLoadedCourierTicks ??= 0;
  loop.spawnWaitingWithSpawnAdjacentLoadedCourierTicks ??= 0;
  loop.spawnBlockedDespiteAdjacentCourierClosingDeficitTicks ??= 0;
  loop.queueHeadReserveCourierTicks ??= 0;
  loop.queueHeadReserveHeldEnergyTotal ??= 0;
  loop.spawnWaitingWithWorkerEnergyTicks ??= 0;
  loop.spawnWaitingWithSourceBacklogTicks ??= 0;
  loop.loadedCourierIdleWhileBankLowTicks ??= 0;
  loop.extraWorkerGateBlockedTicks ??= 0;
  loop.extraWorkerGateOpenReasonCounts ??= {};
  loop.bankLowDeliveredEnergyByTargetType ??= {};
  loop.sourceObservedTicks ??= 0;
  loop.sourceTotalTicks ??= 0;
  loop.sourceStaffedTicks ??= 0;
  loop.sourceFullyStaffedTicks ??= 0;
  loop.harvestingSourceStaffedTicks ??= 0;
  loop.harvestingSourceFullyStaffedTicks ??= 0;
  loop.activeHarvestingSourceStaffedTicks ??= 0;
  loop.activeHarvestingSourceFullyStaffedTicks ??= 0;
}

function normalizeBankState(bank: TelemetryBankRuntimeState): void {
  bank.wasLow ??= false;
  bank.lowTickStartedAt ??= null;
  bank.loadedCourierNames ??= [];
  bank.spawnAdjacentLoadedCourierNames ??= [];
  bank.spawnAdjacentLoadedCourierEnergy ??= 0;
  bank.spawnAdjacentCourierCanCloseDeficit ??= false;
  bank.workerWithEnergyNames ??= [];
  bank.sourceBacklog ??= 0;
  bank.roomEnergyAvailable ??= 0;
  bank.queueHeadCost ??= null;
}

function normalizeSpawnAdmissionsState(admissions: TelemetrySpawnAdmissionsState): void {
  admissions.firstCourier3 ??= null;
  admissions.firstWorker4 ??= null;
}

function observeSpawnAndSourcePipeline(
  state: TelemetryMemoryState,
  primarySpawn: StructureSpawn | null,
  bankStateAtStart: TelemetryBankRuntimeState
): void {
  const loop = state.loop!;
  const spawn = primarySpawn ?? findPrimarySpawn();
  const bank = state.bank ?? createBankState();
  const bankObservation = summarizeBankObservation(spawn?.room ?? null);

  if (spawn) {
    const spawnPressure = inspectSpawnBankPressure(spawn.room);
    loop.spawnObservedTicks += 1;

    if (spawn.spawning) {
      loop.spawnSpawningTicks += 1;
    } else if (spawnPressure.totalUnmetDemand > 0) {
      loop.spawnWaitingForSufficientEnergyTicks += 1;
    } else {
      loop.spawnIdleTicks += 1;
    }

    if (bankStateAtStart.wasLow) {
      loop.bankLowObservedTicks += 1;

      if (bankStateAtStart.loadedCourierNames.length > 0) {
        loop.spawnWaitingWithLoadedCourierTicks += 1;
      }
      if (bankStateAtStart.spawnAdjacentLoadedCourierNames.length > 0) {
        loop.spawnWaitingWithSpawnAdjacentLoadedCourierTicks += 1;
      }
      if (bankStateAtStart.spawnAdjacentCourierCanCloseDeficit) {
        loop.spawnBlockedDespiteAdjacentCourierClosingDeficitTicks += 1;
      }
      if (bankStateAtStart.workerWithEnergyNames.length > 0) {
        loop.spawnWaitingWithWorkerEnergyTicks += 1;
      }
      if (bankStateAtStart.sourceBacklog > 0) {
        loop.spawnWaitingWithSourceBacklogTicks += 1;
      }
    }

    if (!bankStateAtStart.wasLow && bankObservation.isLow) {
      loop.bankReserveBreachCount += 1;
      bank.lowTickStartedAt = Game.time;
    } else if (bankStateAtStart.wasLow && !bankObservation.isLow) {
      if (bankStateAtStart.lowTickStartedAt !== null) {
        loop.bankReserveRecoveryLatencyTotal += Game.time - bankStateAtStart.lowTickStartedAt;
        loop.bankReserveRecoveryLatencySamples += 1;
      }
      bank.lowTickStartedAt = null;
    } else if (bankObservation.isLow) {
      bank.lowTickStartedAt = bankStateAtStart.lowTickStartedAt;
    }

    if (bankObservation.extraWorkerGate?.blocked) {
      loop.extraWorkerGateBlockedTicks += 1;
    }
    for (const reason of bankObservation.extraWorkerGate?.openReasons ?? []) {
      increment(loop.extraWorkerGateOpenReasonCounts, reason);
    }
  }

  bank.wasLow = bankObservation.isLow;
  bank.loadedCourierNames = bankObservation.loadedCourierNames;
  bank.spawnAdjacentLoadedCourierNames = bankObservation.spawnAdjacentLoadedCourierNames;
  bank.spawnAdjacentLoadedCourierEnergy = bankObservation.spawnAdjacentLoadedCourierEnergy;
  bank.spawnAdjacentCourierCanCloseDeficit = bankObservation.spawnAdjacentCourierCanCloseDeficit;
  bank.workerWithEnergyNames = bankObservation.workerWithEnergyNames;
  bank.sourceBacklog = bankObservation.sourceBacklog;
  bank.roomEnergyAvailable = bankObservation.roomEnergyAvailable;
  bank.queueHeadCost = bankObservation.queueHeadCost;
  state.bank = bank;

  const coverage = summarizeCurrentSourceCoverage();
  if (coverage.total <= 0) {
    return;
  }

  loop.sourceObservedTicks += 1;
  loop.sourceTotalTicks += coverage.total;
  loop.sourceStaffedTicks += coverage.staffed;
  loop.harvestingSourceStaffedTicks += coverage.harvestingStaffed;
  loop.activeHarvestingSourceStaffedTicks += coverage.activeHarvestingStaffed;

  if (coverage.staffed >= coverage.total) {
    loop.sourceFullyStaffedTicks += 1;
  }
  if (coverage.harvestingStaffed >= coverage.total) {
    loop.harvestingSourceFullyStaffedTicks += 1;
  }
  if (coverage.activeHarvestingStaffed >= coverage.total) {
    loop.activeHarvestingSourceFullyStaffedTicks += 1;
  }
}

function summarizeCurrentSourceCoverage(): {
  total: number;
  staffed: number;
  harvestingStaffed: number;
  activeHarvestingStaffed: number;
} {
  const sourcesById = new Map<string, Source>();
  const staffed = new Set<string>();
  const harvestingStaffed = new Set<string>();
  const activeHarvestingStaffed = new Set<string>();

  for (const room of Object.values(Game.rooms)) {
    for (const source of room.find(FIND_SOURCES)) {
      sourcesById.set(source.id, source);
    }
  }

  for (const creep of Object.values(Game.creeps)) {
    const sourceId = creep.memory.sourceId;
    if (!sourceId || !sourcesById.has(sourceId)) {
      continue;
    }

    staffed.add(sourceId);
    if (!creep.memory.working) {
      harvestingStaffed.add(sourceId);

      const source = sourcesById.get(sourceId);
      if (source && positionsAreNear(creep.pos, source.pos)) {
        activeHarvestingStaffed.add(sourceId);
      }
    }
  }

  return {
    total: sourcesById.size,
    staffed: staffed.size,
    harvestingStaffed: harvestingStaffed.size,
    activeHarvestingStaffed: activeHarvestingStaffed.size
  };
}

function findPrimarySpawn(): StructureSpawn | null {
  return Object.values(Game.spawns)[0] ?? null;
}

function resolveCreepName(creep: Creep): string {
  if (typeof creep.name === "string" && creep.name.length > 0) {
    return creep.name;
  }

  for (const [name, candidate] of Object.entries(Game.creeps)) {
    if (candidate === creep) {
      return name;
    }
  }

  return `${creep.memory.role}:${creep.pos.roomName}:${creep.pos.x},${creep.pos.y}`;
}

function createLoopState(): TelemetryLoopState {
  return {
    phaseTicks: {},
    actionAttempts: {},
    actionSuccesses: {},
    actionFailures: {},
    targetFailures: {},
    workingStateFlips: {},
    cargoUtilizationTicks: {},
    noTargetTicks: {},
    withEnergyNoSpendTicks: {},
    noEnergyAvailableTicks: {},
    sourceAssignmentTicks: {},
    sourceAdjacencyTicks: {},
    samePositionTicks: {},
    energyGained: {},
    energySpent: {},
    energySpentOnBuild: 0,
    energySpentOnUpgrade: 0,
    deliveredEnergyByTargetType: {},
    transferSuccessByTargetType: {},
    workerTaskSelections: {},
    sourceDropPickupLatencyTotal: 0,
    sourceDropPickupLatencySamples: 0,
    pickupToSpendLatencyTotal: 0,
    pickupToSpendLatencySamples: 0,
    pickupToBankLatencyTotal: 0,
    pickupToBankLatencySamples: 0,
    sourceDropToBankLatencyTotal: 0,
    sourceDropToBankLatencySamples: 0,
    spawnObservedTicks: 0,
    spawnIdleTicks: 0,
    spawnSpawningTicks: 0,
    spawnWaitingForSufficientEnergyTicks: 0,
    bankLowObservedTicks: 0,
    bankReserveBreachCount: 0,
    bankReserveRecoveryLatencyTotal: 0,
    bankReserveRecoveryLatencySamples: 0,
    spawnWaitingWithLoadedCourierTicks: 0,
    spawnWaitingWithSpawnAdjacentLoadedCourierTicks: 0,
    spawnBlockedDespiteAdjacentCourierClosingDeficitTicks: 0,
    queueHeadReserveCourierTicks: 0,
    queueHeadReserveHeldEnergyTotal: 0,
    spawnWaitingWithWorkerEnergyTicks: 0,
    spawnWaitingWithSourceBacklogTicks: 0,
    loadedCourierIdleWhileBankLowTicks: 0,
    extraWorkerGateBlockedTicks: 0,
    extraWorkerGateOpenReasonCounts: {},
    bankLowDeliveredEnergyByTargetType: {},
    sourceObservedTicks: 0,
    sourceTotalTicks: 0,
    sourceStaffedTicks: 0,
    sourceFullyStaffedTicks: 0,
    harvestingSourceStaffedTicks: 0,
    harvestingSourceFullyStaffedTicks: 0,
    activeHarvestingSourceStaffedTicks: 0,
    activeHarvestingSourceFullyStaffedTicks: 0
  };
}

function createBankState(): TelemetryBankRuntimeState {
  return {
    wasLow: false,
    lowTickStartedAt: null,
    loadedCourierNames: [],
    spawnAdjacentLoadedCourierNames: [],
    spawnAdjacentLoadedCourierEnergy: 0,
    spawnAdjacentCourierCanCloseDeficit: false,
    workerWithEnergyNames: [],
    sourceBacklog: 0,
    roomEnergyAvailable: 0,
    queueHeadCost: null
  };
}

function createSpawnAdmissionsState(): TelemetrySpawnAdmissionsState {
  return {
    firstCourier3: null,
    firstWorker4: null
  };
}

function cloneBankState(bank: TelemetryBankRuntimeState): TelemetryBankRuntimeState {
  return {
    wasLow: bank.wasLow,
    lowTickStartedAt: bank.lowTickStartedAt,
    loadedCourierNames: [...bank.loadedCourierNames],
    spawnAdjacentLoadedCourierNames: [...bank.spawnAdjacentLoadedCourierNames],
    spawnAdjacentLoadedCourierEnergy: bank.spawnAdjacentLoadedCourierEnergy,
    spawnAdjacentCourierCanCloseDeficit: bank.spawnAdjacentCourierCanCloseDeficit,
    workerWithEnergyNames: [...bank.workerWithEnergyNames],
    sourceBacklog: bank.sourceBacklog,
    roomEnergyAvailable: bank.roomEnergyAvailable,
    queueHeadCost: bank.queueHeadCost
  };
}

function summarizeBankObservation(room: Room | null): BankObservation {
  if (!room) {
    return {
      isLow: false,
      loadedCourierNames: [],
      spawnAdjacentLoadedCourierNames: [],
      spawnAdjacentLoadedCourierEnergy: 0,
      spawnAdjacentCourierCanCloseDeficit: false,
      workerWithEnergyNames: [],
      sourceBacklog: 0,
      roomEnergyAvailable: 0,
      queueHeadCost: null,
      extraWorkerGate: null
    };
  }

  const pressure = inspectSpawnBankPressure(room);
  const refillTargets = room.find(FIND_MY_STRUCTURES, {
    filter: (structure): structure is StructureSpawn | StructureExtension => {
      if (structure.structureType !== STRUCTURE_SPAWN && structure.structureType !== STRUCTURE_EXTENSION) {
        return false;
      }

      return structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
    }
  });
  const loadedCourierNames: string[] = [];
  const spawnAdjacentLoadedCourierNames: string[] = [];
  let spawnAdjacentLoadedCourierEnergy = 0;
  const workerWithEnergyNames: string[] = [];

  for (const [creepName, creep] of Object.entries(Game.creeps)) {
    if (creep.memory.homeRoom !== room.name) {
      continue;
    }

    if (creep.memory.role === "courier" && creep.memory.working && getCreepEnergy(creep) > 0) {
      loadedCourierNames.push(creepName);
      if (refillTargets.some((target) => positionsAreNear(creep.pos, target.pos))) {
        spawnAdjacentLoadedCourierNames.push(creepName);
        spawnAdjacentLoadedCourierEnergy += getCreepEnergy(creep);
      }
    }

    if (creep.memory.role === "worker" && getCreepEnergy(creep) > 0) {
      workerWithEnergyNames.push(creepName);
    }
  }

  const queueHeadCost = pressure.queueHeadCost;
  const energyDeficit = queueHeadCost === null ? 0 : Math.max(queueHeadCost - room.energyAvailable, 0);

  return {
    isLow: pressure.waitingForEnergy,
    loadedCourierNames,
    spawnAdjacentLoadedCourierNames,
    spawnAdjacentLoadedCourierEnergy,
    spawnAdjacentCourierCanCloseDeficit: energyDeficit > 0 && spawnAdjacentLoadedCourierEnergy >= energyDeficit,
    workerWithEnergyNames,
    sourceBacklog: countSourceBacklog(room),
    roomEnergyAvailable: room.energyAvailable,
    queueHeadCost,
    extraWorkerGate: inspectPreRcl3ExtraWorkerGate(room)
  };
}

function countSourceBacklog(room: Room): number {
  const sources = room.find(FIND_SOURCES);
  let total = 0;

  for (const drop of room.find(FIND_DROPPED_RESOURCES, {
    filter: (resource) => resource.resourceType === RESOURCE_ENERGY && resource.amount > 0
  })) {
    if (sources.some((source) => positionsAreNear(drop.pos, source.pos))) {
      total += drop.amount;
    }
  }

  return total;
}

function isBankTargetType(targetType: string | undefined): boolean {
  return targetType === STRUCTURE_SPAWN || targetType === STRUCTURE_EXTENSION;
}

function isBankDirectedAction(action: TelemetryCreepActionState | undefined): boolean {
  return Boolean(
    action
    && (action.action === "move" || action.action === "transfer")
    && isBankTargetType(action.targetType)
  );
}

function updateTargetSelection(
  creepState: TelemetryCreepRuntimeState,
  loop: TelemetryLoopState,
  role: string,
  targetKey: string | null
): void {
  if (!targetKey) {
    return;
  }

  if (creepState.lastTarget !== null && creepState.lastTarget !== targetKey) {
    creepState.targetSwitches += 1;
    increment(loop.targetFailures, `${role}.target_switch`);
  }
  creepState.lastTarget = targetKey;
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function add(record: Record<string, number>, key: string, amount: number): void {
  record[key] = (record[key] ?? 0) + amount;
}

function positionsMatch(position: RoomPosition, previous: TelemetryCreepRuntimeState["lastPos"]): boolean {
  return Boolean(previous && previous.x === position.x && previous.y === position.y && previous.roomName === position.roomName);
}

function positionsAreNear(position: RoomPosition, target: RoomPosition): boolean {
  return Math.max(Math.abs(position.x - target.x), Math.abs(position.y - target.y)) <= 1 && position.roomName === target.roomName;
}

function nearestSourceId(position: RoomPosition, sources: Source[]): string | null {
  for (const source of sources) {
    if (positionsAreNear(position, source.pos)) {
      return source.id;
    }
  }

  return null;
}

function isSpendAction(action: string): boolean {
  return action === "build" || action === "upgrade";
}

function getCreepEnergy(creep: Creep): number {
  return typeof creep.store?.[RESOURCE_ENERGY] === "number" ? creep.store[RESOURCE_ENERGY] : 0;
}

function resolvePhase(creepState: TelemetryCreepRuntimeState, creep: Creep): string {
  if (creepState.currentAction?.result === OK) {
    return creepState.currentAction.action;
  }

  return creep.memory.working ? "working" : "gathering";
}
