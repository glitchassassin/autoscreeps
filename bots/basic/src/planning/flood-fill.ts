/*
 * If you change the traversal loop or neighbor handling, rerun:
 * - `npm test -- test/flood-fill.test.ts`
 * - `npm run benchmark:flood-fill`
 * - `npm run benchmark:flood-fill -- --warmup=5 --samples=3 --iterations=2`
 */
const roomSize = 50;
const roomArea = roomSize * roomSize;
const maxNeighbors = 8;

export type FloodFillSeed = {
  x: number;
  y: number;
};

export type FloodFillResult = {
  visited: Uint8Array;
  visitedCount: number;
  contains(x: number, y: number): boolean;
};

export function createFloodFill(mask: Uint8Array, seeds: FloodFillSeed[]): FloodFillResult {
  validateMask(mask);
  validateSeeds(seeds);

  const visited = new Uint8Array(roomArea);
  const queue = new Uint16Array(roomArea);
  let head = 0;
  let tail = 0;
  let visitedCount = 0;

  for (const seed of seeds) {
    const index = toIndex(seed.x, seed.y);
    if (mask[index] === 0 || visited[index] !== 0) {
      continue;
    }

    visited[index] = 1;
    visitedCount += 1;
    queue[tail] = index;
    tail += 1;
  }

  while (head < tail) {
    const index = queue[head]!;
    head += 1;

    const neighborOffset = index * maxNeighbors;
    const neighborCount = neighborCounts[index]!;

    for (let neighborIndexOffset = 0; neighborIndexOffset < neighborCount; neighborIndexOffset += 1) {
      const nextIndex = neighborIndexes[neighborOffset + neighborIndexOffset]!;
      if (mask[nextIndex] === 0 || visited[nextIndex] !== 0) {
        continue;
      }

      visited[nextIndex] = 1;
      visitedCount += 1;
      queue[tail] = nextIndex;
      tail += 1;
    }
  }

  return {
    visited,
    visitedCount,
    contains(x: number, y: number): boolean {
      validateCoordinate(x, y);
      return visited[toIndex(x, y)] !== 0;
    }
  };
}

function validateMask(mask: Uint8Array): void {
  if (mask.length !== roomArea) {
    throw new Error(`Expected flood-fill mask length ${roomArea}, received ${mask.length}.`);
  }
}

function validateSeeds(seeds: FloodFillSeed[]): void {
  if (seeds.length === 0) {
    throw new Error("Flood fill requires at least one seed tile.");
  }

  for (const seed of seeds) {
    validateCoordinate(seed.x, seed.y);
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

const { neighborCounts, neighborIndexes } = createNeighborLookup();

function createNeighborLookup(): { neighborCounts: Uint8Array; neighborIndexes: Int16Array } {
  const counts = new Uint8Array(roomArea);
  const indexes = new Int16Array(roomArea * maxNeighbors);

  for (let index = 0; index < roomArea; index += 1) {
    const x = index % roomSize;
    const hasWest = x > 0;
    const hasEast = x < roomSize - 1;
    const hasNorth = index >= roomSize;
    const hasSouth = index < roomArea - roomSize;
    const offset = index * maxNeighbors;
    let count = 0;

    if (hasEast) {
      indexes[offset + count] = index + 1;
      count += 1;
    }
    if (hasWest) {
      indexes[offset + count] = index - 1;
      count += 1;
    }
    if (hasSouth) {
      indexes[offset + count] = index + roomSize;
      count += 1;
    }
    if (hasNorth) {
      indexes[offset + count] = index - roomSize;
      count += 1;
    }
    if (hasEast && hasSouth) {
      indexes[offset + count] = index + roomSize + 1;
      count += 1;
    }
    if (hasEast && hasNorth) {
      indexes[offset + count] = index - roomSize + 1;
      count += 1;
    }
    if (hasWest && hasSouth) {
      indexes[offset + count] = index + roomSize - 1;
      count += 1;
    }
    if (hasWest && hasNorth) {
      indexes[offset + count] = index - roomSize - 1;
      count += 1;
    }

    counts[index] = count;
  }

  return {
    neighborCounts: counts,
    neighborIndexes: indexes
  };
}
