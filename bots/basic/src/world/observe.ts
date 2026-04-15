import type { OwnedControllerSnapshot, WorldSnapshot } from "../core/types";

export function observeWorld(): WorldSnapshot {
  const primarySpawn = Object.values(Game.spawns)[0] ?? null;
  const primaryRoom = primarySpawn?.room ?? Object.values(Game.rooms).find((room) => room.controller?.my) ?? null;
  const constructionSites = Object.values(Game.constructionSites ?? {});

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
    totalCreeps: Object.keys(Game.creeps).length,
    creepsByRole: countCreepsByRole()
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

function countCreepsByRole(): Record<WorkerRole, number> {
  const counts: Record<WorkerRole, number> = {
    worker: 0
  };

  for (const creep of Object.values(Game.creeps)) {
    counts[creep.memory.role] += 1;
  }

  return counts;
}
