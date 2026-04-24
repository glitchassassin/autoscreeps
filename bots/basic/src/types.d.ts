declare global {
  type WorkerRole = "recovery-worker" | "builder" | "harvester" | "runner" | "upgrader";

  interface TelemetryMemoryState {
    creepDeaths: number;
    energy?: EnergyLedgerMemoryState;
    runnerStateTicks?: RunnerStateTicksMemoryState;
    runnerMovement?: RunnerMovementMemoryState;
    firstOwnedSpawnTick: number | null;
    rcl2Tick: number | null;
    rcl3Tick: number | null;
    errors?: string[];
  }

  interface EnergyLedgerMemoryState {
    harvested: number;
    harvestedBySourceId: Record<string, number>;
    dropped: number;
    pickedUp: number;
    withdrawn: number;
    transferred: number;
    spawnedBodyCost: number;
    upgraded: number;
    built: number;
    lostOnCreepDeath: number;
  }

  interface RunnerStateTicksMemoryState {
    idleNoPickupTarget: number;
    movingToPickup: number;
    pickupSucceeded: number;
    pickupFailed: number;
    idleNoDeliveryTarget: number;
    movingToDelivery: number;
    transferSucceeded: number;
    transferFailed: number;
  }

  type RunnerMovementKind = "pickup" | "delivery";

  interface RunnerMovementTicksMemoryState {
    failedToPath: number;
    tired: number;
    stuck: number;
  }

  interface RunnerMovementMemoryState {
    pickup: RunnerMovementTicksMemoryState;
    delivery: RunnerMovementTicksMemoryState;
    total: RunnerMovementTicksMemoryState;
  }

  interface RunnerMoveIntentMemoryState {
    kind: RunnerMovementKind;
    x: number;
    y: number;
    roomName: string;
    tick: number;
  }

  interface RoomPlanningMemoryState {
    version: number;
    policy: "normal" | "temple";
    status: "complete" | "failed";
    requestedAt: number;
    updatedAt: number;
    completedAt?: number;
    failedAt?: number;
    ticksSpent: number;
    failure?: string;
    structures?: Array<{
      type: string;
      x: number;
      y: number;
      rcl: number;
      label: string;
      removeAtRcl?: number;
    }>;
  }

  interface CreepMemory {
    role: WorkerRole;
    working?: boolean;
    homeRoom: string;
    lastEnergy?: number;
    lastRunnerMove?: RunnerMoveIntentMemoryState;
  }

  interface Memory {
    telemetry?: TelemetryMemoryState;
    rooms?: Record<string, RoomMemory & { planning?: RoomPlanningMemoryState }>;
  }

  // The Screeps type package declares RoomMemory as an indexable interface.
  // This extension documents the bot-owned planning slot used in Memory.rooms.
  interface RoomMemory {
    planning?: RoomPlanningMemoryState;
  }
}

export {};
