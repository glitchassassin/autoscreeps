const roomSize = 50;
const roomArea = roomSize * roomSize;
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
  includeDiagonals?: boolean;
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

  for (const goal of goals) {
    const index = toIndex(goal.x, goal.y);
    if (distances[index] === 0) {
      continue;
    }

    distances[index] = 0;
    pushHeap(heap, 0, index);
  }

  const directions = options.includeDiagonals === false ? cardinalDirections : allDirections;

  while (heap.size > 0) {
    const entry = popHeap(heap);
    if (!entry) {
      break;
    }

    const currentDistance = distances[entry.index];
    if (entry.cost !== currentDistance) {
      continue;
    }

    const x = entry.index % roomSize;
    const y = Math.floor(entry.index / roomSize);

    for (const direction of directions) {
      const nextX = x + direction.dx;
      const nextY = y + direction.dy;
      if (nextX < 0 || nextX >= roomSize || nextY < 0 || nextY >= roomSize) {
        continue;
      }

      const nextIndex = toIndex(nextX, nextY);
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

  const movementCosts = new Uint32Array(roomArea);

  for (let index = 0; index < roomArea; index += 1) {
    const terrainCode = Number(terrain[index] ?? "0");
    const x = index % roomSize;
    const y = Math.floor(index / roomSize);
    const isWall = (terrainCode & terrainMaskWall) !== 0;

    let cost = dijkstraUnreachable;
    if (isWall) {
      if (wallCost !== null) {
        cost = wallCost;
      }
    } else if ((terrainCode & terrainMaskSwamp) !== 0) {
      cost = swampCost;
    } else {
      cost = plainCost;
    }

    if (cost !== dijkstraUnreachable && costMatrix !== null) {
      const matrixCost = costMatrix.get(x, y);
      if (matrixCost >= 255) {
        cost = dijkstraUnreachable;
      } else if (matrixCost > 0) {
        cost = matrixCost;
      }
    }

    movementCosts[index] = cost;
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

function popHeap(heap: BinaryHeap): HeapEntry | null {
  if (heap.size === 0) {
    return null;
  }

  const cost = heap.costs[0]!;
  const index = heap.indexes[0]!;
  heap.size -= 1;

  if (heap.size === 0) {
    return { cost, index };
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

  return { cost, index };
}

const cardinalDirections = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 }
];

const allDirections = [
  ...cardinalDirections,
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 }
];
