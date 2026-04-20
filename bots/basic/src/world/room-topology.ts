export type RoomSector = {
  x: number;
  y: number;
};

export function getRoomSector(roomName: string): RoomSector {
  const match = roomName.match(/^(W|E)(\d+)(N|S)(\d+)$/);
  if (!match) {
    throw new Error(`Invalid room name '${roomName}'.`);
  }

  return {
    x: Number(match[2]) % 10,
    y: Number(match[4]) % 10
  };
}

export function isHighwayRoom(roomName: string): boolean {
  const sector = getRoomSector(roomName);
  return sector.x === 0 || sector.y === 0;
}

export function isSourceKeeperRoom(roomName: string): boolean {
  const sector = getRoomSector(roomName);
  return !isHighwayRoom(roomName)
    && sector.x >= 4
    && sector.x <= 6
    && sector.y >= 4
    && sector.y <= 6
    && !(sector.x === 5 && sector.y === 5);
}
