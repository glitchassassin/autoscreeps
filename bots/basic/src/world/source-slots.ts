import type { RoomPositionSnapshot } from "../core/types";

const adjacentOffsets: Array<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1]
];

export function getSourceHarvestSlots(source: Source): RoomPositionSnapshot[] {
  const terrain = typeof source.room.getTerrain === "function" ? source.room.getTerrain() : null;

  return adjacentOffsets
    .map(([dx, dy]) => ({
      roomName: source.pos.roomName,
      x: source.pos.x + dx,
      y: source.pos.y + dy
    }))
    .filter((position) =>
      isRoomInterior(position.x, position.y)
      && (terrain?.get(position.x, position.y) ?? 0) !== TERRAIN_MASK_WALL
    )
    .sort(comparePositionSnapshots);
}

export function createRoomPositionFromSnapshot(position: RoomPositionSnapshot): RoomPosition {
  return new RoomPosition(position.x, position.y, position.roomName);
}

function isRoomInterior(x: number, y: number): boolean {
  return x > 0 && x < 49 && y > 0 && y < 49;
}

function comparePositionSnapshots(left: RoomPositionSnapshot, right: RoomPositionSnapshot): number {
  return left.y - right.y || left.x - right.x || left.roomName.localeCompare(right.roomName);
}
