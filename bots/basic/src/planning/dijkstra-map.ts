const roomSize = 50;
const roomArea = roomSize * roomSize;
const maxNeighbors = 8;
const terrainMaskWall = 1;
const terrainMaskSwamp = 2;

export const dijkstraUnreachable = 0xffffffff;

export type DijkstraGoal = {
  x: number;
  y: number;
};

export type DijkstraCostMatrix = Pick<PathFinder.CostMatrix, "get">;

export type DijkstraMapOptions = {
  plainCost?: number;
  swampCost?: number;
  wallCost?: number | null;
  costMatrix?: DijkstraCostMatrix | null;
};

export type DijkstraMap = {
  distances: Uint32Array;
  movementCosts: Uint32Array;
  get(x: number, y: number): number;
  isBlocked(x: number, y: number): boolean;
};

export function createDijkstraMap(terrain: string, goals: DijkstraGoal[], options: DijkstraMapOptions = {}): DijkstraMap {
  validateTerrain(terrain);
  validateGoals(goals);

  const movementCosts = buildMovementCosts(terrain, options);
  const distances = new Uint32Array(roomArea);
  distances.fill(dijkstraUnreachable);
  const heap = createBinaryHeap();
  const entry: HeapEntry = { cost: 0, index: 0 };

  for (const goal of goals) {
    const index = toIndex(goal.x, goal.y);
    if (distances[index] === 0) {
      continue;
    }

    distances[index] = 0;
    pushHeap(heap, 0, index);
  }

  while (heap.size > 0) {
    if (!popHeap(heap, entry)) {
      break;
    }

    const currentDistance = distances[entry.index];
    if (entry.cost !== currentDistance) {
      continue;
    }

    const neighborOffset = entry.index * maxNeighbors;
    const neighborCount = neighborCounts[entry.index]!;

    for (let neighborIndexOffset = 0; neighborIndexOffset < neighborCount; neighborIndexOffset += 1) {
      const nextIndex = neighborIndexes[neighborOffset + neighborIndexOffset]!;
      const stepCost = movementCosts[nextIndex];
      if (stepCost === dijkstraUnreachable) {
        continue;
      }

      const nextDistance = currentDistance + stepCost;
      if (nextDistance >= distances[nextIndex]) {
        continue;
      }

      distances[nextIndex] = nextDistance;
      pushHeap(heap, nextDistance, nextIndex);
    }
  }

  return {
    distances,
    movementCosts,
    get(x: number, y: number): number {
      validateCoordinate(x, y);
      return distances[toIndex(x, y)];
    },
    isBlocked(x: number, y: number): boolean {
      validateCoordinate(x, y);
      return movementCosts[toIndex(x, y)] === dijkstraUnreachable;
    }
  };
}

function buildMovementCosts(terrain: string, options: DijkstraMapOptions): Uint32Array {
  const plainCost = options.plainCost ?? 2;
  const swampCost = options.swampCost ?? 10;
  const wallCost = options.wallCost ?? null;
  const costMatrix = options.costMatrix ?? null;
  validateBaseCost("plainCost", plainCost);
  validateBaseCost("swampCost", swampCost);
  if (wallCost !== null) {
    validateBaseCost("wallCost", wallCost);
  }

  if (costMatrix === null) {
    return buildMovementCostsWithoutMatrix(terrain, plainCost, swampCost, wallCost);
  }

  return buildMovementCostsWithMatrix(terrain, plainCost, swampCost, wallCost, costMatrix);
}

function buildMovementCostsWithoutMatrix(
  terrain: string,
  plainCost: number,
  swampCost: number,
  wallCost: number | null
): Uint32Array {
  const movementCosts = new Uint32Array(roomArea);
  const blockedWallCost = wallCost ?? dijkstraUnreachable;

  for (let index = 0; index < roomArea; index += 1) {
    const terrainCode = terrain.charCodeAt(index) - 48;
    movementCosts[index] = (terrainCode & terrainMaskWall) !== 0
      ? blockedWallCost
      : (terrainCode & terrainMaskSwamp) !== 0
        ? swampCost
        : plainCost;
  }

  return movementCosts;
}

