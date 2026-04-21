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

  const distances = new Uint8Array(initialWalkableDistances);
  let maxDistance = initializeDistances(terrain, distances);

  for (let y = 1; y < roomSize - 1; y += 1) {
    const rowOffset = y * roomSize;

    for (let x = 1; x < roomSize - 1; x += 1) {
      const index = rowOffset + x;
      if (distances[index] === 0) {
        continue;
      }

      let bestDistance = distances[index]!;
      let candidateDistance = distances[index - 1]! + 1;
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
      }

      candidateDistance = distances[index - roomSize]! + 1;
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
      }

      candidateDistance = distances[index - roomSize - 1]! + 1;
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
      }

      candidateDistance = distances[index - roomSize + 1]! + 1;
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
      }

      distances[index] = bestDistance;
    }
  }

  for (let y = roomSize - 2; y > 0; y -= 1) {
    const rowOffset = y * roomSize;

    for (let x = roomSize - 2; x > 0; x -= 1) {
      const index = rowOffset + x;
      if (distances[index] === 0) {
        continue;
      }

      let bestDistance = distances[index]!;
      let candidateDistance = distances[index + 1]! + 1;
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
      }

      candidateDistance = distances[index + roomSize]! + 1;
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
      }

      candidateDistance = distances[index + roomSize - 1]! + 1;
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
      }

      candidateDistance = distances[index + roomSize + 1]! + 1;
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
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

function initializeDistances(terrain: string, distances: Uint8Array): number {
  let maxDistance = 0;
  for (let index = 0; index < roomArea; index += 1) {
    const terrainCode = terrain.charCodeAt(index) - 48;
    if ((terrainCode & terrainMaskWall) !== 0) {
      distances[index] = 0;
      continue;
    }

    if (distances[index] === 1) {
      maxDistance = 1;
    }
  }

  return maxDistance;
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

function createInitialWalkableDistances(): Uint8Array {
  const distances = new Uint8Array(roomArea);
  distances.fill(unreachableDistance);

  for (let x = 0; x < roomSize; x += 1) {
    distances[x] = 1;
    distances[(roomSize - 1) * roomSize + x] = 1;
  }

  for (let y = 1; y < roomSize - 1; y += 1) {
    const rowOffset = y * roomSize;
    distances[rowOffset] = 1;
    distances[rowOffset + roomSize - 1] = 1;
  }

  return distances;
}

const initialWalkableDistances = createInitialWalkableDistances();
