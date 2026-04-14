declare global {
  type WorkerRole = "worker";

  interface TelemetryMemoryState {
    creepDeaths: number;
    firstOwnedSpawnTick: number | null;
    rcl2Tick: number | null;
    rcl3Tick: number | null;
    errors?: string[];
  }

  interface CreepMemory {
    role: WorkerRole;
    working: boolean;
    homeRoom: string;
  }

  interface Memory {
    telemetry?: TelemetryMemoryState;
  }
}

export {};