function buildMovementCostsWithMatrix(
  terrain: string,
  plainCost: number,
  swampCost: number,
  wallCost: number | null,
  costMatrix: DijkstraCostMatrix
): Uint32Array {
  const movementCosts = new Uint32Array(roomArea);
  const blockedWallCost = wallCost ?? dijkstraUnreachable;

  for (let y = 0; y < roomSize; y += 1) {
    const rowOffset = y * roomSize;

    for (let x = 0; x < roomSize; x += 1) {
      const index = rowOffset + x;
      const terrainCode = terrain.charCodeAt(index) - 48;
      let cost = (terrainCode & terrainMaskWall) !== 0
        ? blockedWallCost
        : (terrainCode & terrainMaskSwamp) !== 0
          ? swampCost
          : plainCost;

      if (cost !== dijkstraUnreachable) {
        const matrixCost = costMatrix.get(x, y);
        if (matrixCost >= 255) {
          cost = dijkstraUnreachable;
        } else if (matrixCost > 0) {
          cost = matrixCost;
        }
      }

      movementCosts[index] = cost;
    }
  }

  return movementCosts;
}

function validateTerrain(terrain: string): void {
  if (terrain.length !== roomArea) {
    throw new Error(`Expected terrain string length ${roomArea}, received ${terrain.length}.`);
  }
}

function validateGoals(goals: DijkstraGoal[]): void {
  if (goals.length === 0) {
    throw new Error("Dijkstra map requires at least one goal tile.");
  }

  for (const goal of goals) {
    validateCoordinate(goal.x, goal.y);
  }
}

function validateCoordinate(x: number, y: number): void {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= roomSize || y < 0 || y >= roomSize) {
    throw new Error(`Invalid room coordinate (${x}, ${y}).`);
  }
}

function validateBaseCost(name: string, cost: number): void {
  if (!Number.isInteger(cost) || cost <= 0 || cost >= dijkstraUnreachable) {
    throw new Error(`${name} must be a positive integer below ${dijkstraUnreachable}.`);
  }
}

function toIndex(x: number, y: number): number {
  return y * roomSize + x;
}

type HeapEntry = {
  cost: number;
  index: number;
};

type BinaryHeap = {
  costs: number[];
  indexes: number[];
  size: number;
};

function createBinaryHeap(): BinaryHeap {
  return {
    costs: [],
    indexes: [],
    size: 0
  };
}

function pushHeap(heap: BinaryHeap, cost: number, index: number): void {
  let cursor = heap.size;
  heap.size += 1;
  heap.costs[cursor] = cost;
  heap.indexes[cursor] = index;

  while (cursor > 0) {
    const parent = Math.floor((cursor - 1) / 2);
    if (heap.costs[parent]! <= cost) {
      break;
    }

    heap.costs[cursor] = heap.costs[parent]!;
    heap.indexes[cursor] = heap.indexes[parent]!;
    cursor = parent;
  }

  heap.costs[cursor] = cost;
  heap.indexes[cursor] = index;
}

function popHeap(heap: BinaryHeap, entry: HeapEntry): boolean {
  if (heap.size === 0) {
    return false;
  }

  entry.cost = heap.costs[0]!;
  entry.index = heap.indexes[0]!;
  heap.size -= 1;

  if (heap.size === 0) {
    return true;
  }

  const lastCost = heap.costs[heap.size]!;
  const lastIndex = heap.indexes[heap.size]!;
  let cursor = 0;

  while (true) {
    const left = cursor * 2 + 1;
    const right = left + 1;
    if (left >= heap.size) {
      break;
    }

    let child = left;
    if (right < heap.size && heap.costs[right]! < heap.costs[left]!) {
      child = right;
    }

    if (heap.costs[child]! >= lastCost) {
      break;
    }

    heap.costs[cursor] = heap.costs[child]!;
    heap.indexes[cursor] = heap.indexes[child]!;
    cursor = child;
  }

  heap.costs[cursor] = lastCost;
  heap.indexes[cursor] = lastIndex;

  return true;
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
