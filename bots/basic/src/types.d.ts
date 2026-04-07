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
    currentAction?: TelemetryCreepActionState;
  }

  interface TelemetryDropRuntimeState {
    firstSeenTick: number;
    sourceId: string | null;
    pickupLatencyRecorded: boolean;
  }

  interface TelemetrySourceRuntimeState {
    successfulHarvestTicks: number;
  }

  interface TelemetryMemoryState {
    creepDeaths: number;
    firstOwnedSpawnTick: number | null;
    rcl2Tick: number | null;
    rcl3Tick: number | null;
    debugError?: string | null;
    loop?: TelemetryLoopState;
    creeps?: Record<string, TelemetryCreepRuntimeState>;
    drops?: Record<string, TelemetryDropRuntimeState>;
    sources?: Record<string, TelemetrySourceRuntimeState>;
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
