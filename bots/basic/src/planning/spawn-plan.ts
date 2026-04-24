import type { ColonyMode, ConstructionPlan, SitePlan, SpawnDemandInputs, SpawnDemandSummary, SpawnPlan, SpawnRequestPlan, WorldSnapshot } from "../core/types";

const roleBodyPatterns: Partial<Record<WorkerRole, BodyPartConstant[]>> = {
  "recovery-worker": ["work", "carry", "move"],
  builder: ["work", "carry", "move"],
  runner: ["carry", "move"],
  upgrader: ["work", "carry", "move"]
};

const creepLifetimeTicks = 1500;
const carryCapacity = 50;
const harvestPowerPerWork = 2;
const maxBodyPatterns = 5;

export function chooseBody(role: WorkerRole, availableEnergy: number): BodyPartConstant[] | null {
  if (role === "harvester") {
    return chooseHarvesterBody(availableEnergy);
  }

  const pattern = roleBodyPatterns[role];
  if (!pattern) {
    return null;
  }

  return repeatPatternToEnergy(pattern, availableEnergy);
}

export function summarizeSpawnDemand(
  world: WorldSnapshot,
  mode: ColonyMode,
  sites: SitePlan[],
  construction: Pick<ConstructionPlan, "backlogCount"> = { backlogCount: 0 }
): SpawnDemandSummary {
  switch (mode) {
    case "bootstrap":
      return createDemandSummary({
        "recovery-worker": 0,
        builder: 0,
        harvester: 0,
        runner: 0,
        upgrader: 0
      }, null, createEmptyDemandInputs());
    case "recovery":
      return summarizeFixedSpawnDemand(world, determineRecoveryTargets(sites.length), ["recovery-worker", "harvester", "runner", "upgrader"]);
    case "normal":
      return summarizeNormalSpawnDemand(world, sites, construction);
  }
}

export function createSpawnPlan(world: WorldSnapshot, mode: ColonyMode, sites: SitePlan[], construction: ConstructionPlan): SpawnPlan {
  const demand = summarizeSpawnDemand(world, mode, sites, construction);
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
  return role === "recovery-worker" || role === "builder" || role === "runner";
}

function repeatPatternToEnergy(pattern: BodyPartConstant[], availableEnergy: number): BodyPartConstant[] | null {
  const patternCost = calculateBodyCost(pattern);
  const patternCount = Math.min(Math.floor(availableEnergy / patternCost), maxBodyPatterns);

  if (patternCount <= 0) {
    return null;
  }

  return Array.from({ length: patternCount }, () => pattern).flat();
}

function chooseHarvesterBody(availableEnergy: number): BodyPartConstant[] | null {
  if (availableEnergy >= 650) {
    return ["work", "work", "work", "work", "work", "move", "move", "move"];
  }

  if (availableEnergy >= 500) {
    return ["work", "work", "work", "work", "move", "move"];
  }

  if (availableEnergy >= 250) {
    return ["work", "work", "move"];
  }

  return null;
}

function summarizeFixedSpawnDemand(
  world: Pick<WorldSnapshot, "creepsByRole">,
  targets: Record<WorkerRole, number>,
  priority: WorkerRole[]
): SpawnDemandSummary {
  const unmetDemand: Record<WorkerRole, number> = {
    "recovery-worker": Math.max(targets["recovery-worker"] - world.creepsByRole["recovery-worker"], 0),
    builder: Math.max(targets.builder - world.creepsByRole.builder, 0),
    harvester: Math.max(targets.harvester - world.creepsByRole.harvester, 0),
    runner: Math.max(targets.runner - world.creepsByRole.runner, 0),
    upgrader: Math.max(targets.upgrader - world.creepsByRole.upgrader, 0)
  };

  return createDemandSummary(unmetDemand, findNextRoleByCount(unmetDemand, priority), createEmptyDemandInputs());
}

