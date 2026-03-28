type SpawnRequest = {
  body: BodyPartConstant[];
  memory: CreepMemory;
  name: string;
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

  const nextRole = getNextRole();
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

function getNextRole(): WorkerRole | null {
  for (const role of Object.keys(desiredCreeps) as WorkerRole[]) {
    if (countRole(role) < desiredCreeps[role]) {
      return role;
    }
  }

  return null;
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
