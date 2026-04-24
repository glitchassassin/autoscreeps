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
      assignedHarvesterNames: [],
      harvesterSlots: [...source.harvestSlots]
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
  const assignments = new Map<string, { sourceId: string; sourceSlot: CreepPlan["sourceSlot"] }>();

  for (const site of sites) {
    for (const [index, creepName] of site.assignedHarvesterNames.entries()) {
      assignments.set(creepName, {
        sourceId: site.sourceId,
        sourceSlot: site.harvesterSlots[index % site.harvesterSlots.length] ?? null
      });
    }
  }

  for (const creep of world.creeps) {
    const assignment = assignments.get(creep.name);
    creepPlans[creep.name] = {
      creepName: creep.name,
      role: creep.role,
      sourceId: assignment?.sourceId ?? null,
      sourceSlot: assignment?.sourceSlot ?? null
    };
  }

  return creepPlans;
}

function chooseLeastStaffedSite(sites: SitePlan[]): SitePlan | null {
  const candidates = sites.filter((site) => hasOpenHarvesterCapacity(site));
  if (candidates.length === 0) {
    return null;
  }

  let bestSite = candidates[0]!;
  for (const site of candidates) {
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

function hasOpenHarvesterCapacity(site: SitePlan): boolean {
  return site.harvesterSlots.length > site.assignedHarvesterNames.length
    && site.assignedWorkParts < Math.ceil(site.theoreticalGrossEpt / 2);
}
