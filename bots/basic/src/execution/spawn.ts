import type { SpawnPlan } from "../core/types";

export function executeSpawnPlan(plan: SpawnPlan): ScreepsReturnCode | null {
  if (plan.bootstrapRoomName) {
    return placeBootstrapSpawn(plan.bootstrapRoomName);
  }

  const request = plan.request;
  if (request === null) {
    return null;
  }

  const spawn = Game.spawns[request.spawnName];
  if (!spawn || spawn.spawning) {
    return null;
  }

  return spawn.spawnCreep(request.body, request.name, { memory: request.memory });
}

function placeBootstrapSpawn(roomName: string): ScreepsReturnCode | null {
  const room = Game.rooms[roomName];
  if (!room?.controller?.my) {
    return null;
  }

  for (const candidate of buildBootstrapCandidates(room.controller.pos)) {
    const result = room.createConstructionSite(candidate.x, candidate.y, STRUCTURE_SPAWN);
    if (result === OK) {
      return result;
    }
  }

  return null;
}

function buildBootstrapCandidates(origin: RoomPosition): Array<{ x: number; y: number }> {
  const candidates: Array<{ x: number; y: number }> = [];

  for (let radius = 3; radius <= 20; radius += 1) {
    for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
      for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
        if (Math.max(Math.abs(x - origin.x), Math.abs(y - origin.y)) !== radius) {
          continue;
        }
        if (x <= 1 || x >= 48 || y <= 1 || y >= 48) {
          continue;
        }

        candidates.push({ x, y });
      }
    }
  }

  return candidates;
}
