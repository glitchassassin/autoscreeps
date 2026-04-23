const roomSize = 50;
const terrainMaskWall = 1;

export type ConstructionSiteStructureType =
  | "spawn"
  | "extension"
  | "road"
  | "constructedWall"
  | "rampart"
  | "link"
  | "storage"
  | "tower"
  | "observer"
  | "powerSpawn"
  | "extractor"
  | "lab"
  | "terminal"
  | "container"
  | "nuker"
  | "factory";

export function isConstructionSiteTerrainAllowed(
  terrain: string,
  structureType: ConstructionSiteStructureType,
  x: number,
  y: number
): boolean {
  if (!isConstructionSiteCoordinate(x, y)) {
    return false;
  }

  if (requiresWalledExitAdjacency(structureType, x, y) && !hasWalledExitAdjacency(terrain, x, y)) {
    return false;
  }

  if (structureType === "extractor") {
    return true;
  }

  return structureType === "road" || !isWallTerrain(terrain, x, y);
}

export function isRoadPlanningTerrain(terrain: string, x: number, y: number): boolean {
  return isConstructionSiteTerrainAllowed(terrain, "road", x, y) && !isWallTerrain(terrain, x, y);
}

export function isWalkableTerrain(terrain: string, x: number, y: number): boolean {
  return isInRoom(x, y) && !isWallTerrain(terrain, x, y);
}

export function isConstructionSiteCoordinate(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x > 0 && x < roomSize - 1 && y > 0 && y < roomSize - 1;
}

function requiresWalledExitAdjacency(structureType: ConstructionSiteStructureType, x: number, y: number): boolean {
  return structureType !== "road"
    && structureType !== "container"
    && (x === 1 || x === roomSize - 2 || y === 1 || y === roomSize - 2);
}

function hasWalledExitAdjacency(terrain: string, x: number, y: number): boolean {
  const borderTiles = getScreepsBorderTiles(x, y);
  return borderTiles.every((coord) => isWallTerrain(terrain, coord.x, coord.y));
}

function getScreepsBorderTiles(x: number, y: number): Array<{ x: number; y: number }> {
  let borderTiles: Array<{ x: number; y: number }> = [];
  if (x === 1) {
    borderTiles = [{ x: 0, y: y - 1 }, { x: 0, y }, { x: 0, y: y + 1 }];
  }
  if (x === roomSize - 2) {
    borderTiles = [{ x: roomSize - 1, y: y - 1 }, { x: roomSize - 1, y }, { x: roomSize - 1, y: y + 1 }];
  }
  if (y === 1) {
    borderTiles = [{ x: x - 1, y: 0 }, { x, y: 0 }, { x: x + 1, y: 0 }];
  }
  if (y === roomSize - 2) {
    borderTiles = [{ x: x - 1, y: roomSize - 1 }, { x, y: roomSize - 1 }, { x: x + 1, y: roomSize - 1 }];
  }
  return borderTiles;
}

function isWallTerrain(terrain: string, x: number, y: number): boolean {
  return isInRoom(x, y) && (terrain.charCodeAt(y * roomSize + x) - 48 & terrainMaskWall) !== 0;
}

function isInRoom(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < roomSize && y >= 0 && y < roomSize;
}
