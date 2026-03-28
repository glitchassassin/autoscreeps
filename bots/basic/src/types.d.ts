declare global {
  type WorkerRole = "harvester" | "upgrader";

  interface CreepMemory {
    role: WorkerRole;
    working: boolean;
    homeRoom: string;
  }
}

export {};
