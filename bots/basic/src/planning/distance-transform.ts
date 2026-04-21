const roomSize = 50;
const roomArea = roomSize * roomSize;
const terrainMaskWall = 1;
const unreachableDistance = 0xff;

export type TerrainDistanceTransform = {
  distances: Uint8Array;
  maxDistance: number;
  get(x: number, y: number): number;
  isBlocked(x: number, y: number): boolean;
};

export function createTerrainDistanceTransform(terrain: string): TerrainDistanceTransform {
  validateTerrain(terrain);

  const distances = initializeDistances(terrain);

  for (let y = 0; y < roomSize; y += 1) {
    const rowOffset = y * roomSize;

    for (let x = 0; x < roomSize; x += 1) {
      const index = rowOffset + x;
      if (distances[index] === 0) {
        continue;
      }

      let bestDistance = distances[index]!;
      if (x > 0) {
        bestDistance = Math.min(bestDistance, distances[index - 1]! + 1);
      }

      if (y > 0) {
        bestDistance = Math.min(bestDistance, distances[index - roomSize]! + 1);
        if (x > 0) {
          bestDistance = Math.min(bestDistance, distances[index - roomSize - 1]! + 1);
        }

        if (x < roomSize - 1) {
          bestDistance = Math.min(bestDistance, distances[index - roomSize + 1]! + 1);
        }
      }

      distances[index] = bestDistance;
    }
  }

  let maxDistance = 0;

  for (let y = roomSize - 1; y >= 0; y -= 1) {
    const rowOffset = y * roomSize;

    for (let x = roomSize - 1; x >= 0; x -= 1) {
      const index = rowOffset + x;
      if (distances[index] === 0) {
        continue;
      }

      let bestDistance = distances[index]!;
      if (x < roomSize - 1) {
        bestDistance = Math.min(bestDistance, distances[index + 1]! + 1);
      }

      if (y < roomSize - 1) {
        bestDistance = Math.min(bestDistance, distances[index + roomSize]! + 1);
        if (x > 0) {
          bestDistance = Math.min(bestDistance, distances[index + roomSize - 1]! + 1);
        }

        if (x < roomSize - 1) {
          bestDistance = Math.min(bestDistance, distances[index + roomSize + 1]! + 1);
        }
      }

      distances[index] = bestDistance;
      if (bestDistance > maxDistance) {
        maxDistance = bestDistance;
      }
    }
  }

  return {
    distances,
    maxDistance,
    get(x: number, y: number): number {
      validateCoordinate(x, y);
      return distances[toIndex(x, y)]!;
    },
    isBlocked(x: number, y: number): boolean {
      validateCoordinate(x, y);
      return distances[toIndex(x, y)] === 0;
    }
  };
}

function initializeDistances(terrain: string): Uint8Array {
  const distances = new Uint8Array(roomArea);

  for (let y = 0; y < roomSize; y += 1) {
    const rowOffset = y * roomSize;

    for (let x = 0; x < roomSize; x += 1) {
      const index = rowOffset + x;
      const terrainCode = terrain.charCodeAt(index) - 48;

      if ((terrainCode & terrainMaskWall) !== 0) {
        distances[index] = 0;
      } else if (x === 0 || y === 0 || x === roomSize - 1 || y === roomSize - 1) {
        distances[index] = 1;
      } else {
        distances[index] = unreachableDistance;
      }
    }
  }

  return distances;
}

function validateTerrain(terrain: string): void {
  if (terrain.length !== roomArea) {
    throw new Error(`Expected terrain string length ${roomArea}, received ${terrain.length}.`);
  }
}

function validateCoordinate(x: number, y: number): void {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= roomSize || y < 0 || y >= roomSize) {
    throw new Error(`Invalid room coordinate (${x}, ${y}).`);
  }
}

function toIndex(x: number, y: number): number {
  return y * roomSize + x;
}
