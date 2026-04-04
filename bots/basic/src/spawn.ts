type SpawnRequest = {
  body: BodyPartConstant[];
  memory: CreepMemory;
  name: string;
};

export type SpawnDemandSummary = {
  unmetDemand: Record<WorkerRole, number>;
  nextRole: WorkerRole | null;
  totalUnmetDemand: number;
};

const bodyPlans: Array<{ cost: number; body: BodyPartConstant[] }> = [
  { cost: 200, body: ["work", "carry", "move"] },
  { cost: 300, body: ["work", "work", "carry", "move"] },
  { cost: 400, body: ["work", "carry", "carry", "move", "move"] },
  { cost: 550, body: ["work", "work", "carry", "carry", "move", "move"] },
  { cost: 650, body: ["work", "work", "work", "carry", "carry", "move", "move", "move"] }
];

const desiredCreeps: Record<WorkerRole, number> = {
  harvester: 2,
  upgrader: 2
};

export function chooseBody(availableEnergy: number): BodyPartConstant[] | null {
  let selected: BodyPartConstant[] | null = null;

  for (const plan of bodyPlans) {
    if (plan.cost <= availableEnergy) {
      selected = plan.body;
    }
  }

  return selected;
}

export function createSpawnRequest(spawn: StructureSpawn): SpawnRequest | null {
  if (spawn.spawning) {
    return null;
  }

  const nextRole = summarizeSpawnDemand().nextRole;
  if (!nextRole) {
    return null;
  }

  const body = chooseBody(spawn.room.energyAvailable);
  if (!body) {
    return null;
  }

  return {
    body,
    name: `${nextRole}-${Game.time}`,
    memory: {
      role: nextRole,
      working: false,
      homeRoom: spawn.room.name
    }
  };
}

export function runSpawnManager(spawn: StructureSpawn): ScreepsReturnCode | null {
  const request = createSpawnRequest(spawn);
  if (!request) {
    return null;
  }

  const result = spawn.spawnCreep(request.body, request.name, { memory: request.memory });

  if (result === OK) {
    console.log(`[spawn] ${spawn.name} started ${request.memory.role} ${request.name}`);
  }

  return result;
}

export function summarizeSpawnDemand(): SpawnDemandSummary {
  const unmetDemand: Record<WorkerRole, number> = {
    harvester: 0,
    upgrader: 0
  };
  let nextRole: WorkerRole | null = null;
  let totalUnmetDemand = 0;

  for (const role of Object.keys(desiredCreeps) as WorkerRole[]) {
    const deficit = Math.max(desiredCreeps[role] - countRole(role), 0);
    unmetDemand[role] = deficit;
    totalUnmetDemand += deficit;

    if (nextRole === null && deficit > 0) {
      nextRole = role;
    }
  }

  return {
    unmetDemand,
    nextRole,
    totalUnmetDemand
  };
}

function countRole(role: WorkerRole): number {
  let total = 0;

  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.role === role) {
      total += 1;
    }
  }

  return total;
}
