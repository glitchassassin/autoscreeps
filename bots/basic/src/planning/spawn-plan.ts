import type { SpawnDemandSummary, SpawnPlan, SpawnRequestPlan, WorldSnapshot } from "../core/types";

const workerTarget = 5;
const bodyPartPattern: BodyPartConstant[] = ["work", "carry", "move"];
const bodyPartPatternCost = 200;
const maxBodyPatterns = 5;

export function chooseBody(role: WorkerRole, availableEnergy: number): BodyPartConstant[] | null {
  if (role !== "worker") {
    return null;
  }

  const patternCount = Math.min(Math.floor(availableEnergy / bodyPartPatternCost), maxBodyPatterns);
  if (patternCount <= 0) {
    return null;
  }

  const body: BodyPartConstant[] = [];
  for (let index = 0; index < patternCount; index += 1) {
    body.push(...bodyPartPattern);
  }

  return body;
}

export function summarizeSpawnDemand(world: Pick<WorldSnapshot, "creepsByRole">): SpawnDemandSummary {
  const deficit = Math.max(workerTarget - world.creepsByRole.worker, 0);

  return {
    unmetDemand: {
      worker: deficit
    },
    nextRole: deficit > 0 ? "worker" : null,
    totalUnmetDemand: deficit
  };
}

export function createSpawnPlan(world: WorldSnapshot): SpawnPlan {
  const demand = summarizeSpawnDemand(world);
  const request = buildSpawnRequest(world, demand);

  return {
    bootstrapRoomName: request === null && shouldBootstrapSpawn(world) ? world.primaryRoomName : null,
    demand,
    request
  };
}

function shouldBootstrapSpawn(world: WorldSnapshot): boolean {
  return world.primarySpawnName === null
    && world.primaryRoomName !== null
    && world.primarySpawnConstructionSiteCount === 0;
}

function buildSpawnRequest(world: WorldSnapshot, demand: SpawnDemandSummary): SpawnRequestPlan | null {
  if (world.primarySpawnName === null || world.primarySpawnSpawning || demand.nextRole === null) {
    return null;
  }

  const body = chooseBody(demand.nextRole, world.primaryRoomEnergyAvailable ?? 0);
  if (body === null) {
    return null;
  }

  return {
    spawnName: world.primarySpawnName,
    body,
    name: `worker-${world.gameTime}`,
    memory: {
      role: "worker",
      working: false,
      homeRoom: world.primaryRoomName ?? "unknown"
    }
  };
}
