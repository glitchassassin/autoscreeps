declare global {
  type WorkerRole = "harvester" | "courier" | "worker";

  type TelemetryActionName = "harvest" | "pickup" | "transfer" | "upgrade" | "build" | "move";

  interface TelemetryLoopState {
    phaseTicks: Record<string, number>;
    actionAttempts: Record<string, number>;
    actionSuccesses: Record<string, number>;
    actionFailures: Record<string, number>;
    targetFailures: Record<string, number>;
    workingStateFlips: Record<string, number>;
    cargoUtilizationTicks: Record<string, number>;
    noTargetTicks: Record<string, number>;
    withEnergyNoSpendTicks: Record<string, number>;
    noEnergyAvailableTicks: Record<string, number>;
    sourceAssignmentTicks: Record<string, number>;
    sourceAdjacencyTicks: Record<string, number>;
    samePositionTicks: Record<string, number>;
    energyGained: Record<string, number>;
    energySpent: Record<string, number>;
    energySpentOnBuild: number;
    energySpentOnUpgrade: number;
    deliveredEnergyByTargetType: Record<string, number>;
    transferSuccessByTargetType: Record<string, number>;
    workerTaskSelections: Record<string, number>;
    sourceDropPickupLatencyTotal: number;
    sourceDropPickupLatencySamples: number;
    pickupToSpendLatencyTotal: number;
    pickupToSpendLatencySamples: number;
    pickupToBankLatencyTotal: number;
    pickupToBankLatencySamples: number;
    sourceDropToBankLatencyTotal: number;
    sourceDropToBankLatencySamples: number;
    spawnObservedTicks: number;
    spawnIdleTicks: number;
    spawnSpawningTicks: number;
    spawnWaitingForSufficientEnergyTicks: number;
    bankLowObservedTicks: number;
    bankReserveBreachCount: number;
    bankReserveRecoveryLatencyTotal: number;
    bankReserveRecoveryLatencySamples: number;
    spawnWaitingWithLoadedCourierTicks: number;
    spawnWaitingWithSpawnAdjacentLoadedCourierTicks: number;
    spawnWaitingWithWorkerEnergyTicks: number;
    spawnWaitingWithSourceBacklogTicks: number;
    loadedCourierIdleWhileBankLowTicks: number;
    extraWorkerGateBlockedTicks: number;
    extraWorkerGateOpenReasonCounts: Record<string, number>;
    bankLowDeliveredEnergyByTargetType: Record<string, number>;
    sourceObservedTicks: number;
    sourceTotalTicks: number;
    sourceStaffedTicks: number;
    sourceFullyStaffedTicks: number;
    harvestingSourceStaffedTicks: number;
    harvestingSourceFullyStaffedTicks: number;
    activeHarvestingSourceStaffedTicks: number;
    activeHarvestingSourceFullyStaffedTicks: number;
  }

  interface TelemetryCreepActionState {
    action: string;
    result: number;
    targetType?: string;
    targetKey?: string;
    sourceId?: string;
    dropId?: string;
  }

  interface TelemetryCreepRuntimeState {
    role: string;
    lastPos?: {
      x: number;
      y: number;
      roomName: string;
    };
    samePositionTicks: number;
    lastEnergy: number;
    lastWorking: boolean;
    lastSuccessfulActionTick: number | null;
    lastSuccessfulAction: string | null;
    lastTarget: string | null;
    targetSwitches: number;
    lastPickupTick: number | null;
    lastBankPickupTick: number | null;
    lastSourcePickupTick: number | null;
    lastSourceDropFirstSeenTick: number | null;
    currentAction?: TelemetryCreepActionState;
  }

  interface TelemetryDropRuntimeState {
    firstSeenTick: number;
    sourceId: string | null;
    pickupLatencyRecorded: boolean;
  }

  interface TelemetrySourceRuntimeState {
    successfulHarvestTicks: number;
    harvestedEnergy: number;
  }

  interface TelemetryMemoryState {
    creepDeaths: number;
    firstOwnedSpawnTick: number | null;
    rcl2Tick: number | null;
    rcl3Tick: number | null;
    debugError?: string | null;
    loop?: TelemetryLoopState;
    bank?: TelemetryBankRuntimeState;
    spawnAdmissions?: TelemetrySpawnAdmissionsState;
    creeps?: Record<string, TelemetryCreepRuntimeState>;
    drops?: Record<string, TelemetryDropRuntimeState>;
    sources?: Record<string, TelemetrySourceRuntimeState>;
  }

  interface TelemetryBankRuntimeState {
    wasLow: boolean;
    lowTickStartedAt: number | null;
    loadedCourierNames: string[];
    spawnAdjacentLoadedCourierNames: string[];
    workerWithEnergyNames: string[];
    sourceBacklog: number;
  }

  interface TelemetrySpawnAdmissionState {
    gameTime: number;
    sourceBacklog: number;
    loadedCouriers: number;
    roleCounts: Record<WorkerRole, number>;
    openReasons: string[];
    spawnWaitingWithSourceBacklogTicks: number;
    sourceDropToBankLatencyAvg: number | null;
    withinCourier3Window: boolean;
    courier3PriorityActive: boolean;
  }

  interface TelemetrySpawnAdmissionsState {
    firstCourier3: TelemetrySpawnAdmissionState | null;
    firstWorker4: TelemetrySpawnAdmissionState | null;
  }

  interface CreepMemory {
    role: WorkerRole;
    working: boolean;
    homeRoom: string;
    sourceId?: Id<Source>;
  }

  interface Memory {
    telemetry?: TelemetryMemoryState;
  }
}

export {};
