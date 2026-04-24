declare global {
  type WorkerRole = "recovery-worker" | "builder" | "harvester" | "runner" | "upgrader";

  interface TelemetryMemoryState {
    creepDeaths: number;
    firstOwnedSpawnTick: number | null;
    rcl2Tick: number | null;
    rcl3Tick: number | null;
    errors?: string[];
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
