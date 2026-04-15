import type { CreepPlan, SitePlan, WorldSnapshot } from "../core/types";

const sourceRegenTicks = 300;

export function createSitePlans(world: WorldSnapshot): SitePlan[] {
  const sites = world.sources
    .toSorted((left, right) => left.sourceId.localeCompare(right.sourceId))
    .map((source) => ({
      siteId: source.sourceId,
      sourceId: source.sourceId,
      roomName: source.roomName,
      theoreticalGrossEpt: source.energyCapacity / sourceRegenTicks,
      plannedGrossEpt: 0,
      assignedWorkParts: 0,
      assignedHarvesterNames: []
    }));

  const harvesters = world.creeps
    .filter((creep) => creep.role === "harvester" && creep.homeRoom === world.primaryRoomName)
    .toSorted((left, right) => left.name.localeCompare(right.name));

  for (const harvester of harvesters) {
    const site = chooseLeastStaffedSite(sites);
    if (!site) {
      continue;
    }

    site.assignedHarvesterNames.push(harvester.name);
    site.assignedWorkParts += harvester.activeWorkParts;
    site.plannedGrossEpt = Math.min(site.theoreticalGrossEpt, site.assignedWorkParts * 2);
  }

  return sites;
}

export function createCreepPlans(world: WorldSnapshot, sites: SitePlan[]): Record<string, CreepPlan> {
  const creepPlans: Record<string, CreepPlan> = {};
  const assignments = new Map<string, string>();

  for (const site of sites) {
    for (const creepName of site.assignedHarvesterNames) {
      assignments.set(creepName, site.sourceId);
    }
  }

  for (const creep of world.creeps) {
    creepPlans[creep.name] = {
      creepName: creep.name,
      role: creep.role,
      sourceId: assignments.get(creep.name) ?? null
    };
  }

  return creepPlans;
}

function chooseLeastStaffedSite(sites: SitePlan[]): SitePlan | null {
  if (sites.length === 0) {
    return null;
  }

  let bestSite = sites[0]!;
  for (const site of sites) {
    if (site.assignedWorkParts < bestSite.assignedWorkParts) {
      bestSite = site;
      continue;
    }

    if (site.assignedWorkParts === bestSite.assignedWorkParts && site.sourceId < bestSite.sourceId) {
      bestSite = site;
    }
  }

  return bestSite;
}