function summarizeNormalSpawnDemand(
  world: WorldSnapshot,
  sites: SitePlan[],
  construction: Pick<ConstructionPlan, "backlogCount">
): SpawnDemandSummary {
  const plannedHarvesterBody = choosePlanningBody(world, "harvester");
  const plannedRunnerBody = choosePlanningBody(world, "runner");
  const plannedBuilderBody = choosePlanningBody(world, "builder");
  const plannedUpgraderBody = choosePlanningBody(world, "upgrader");

  if (!plannedHarvesterBody || !plannedRunnerBody || !plannedBuilderBody || !plannedUpgraderBody) {
    return createDemandSummary({
      "recovery-worker": 0,
      builder: 0,
      harvester: 0,
      runner: 0,
      upgrader: 0
    }, null, createEmptyDemandInputs());
  }

  const plannedHarvesterWork = countBodyParts(plannedHarvesterBody, WORK);
  const plannedRunnerCarry = countBodyParts(plannedRunnerBody, CARRY);
  const plannedUpgraderGrossEpt = calculateUpgraderGrossEpt(
    countBodyParts(plannedUpgraderBody, WORK),
    countBodyParts(plannedUpgraderBody, CARRY),
    normalizePathLength(world.primarySpawnToControllerPathLength)
  );
  const plannedUpgraderNetEpt = plannedUpgraderGrossEpt + calculateBodyCost(plannedUpgraderBody) / creepLifetimeTicks;

  let totalGrossEpt = 0;
  let totalRequiredHarvestWork = 0;
  let totalCoveredHarvestWork = 0;
  let harvesterTargetCount = 0;
  let harvesterDeficitCount = 0;
  let totalRequiredCarryParts = 0;

  for (const site of sites) {
    const source = world.sources.find((candidate) => candidate.sourceId === site.sourceId);
    const grossEpt = site.theoreticalGrossEpt;
    const requiredHarvestWork = Math.ceil(grossEpt / harvestPowerPerWork);
    const coveredHarvestWork = Math.min(site.assignedWorkParts, requiredHarvestWork);
    const requiredCarryParts = Math.ceil(grossEpt * (2 * normalizePathLength(source?.pathLengthToPrimarySpawn ?? null) + 2) / carryCapacity);

    totalGrossEpt += grossEpt;
    totalRequiredHarvestWork += requiredHarvestWork;
    totalCoveredHarvestWork += coveredHarvestWork;
    harvesterTargetCount += calculateTargetCount(requiredHarvestWork, plannedHarvesterWork);
    harvesterDeficitCount += calculateTargetCount(Math.max(requiredHarvestWork - site.assignedWorkParts, 0), plannedHarvesterWork);
    totalRequiredCarryParts += requiredCarryParts;
  }

  const localCreeps = world.creeps.filter((creep) => creep.homeRoom === world.primaryRoomName);
  const currentCarryParts = localCreeps
    .filter((creep) => creep.role === "runner")
    .reduce((total, creep) => total + creep.activeCarryParts, 0);
  const runnerTargetCount = calculateTargetCount(totalRequiredCarryParts, plannedRunnerCarry);
  const runnerDeficitCount = calculateTargetCount(Math.max(totalRequiredCarryParts - currentCarryParts, 0), plannedRunnerCarry);
  const builderTargetCount = construction.backlogCount > 0 ? 1 : 0;
  const currentBuilderCount = localCreeps.filter((creep) => creep.role === "builder").length;
  const builderDeficitCount = Math.max(builderTargetCount - currentBuilderCount, 0);
  const fixedUpkeepEpt = harvesterTargetCount * calculateBodyCost(plannedHarvesterBody) / creepLifetimeTicks
    + runnerTargetCount * calculateBodyCost(plannedRunnerBody) / creepLifetimeTicks
    + builderTargetCount * calculateBodyCost(plannedBuilderBody) / creepLifetimeTicks;
  const availableUpgraderBudgetEpt = Math.max(totalGrossEpt - fixedUpkeepEpt, 0);
  const currentUpgraderNetEpt = localCreeps
    .filter((creep) => creep.role === "upgrader")
    .reduce((total, creep) => total + calculateObservedUpgraderNetEpt(creep, normalizePathLength(world.primarySpawnToControllerPathLength)), 0);
  const upgraderTargetCount = calculateTargetCount(availableUpgraderBudgetEpt, plannedUpgraderNetEpt);
  const upgraderDeficitCount = calculateTargetCount(Math.max(availableUpgraderBudgetEpt - currentUpgraderNetEpt, 0), plannedUpgraderNetEpt);

  const unmetDemand: Record<WorkerRole, number> = {
    "recovery-worker": 0,
    builder: builderDeficitCount,
    harvester: harvesterDeficitCount,
    runner: runnerDeficitCount,
    upgrader: upgraderDeficitCount
  };
  const inputs: SpawnDemandInputs = {
    harvest: {
      requiredWorkParts: totalRequiredHarvestWork,
      coveredWorkParts: totalCoveredHarvestWork,
      plannedWorkPartsPerCreep: plannedHarvesterWork,
      targetCount: harvesterTargetCount,
      coverage: calculateCoverage(totalCoveredHarvestWork, totalRequiredHarvestWork)
    },
    haul: {
      requiredCarryParts: totalRequiredCarryParts,
      coveredCarryParts: currentCarryParts,
      plannedCarryPartsPerCreep: plannedRunnerCarry,
      targetCount: runnerTargetCount,
      coverage: calculateCoverage(currentCarryParts, totalRequiredCarryParts)
    },
    upgrade: {
      surplusBudgetEpt: availableUpgraderBudgetEpt,
      coveredNetEpt: currentUpgraderNetEpt,
      plannedNetEptPerCreep: plannedUpgraderNetEpt,
      targetCount: upgraderTargetCount,
      coverage: calculateCoverage(currentUpgraderNetEpt, availableUpgraderBudgetEpt)
    }
  };

  return createDemandSummary(unmetDemand, chooseNextNormalRole({
    harvesterCoverage: inputs.harvest.coverage,
    harvesterDeficitCount,
    runnerCoverage: inputs.haul.coverage,
    runnerDeficitCount,
    builderDeficitCount,
    upgraderCoverage: inputs.upgrade.coverage,
    upgraderDeficitCount
  }), inputs);
}

