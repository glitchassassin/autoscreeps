/*
 * Optimization notes for future edits:
 * Benchmarked with `caffeinate -dimsu npm run benchmark:dijkstra` over the 144
 * `botarena-212` planner-candidate rooms, seeded from each controller, with
 * `plain=2`, `swamp=10`, `wall=blocked`.
 *
 * Kept because they helped:
 * - precomputed neighbor lookup instead of per-pop direction math
 * - split no-`CostMatrix` fast path plus `terrain.charCodeAt(index) - 48`
 * - reused heap pop storage instead of allocating `{ cost, index }` per pop
 * - bucketed priority queue for room-scale costs, then a cyclic Dial queue
 *
 * Tried and rejected because they regressed:
 * - typed-array heap storage (~6% slower)
 * - unchecked fast path that skipped public validation (~3% slower)
 * - 4-ary heap (worse median and much worse tail latency)
 *
 * Do not rely on absolute timings from past runs. Different machines and thermal
 * conditions shift the raw numbers. For future changes, benchmark before and
 * after the modification on the current machine to measure the real impact.
 *
 * If you change the queue or hot loops, rerun:
 * - `npm test -- test/dijkstra-map.test.ts`
 * - `caffeinate -dimsu npm run benchmark:dijkstra`
 * - `npm run benchmark:dijkstra -- --wall-cost=50 --warmup=5 --samples=3 --iterations=2`
 */
const roomSize = 50;
const roomArea = roomSize * roomSize;
const maxNeighbors = 8;
const maxQueueEntries = roomArea * (maxNeighbors + 1);
const maxBucketWidth = 4096;
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

type MovementCostGrid = {
  movementCosts: Uint32Array;
  maxStepCost: number;
};

type HeapEntry = {
  cost: number;
  index: number;
};

type BinaryHeap = {
  costs: number[];
  indexes: number[];
  size: number;
};

type BucketQueue = {
  heads: Int32Array;
  next: Int32Array;
  indexes: Uint16Array;
  size: number;
  entryCount: number;
  currentCost: number;
};

export function createDijkstraMap(terrain: string, goals: DijkstraGoal[], options: DijkstraMapOptions = {}): DijkstraMap {
  validateTerrain(terrain);
  validateGoals(goals);

  const movementCostGrid = buildMovementCosts(terrain, options);
  const distances = shouldUseBucketQueue(movementCostGrid.maxStepCost)
    ? buildDistancesWithBucketQueue(goals, movementCostGrid.movementCosts, movementCostGrid.maxStepCost)
    : buildDistancesWithHeap(goals, movementCostGrid.movementCosts);

  return {
    distances,
    movementCosts: movementCostGrid.movementCosts,
    get(x: number, y: number): number {
      validateCoordinate(x, y);
      return distances[toIndex(x, y)];
    },
    isBlocked(x: number, y: number): boolean {
      validateCoordinate(x, y);
      return movementCostGrid.movementCosts[toIndex(x, y)] === dijkstraUnreachable;
    }
  };
}

function buildDistancesWithHeap(goals: DijkstraGoal[], movementCosts: Uint32Array): Uint32Array {
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

  return distances;
}

function buildDistancesWithBucketQueue(goals: DijkstraGoal[], movementCosts: Uint32Array, maxStepCost: number): Uint32Array {
  const distances = new Uint32Array(roomArea);
  distances.fill(dijkstraUnreachable);
  const queue = createBucketQueue(maxStepCost + 1);
  const entry: HeapEntry = { cost: 0, index: 0 };

  for (const goal of goals) {
    const index = toIndex(goal.x, goal.y);
    if (distances[index] === 0) {
      continue;
    }

    distances[index] = 0;
    pushBucket(queue, 0, index);
  }

  while (queue.size > 0) {
    if (!popBucket(queue, entry)) {
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
      pushBucket(queue, nextDistance, nextIndex);
    }
  }

  return distances;
}

function shouldUseBucketQueue(maxStepCost: number): boolean {
  return maxStepCost > 0 && maxStepCost < maxBucketWidth;
}

function buildMovementCosts(terrain: string, options: DijkstraMapOptions): MovementCostGrid {
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
): MovementCostGrid {
  const movementCosts = new Uint32Array(roomArea);
  const blockedWallCost = wallCost ?? dijkstraUnreachable;
  let maxStepCost = 0;

  for (let index = 0; index < roomArea; index += 1) {
    const terrainCode = terrain.charCodeAt(index) - 48;
    const cost = (terrainCode & terrainMaskWall) !== 0
      ? blockedWallCost
      : (terrainCode & terrainMaskSwamp) !== 0
        ? swampCost
        : plainCost;

    movementCosts[index] = cost;
    if (cost !== dijkstraUnreachable && cost > maxStepCost) {
      maxStepCost = cost;
    }
  }

  return {
    movementCosts,
    maxStepCost
  };
}

function buildMovementCostsWithMatrix(
  terrain: string,
  plainCost: number,
  swampCost: number,
  wallCost: number | null,
  costMatrix: DijkstraCostMatrix
): MovementCostGrid {
  const movementCosts = new Uint32Array(roomArea);
  const blockedWallCost = wallCost ?? dijkstraUnreachable;
  let maxStepCost = 0;

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
      if (cost !== dijkstraUnreachable && cost > maxStepCost) {
        maxStepCost = cost;
      }
    }
  }

  return {
    movementCosts,
    maxStepCost
  };
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

function createBinaryHeap(): BinaryHeap {
  return {
    costs: [],
    indexes: [],
    size: 0
  };
}

function createBucketQueue(width: number): BucketQueue {
  const heads = new Int32Array(width);
  heads.fill(-1);

  return {
    heads,
    next: new Int32Array(maxQueueEntries),
    indexes: new Uint16Array(maxQueueEntries),
    size: 0,
    entryCount: 0,
    currentCost: 0
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

function pushBucket(queue: BucketQueue, cost: number, index: number): void {
  if (queue.entryCount >= maxQueueEntries) {
    throw new Error(`Dijkstra bucket queue capacity exceeded (${maxQueueEntries}).`);
  }

  const bucketIndex = cost % queue.heads.length;
  const entryId = queue.entryCount;
  queue.entryCount += 1;
  queue.next[entryId] = queue.heads[bucketIndex]!;
  queue.indexes[entryId] = index;
  queue.heads[bucketIndex] = entryId;
  queue.size += 1;
}

function popBucket(queue: BucketQueue, entry: HeapEntry): boolean {
  if (queue.size === 0) {
    return false;
  }

  while (true) {
    const bucketIndex = queue.currentCost % queue.heads.length;
    const head = queue.heads[bucketIndex]!;
    if (head === -1) {
      queue.currentCost += 1;
      continue;
    }

    queue.heads[bucketIndex] = queue.next[head]!;
    entry.cost = queue.currentCost;
    entry.index = queue.indexes[head]!;
    queue.size -= 1;
    return true;
  }
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
