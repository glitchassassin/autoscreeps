declare global {
  type WorkerRole = "harvester" | "upgrader";

  interface TelemetryMemoryState {
    creepDeaths: number;
    firstOwnedSpawnTick: number | null;
    rcl2Tick: number | null;
    rcl3Tick: number | null;
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
