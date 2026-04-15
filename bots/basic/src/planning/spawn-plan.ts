import type { ColonyMode, SitePlan, SpawnDemandSummary, SpawnPlan, SpawnRequestPlan, WorldSnapshot } from "../core/types";

const roleBodyPatterns: Record<WorkerRole, BodyPartConstant[]> = {
  "recovery-worker": ["work", "carry", "move"],
  harvester: ["work", "work", "move"],
  runner: ["carry", "move"],
  upgrader: ["work", "carry", "move"]
};

const maxBodyPatterns = 5;

export function chooseBody(role: WorkerRole, availableEnergy: number): BodyPartConstant[] | null {
  const pattern = roleBodyPatterns[role];
  const patternCost = calculateBodyCost(pattern);

  const patternCount = Math.min(Math.floor(availableEnergy / patternCost), maxBodyPatterns);
  if (patternCount <= 0) {
    return null;
  }

  return Array.from({ length: patternCount }, () => pattern).flat();
}

export function summarizeSpawnDemand(
  world: Pick<WorldSnapshot, "creepsByRole">,
  mode: ColonyMode,
  siteCount: number
): SpawnDemandSummary {
  const targets = determineRoleTargets(mode, siteCount);
  const nextRole = findNextRole(world.creepsByRole, targets, determineRolePriority(mode));
  const unmetDemand: Record<WorkerRole, number> = {
    "recovery-worker": Math.max(targets["recovery-worker"] - world.creepsByRole["recovery-worker"], 0),
    harvester: Math.max(targets.harvester - world.creepsByRole.harvester, 0),
    runner: Math.max(targets.runner - world.creepsByRole.runner, 0),
    upgrader: Math.max(targets.upgrader - world.creepsByRole.upgrader, 0)
  };

  return {
    unmetDemand,
    nextRole,
    totalUnmetDemand: Object.values(unmetDemand).reduce((total, value) => total + value, 0)
  };
}

export function createSpawnPlan(world: WorldSnapshot, mode: ColonyMode, sites: SitePlan[]): SpawnPlan {
  const demand = summarizeSpawnDemand(world, mode, sites.length);
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
    name: `${demand.nextRole}-${world.gameTime}`,
    memory: createCreepMemory(demand.nextRole, world.primaryRoomName ?? "unknown")
  };
}

function createCreepMemory(role: WorkerRole, homeRoom: string): CreepMemory {
  return {
    role,
    ...(usesWorkingState(role) ? { working: false } : {}),
    homeRoom
  };
}

function usesWorkingState(role: WorkerRole): boolean {
  return role === "recovery-worker" || role === "runner";
}

function calculateBodyCost(body: BodyPartConstant[]): number {
  return body.reduce((total, part) => total + getBodyPartCost(part), 0);
}

function getBodyPartCost(part: BodyPartConstant): number {
  switch (part) {
    case "work":
      return 100;
    case "carry":
      return 50;
    case "move":
      return 50;
  }

  return 0;
}

function determineRoleTargets(mode: ColonyMode, siteCount: number): Record<WorkerRole, number> {
  switch (mode) {
    case "bootstrap":
      return {
        "recovery-worker": 0,
        harvester: 0,
        runner: 0,
        upgrader: 0
      };
    case "recovery":
      return {
        "recovery-worker": 1,
        harvester: siteCount > 0 ? 1 : 0,
        runner: siteCount > 0 ? 1 : 0,
        upgrader: 0
      };
    case "normal":
      return {
        "recovery-worker": 0,
        harvester: siteCount,
        runner: siteCount > 0 ? 1 : 0,
        upgrader: siteCount > 0 ? 1 : 0
      };
  }
}

function determineRolePriority(mode: ColonyMode): WorkerRole[] {
  switch (mode) {
    case "bootstrap":
      return [];
    case "recovery":
      return ["recovery-worker", "harvester", "runner", "upgrader"];
    case "normal":
      return ["upgrader", "harvester", "runner", "recovery-worker"];
  }

  return [];
}

function findNextRole(
  counts: Record<WorkerRole, number>,
  targets: Record<WorkerRole, number>,
  priority: WorkerRole[]
): WorkerRole | null {
  for (const role of priority) {
    if (counts[role] < targets[role]) {
      return role;
    }
  }

  return null;
}
