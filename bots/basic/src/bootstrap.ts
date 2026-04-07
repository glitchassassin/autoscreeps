const extensionCapByRcl: Record<number, number> = {
  1: 0,
  2: 5,
  3: 10,
  4: 20,
  5: 30,
  6: 40,
  7: 50,
  8: 60
};

export function ensureBootstrapInfrastructure(): void {
  ensureBootstrapSpawn();
  ensureBootstrapExtensions();
}

export function ensureBootstrapSpawn(): void {
  for (const room of Object.values(Game.rooms)) {
    const controller = room.controller;
    if (!controller?.my) {
      continue;
    }

    if (room.find(FIND_MY_SPAWNS).length > 0) {
      continue;
    }

    const existingSite = room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: (site) => site.structureType === STRUCTURE_SPAWN
    });
    if (existingSite.length > 0) {
      continue;
    }

    const spawnName = `${room.name}-bootstrap`;
    for (const { x, y } of findSpawnCandidates(room, controller.pos)) {
      const result = room.createConstructionSite(x, y, STRUCTURE_SPAWN, spawnName);
      if (result === OK) {
        console.log(`[bootstrap] requested first spawn in ${room.name} at ${x},${y}`);
        break;
      }
    }
  }
}

export function ensureBootstrapExtensions(): void {
  for (const room of Object.values(Game.rooms)) {
    const controller = room.controller;
    if (!controller?.my || controller.level < 3) {
      continue;
    }

    const spawn = room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) {
      continue;
    }

    if (countRole(room.name, "courier") === 0 || countRole(room.name, "worker") === 0) {
      continue;
    }

    if (countRoomCreeps(room.name) < 4) {
      continue;
    }

    const builtExtensions = room.find(FIND_MY_STRUCTURES, {
      filter: (structure) => structure.structureType === STRUCTURE_EXTENSION
    }).length;
    const extensionSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
      filter: (site) => site.structureType === STRUCTURE_EXTENSION
    }).length;
    const extensionCap = extensionCapByRcl[controller.level] ?? 0;

    if (builtExtensions + extensionSites >= extensionCap || extensionSites > 0) {
      continue;
    }

    const energyThreshold = Math.min(room.energyCapacityAvailable, 350);
    if (room.energyAvailable < energyThreshold) {
      continue;
    }

    for (const { x, y } of findBuildCandidates(room, spawn.pos)) {
      const result = room.createConstructionSite(x, y, STRUCTURE_EXTENSION);
      if (result === OK) {
        console.log(`[bootstrap] requested extension in ${room.name} at ${x},${y}`);
        break;
      }
    }
  }
}

function findSpawnCandidates(room: Room, origin: RoomPosition): Array<{ x: number; y: number }> {
  const terrain = room.getTerrain();
  const candidates: Array<{ x: number; y: number; score: number }> = [];

  for (let y = 2; y <= 47; y += 1) {
    for (let x = 2; x <= 47; x += 1) {
      if (x === origin.x && y === origin.y) {
        continue;
      }

      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        continue;
      }

      const dx = x - origin.x;
      const dy = y - origin.y;
      const range = Math.max(Math.abs(dx), Math.abs(dy));
      const distance = Math.abs(dx) + Math.abs(dy);
      candidates.push({ x, y, score: range * 100 + distance });
    }
  }

  candidates.sort((left, right) => left.score - right.score);

  return candidates;
}

function findBuildCandidates(room: Room, origin: RoomPosition): Array<{ x: number; y: number }> {
  return findSpawnCandidates(room, origin);
}

function countRoomCreeps(roomName: string): number {
  let total = 0;

  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.homeRoom === roomName) {
      total += 1;
    }
  }

  return total;
}

function countRole(roomName: string, role: WorkerRole): number {
  let total = 0;

  for (const creep of Object.values(Game.creeps)) {
    if (creep.memory.homeRoom === roomName && creep.memory.role === role) {
      total += 1;
    }
  }

  return total;
}
