import { countActiveBodyParts } from "../core/body-parts";
import type { CreepSnapshot, OwnedControllerSnapshot, SourceSnapshot, WorldSnapshot } from "../core/types";

export function observeWorld(): WorldSnapshot {
  const primarySpawn = Object.values(Game.spawns)[0] ?? null;
  const primaryRoom = primarySpawn?.room ?? Object.values(Game.rooms).find((room) => room.controller?.my) ?? null;
  const constructionSites = Object.values(Game.constructionSites ?? {});
  const creeps = snapshotCreeps();
  const sources = snapshotPrimarySources(primaryRoom);

  return {
    gameTime: Game.time,
    primarySpawnName: primarySpawn?.name ?? null,
    primarySpawnConstructionSiteCount: countPrimarySpawnConstructionSites(primaryRoom?.name ?? null, constructionSites),
    primarySpawnSpawning: primarySpawn ? primarySpawn.spawning !== null : null,
    primaryRoomName: primaryRoom?.name ?? null,
    primaryRoomEnergyAvailable: primaryRoom?.energyAvailable ?? null,
    primaryRoomEnergyCapacityAvailable: primaryRoom?.energyCapacityAvailable ?? null,
    primaryController: snapshotOwnedController(primaryRoom?.controller),
    maxOwnedControllerLevel: findMaxOwnedControllerLevel(),
    totalCreeps: creeps.length,
    creepsByRole: countCreepsByRole(creeps),
    creeps,
    sources
  };
}

function countPrimarySpawnConstructionSites(roomName: string | null, constructionSites: ConstructionSite[]): number {
  if (roomName === null) {
    return 0;
  }

  return constructionSites.filter((site) => site.pos.roomName === roomName && site.structureType === STRUCTURE_SPAWN).length;
}

function snapshotOwnedController(controller: StructureController | undefined): OwnedControllerSnapshot | null {
  if (!controller?.my) {
    return null;
  }

  return {
    level: controller.level,
    progress: controller.progress ?? null,
    progressTotal: controller.progressTotal ?? null
  };
}

function findMaxOwnedControllerLevel(): number {
  let maxLevel = 0;

  for (const room of Object.values(Game.rooms)) {
    if (room.controller?.my) {
      maxLevel = Math.max(maxLevel, room.controller.level);
    }
  }

  return maxLevel;
}

function countCreepsByRole(creeps: CreepSnapshot[]): Record<WorkerRole, number> {
  const counts: Record<WorkerRole, number> = {
    "recovery-worker": 0,
    harvester: 0,
    runner: 0,
    upgrader: 0
  };

  for (const creep of creeps) {
    counts[creep.role] += 1;
  }

  return counts;
}

function snapshotCreeps(): CreepSnapshot[] {
  return Object.values(Game.creeps).map((creep) => ({
    name: creep.name,
    role: creep.memory.role,
    homeRoom: creep.memory.homeRoom,
    roomName: creep.room.name,
    working: Boolean(creep.memory.working),
    activeWorkParts: countActiveBodyParts(creep, WORK),
    storeEnergy: creep.store[RESOURCE_ENERGY] ?? 0,
    freeCapacity: creep.store.getFreeCapacity(RESOURCE_ENERGY)
  }));
}

function snapshotPrimarySources(primaryRoom: Room | null): SourceSnapshot[] {
  if (primaryRoom === null) {
    return [];
  }

  return primaryRoom.find(FIND_SOURCES).map((source) => ({
    sourceId: source.id,
    roomName: source.room.name,
    x: source.pos.x,
    y: source.pos.y,
    energy: source.energy,
    energyCapacity: source.energyCapacity,
    ticksToRegeneration: source.ticksToRegeneration ?? null
  }));
}