function choosePlanningBody(world: WorldSnapshot, role: WorkerRole): BodyPartConstant[] | null {
  return chooseBody(role, world.primaryRoomEnergyCapacityAvailable ?? world.primaryRoomEnergyAvailable ?? 0);
}

function calculateObservedUpgraderNetEpt(
  creep: WorldSnapshot["creeps"][number],
  spawnToControllerPathLength: number
): number {
  return calculateUpgraderGrossEpt(creep.activeWorkParts, creep.activeCarryParts, spawnToControllerPathLength)
    + creep.bodyCost / creepLifetimeTicks;
}

function calculateUpgraderGrossEpt(workParts: number, carryParts: number, spawnToControllerPathLength: number): number {
  if (workParts <= 0 || carryParts <= 0) {
    return 0;
  }

  const carriedEnergy = carryParts * carryCapacity;
  const cycleTicks = 2 * spawnToControllerPathLength + 1 + carriedEnergy / workParts;
  return carriedEnergy / cycleTicks;
}

function chooseNextNormalRole(input: {
  harvesterCoverage: number;
  harvesterDeficitCount: number;
  runnerCoverage: number;
  runnerDeficitCount: number;
  builderDeficitCount: number;
  upgraderCoverage: number;
  upgraderDeficitCount: number;
}): WorkerRole | null {
  const logisticsCandidates = [
    { role: "harvester" as const, coverage: input.harvesterCoverage, deficitCount: input.harvesterDeficitCount },
    { role: "runner" as const, coverage: input.runnerCoverage, deficitCount: input.runnerDeficitCount }
  ].filter((candidate) => candidate.deficitCount > 0);

  if (logisticsCandidates.length > 0) {
    logisticsCandidates.sort((left, right) => {
      if (left.coverage !== right.coverage) {
        return left.coverage - right.coverage;
      }

      return left.role.localeCompare(right.role);
    });

    return logisticsCandidates[0]?.role ?? null;
  }

  if (input.builderDeficitCount > 0) {
    return "builder";
  }

  if (input.upgraderDeficitCount > 0) {
    return "upgrader";
  }

  return null;
}

function normalizePathLength(pathLength: number | null): number {
  return Math.max(pathLength ?? 0, 0);
}

function calculateCoverage(current: number, required: number): number {
  if (required <= 0) {
    return 1;
  }

  return Math.min(current / required, 1);
}

function calculateTargetCount(requiredCapacity: number, capacityPerCreep: number): number {
  if (requiredCapacity <= 0 || capacityPerCreep <= 0) {
    return 0;
  }

  return Math.ceil(requiredCapacity / capacityPerCreep);
}

function createDemandSummary(
  unmetDemand: Record<WorkerRole, number>,
  nextRole: WorkerRole | null,
  inputs: SpawnDemandInputs
): SpawnDemandSummary {
  return {
    inputs,
    unmetDemand,
    nextRole,
    totalUnmetDemand: Object.values(unmetDemand).reduce((total, value) => total + value, 0)
  };
}

function createEmptyDemandInputs(): SpawnDemandInputs {
  return {
    harvest: {
      requiredWorkParts: 0,
      coveredWorkParts: 0,
      plannedWorkPartsPerCreep: 0,
      targetCount: 0,
      coverage: 1
    },
    haul: {
      requiredCarryParts: 0,
      coveredCarryParts: 0,
      plannedCarryPartsPerCreep: 0,
      targetCount: 0,
      coverage: 1
    },
    upgrade: {
      surplusBudgetEpt: 0,
      coveredNetEpt: 0,
      plannedNetEptPerCreep: 0,
      targetCount: 0,
      coverage: 1
    }
  };
}

function calculateBodyCost(body: BodyPartConstant[]): number {
  return body.reduce((total, part) => total + getBodyPartCost(part), 0);
}

function countBodyParts(body: BodyPartConstant[], part: BodyPartConstant): number {
  return body.filter((bodyPart) => bodyPart === part).length;
}

function getBodyPartCost(part: BodyPartConstant): number {
  switch (part) {
    case WORK:
      return 100;
    case CARRY:
      return 50;
    case MOVE:
      return 50;
    default:
      return 0;
  }
}

function determineRecoveryTargets(siteCount: number): Record<WorkerRole, number> {
  return {
    "recovery-worker": 1,
    builder: 0,
    harvester: siteCount > 0 ? 1 : 0,
    runner: siteCount > 0 ? 1 : 0,
    upgrader: 0
  };
}

function findNextRoleByCount(unmetDemand: Record<WorkerRole, number>, priority: WorkerRole[]): WorkerRole | null {
  for (const role of priority) {
    if (unmetDemand[role] > 0) {
      return role;
    }
  }

  return null;
}
