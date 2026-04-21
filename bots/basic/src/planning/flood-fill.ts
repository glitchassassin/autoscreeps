/*
 * Optimization notes for future edits:
 * Benchmarked with `npm run benchmark:flood-fill -- --warmup=100
 * --samples=60 --iterations=75 --per-room-iterations=100` over the 144
 * `botarena-212` planner-candidate rooms. The benchmark uses a walkable terrain
 * mask and seeds from walkable tiles in range 1 of the selected room objects.
 *
 * Kept because they helped:
 * - reused module-scope frontier stack instead of allocating a queue per fill
 * - LIFO stack traversal instead of FIFO queue traversal
 * - interior-tile fast path using fixed neighbor offsets, with lookup fallback
 *   for edge tiles
 * - reusable visit-marker grid for traversal state, while still returning a
 *   fresh `visited` grid to callers
 *
 * Tried and rejected because they regressed or were not worth the complexity:
 * - scanline/span flood fill (worse on 50x50 Screeps room masks)
 * - padded-border mask with fixed offsets (~5.6% median win over lookup, but
 *   slightly worse p95 and extra API/data-shape complexity)
 *
 * Do not rely on absolute timings from past runs. Different machines and thermal
 * conditions shift the raw numbers. For future changes, benchmark before and
 * after the modification on the current machine to measure the real impact.
 *
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
  const visitMarker = nextVisitMarker();
  let stackSize = 0;
  let visitedCount = 0;

  for (const seed of seeds) {
    const index = toIndex(seed.x, seed.y);
    if (mask[index] === 0 || visitMarkers[index] === visitMarker) {
      continue;
    }

    visitMarkers[index] = visitMarker;
    visited[index] = 1;
    visitedCount += 1;
    traversalStack[stackSize] = index;
    stackSize += 1;
  }

  while (stackSize > 0) {
    stackSize -= 1;
    const index = traversalStack[stackSize]!;

    if (interiorTiles[index] !== 0) {
      let nextIndex = index + 1;
      if (mask[nextIndex] !== 0 && visitMarkers[nextIndex] !== visitMarker) {
        visitMarkers[nextIndex] = visitMarker;
        visited[nextIndex] = 1;
        visitedCount += 1;
        traversalStack[stackSize] = nextIndex;
        stackSize += 1;
      }

      nextIndex = index - 1;
      if (mask[nextIndex] !== 0 && visitMarkers[nextIndex] !== visitMarker) {
        visitMarkers[nextIndex] = visitMarker;
        visited[nextIndex] = 1;
        visitedCount += 1;
        traversalStack[stackSize] = nextIndex;
        stackSize += 1;
      }

      nextIndex = index + roomSize;
      if (mask[nextIndex] !== 0 && visitMarkers[nextIndex] !== visitMarker) {
        visitMarkers[nextIndex] = visitMarker;
        visited[nextIndex] = 1;
        visitedCount += 1;
        traversalStack[stackSize] = nextIndex;
        stackSize += 1;
      }

      nextIndex = index - roomSize;
      if (mask[nextIndex] !== 0 && visitMarkers[nextIndex] !== visitMarker) {
        visitMarkers[nextIndex] = visitMarker;
        visited[nextIndex] = 1;
        visitedCount += 1;
        traversalStack[stackSize] = nextIndex;
        stackSize += 1;
      }

      nextIndex = index + roomSize + 1;
      if (mask[nextIndex] !== 0 && visitMarkers[nextIndex] !== visitMarker) {
        visitMarkers[nextIndex] = visitMarker;
        visited[nextIndex] = 1;
        visitedCount += 1;
        traversalStack[stackSize] = nextIndex;
        stackSize += 1;
      }

      nextIndex = index - roomSize + 1;
      if (mask[nextIndex] !== 0 && visitMarkers[nextIndex] !== visitMarker) {
        visitMarkers[nextIndex] = visitMarker;
        visited[nextIndex] = 1;
        visitedCount += 1;
        traversalStack[stackSize] = nextIndex;
        stackSize += 1;
      }

      nextIndex = index + roomSize - 1;
      if (mask[nextIndex] !== 0 && visitMarkers[nextIndex] !== visitMarker) {
        visitMarkers[nextIndex] = visitMarker;
        visited[nextIndex] = 1;
        visitedCount += 1;
        traversalStack[stackSize] = nextIndex;
        stackSize += 1;
      }

      nextIndex = index - roomSize - 1;
      if (mask[nextIndex] !== 0 && visitMarkers[nextIndex] !== visitMarker) {
        visitMarkers[nextIndex] = visitMarker;
        visited[nextIndex] = 1;
        visitedCount += 1;
        traversalStack[stackSize] = nextIndex;
        stackSize += 1;
      }

      continue;
    }

    const neighborOffset = index * maxNeighbors;
    const neighborCount = neighborCounts[index]!;

    for (let neighborIndexOffset = 0; neighborIndexOffset < neighborCount; neighborIndexOffset += 1) {
      const nextIndex = neighborIndexes[neighborOffset + neighborIndexOffset]!;
      if (mask[nextIndex] === 0 || visitMarkers[nextIndex] === visitMarker) {
        continue;
      }

      visitMarkers[nextIndex] = visitMarker;
      visited[nextIndex] = 1;
      visitedCount += 1;
      traversalStack[stackSize] = nextIndex;
      stackSize += 1;
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

function nextVisitMarker(): number {
  if (visitMarker >= 0xfffe) {
    visitMarkers.fill(0);
    visitMarker = 0;
  }

  visitMarker += 1;
  return visitMarker;
}

// Reuse the frontier buffer across calls; this hot path is synchronous and the
// function returns a fresh visited grid, so scratch reuse is safe.
const traversalStack = new Uint16Array(roomArea);
const visitMarkers = new Uint16Array(roomArea);
const { neighborCounts, neighborIndexes } = createNeighborLookup();
const interiorTiles = createInteriorTiles();
let visitMarker = 0;

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

function createInteriorTiles(): Uint8Array {
  const tiles = new Uint8Array(roomArea);

  for (let y = 1; y < roomSize - 1; y += 1) {
    const rowOffset = y * roomSize;
    for (let x = 1; x < roomSize - 1; x += 1) {
      tiles[rowOffset + x] = 1;
    }
  }

  return tiles;
}
