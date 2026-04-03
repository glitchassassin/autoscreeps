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
