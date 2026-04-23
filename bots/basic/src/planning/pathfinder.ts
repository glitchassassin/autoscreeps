const roomSize = 50;
const roomArea = roomSize * roomSize;
const terrainMaskWall = 1;
const terrainMaskSwamp = 2;
const unreachable = 0xffffffff;

export type PlannerTerrainSource = Map<string, string> | Record<string, string> | ((roomName: string) => string | null | undefined);

type SearchPosition = {
  x: number;
  y: number;
  roomName: string;
};

type NormalizedGoal = {
  pos: SearchPosition;
  range: number;
};

type HeapEntry = {
  cost: number;
  sequence: number;
  index: number;
};

type BinaryHeap = {
  entries: HeapEntry[];
  sequence: number;
};

export function installPlannerPathFinder(terrainSource: PlannerTerrainSource = {}): void {
  const pathFinder: PathFinder = {
    CostMatrix: PlannerCostMatrix as unknown as CostMatrix,
    search: createSearch(terrainSource) as PathFinder["search"],
    use: () => undefined
  };

  (globalThis as typeof globalThis & { PathFinder: PathFinder }).PathFinder = pathFinder;
}

export class PlannerCostMatrix {
  private readonly costs: Uint8Array;

  constructor(costs?: Uint8Array | number[]) {
    this.costs = costs === undefined ? new Uint8Array(roomArea) : new Uint8Array(costs);
    if (this.costs.length !== roomArea) {
      throw new Error(`Expected CostMatrix length ${roomArea}, received ${this.costs.length}.`);
    }
  }

  set(x: number, y: number, cost: number): undefined {
    validateCoordinate(x, y);
    if (!Number.isInteger(cost) || cost < 0 || cost > 255) {
      throw new Error(`Invalid CostMatrix cost ${cost}.`);
    }

    this.costs[toIndex(x, y)] = cost;
    return undefined;
  }

  get(x: number, y: number): number {
    validateCoordinate(x, y);
    return this.costs[toIndex(x, y)]!;
  }

  clone(): CostMatrix {
    return new PlannerCostMatrix(this.costs) as unknown as CostMatrix;
  }

  serialize(): number[] {
    return [...this.costs];
  }

  static deserialize(value: number[]): CostMatrix {
    return new PlannerCostMatrix(value) as unknown as CostMatrix;
  }
}

function createSearch(terrainSource: PlannerTerrainSource): PathFinder["search"] {
  return (origin, rawGoal, opts = {}) => {
    if (opts.flee) {
      throw new Error("Planner PathFinder does not support flee searches.");
    }

    const start = normalizePosition(origin);
    validateCoordinate(start.x, start.y);
    const goals = normalizeGoals(rawGoal).filter((goal) => goal.pos.roomName === start.roomName);
    if (goals.length === 0) {
      return createResult([], 0, 0, true);
    }

    const terrain = resolveTerrain(terrainSource, start.roomName);
    validateTerrain(terrain, start.roomName);

    const matrixResult = opts.roomCallback?.(start.roomName);
    if (matrixResult === false) {
      return createResult([], 0, 0, true);
    }
    const matrix = matrixResult === true ? null : matrixResult ?? null;

    const plainCost = opts.plainCost ?? 1;
    const swampCost = opts.swampCost ?? 5;
    const maxOps = opts.maxOps ?? 2000;
    const maxCost = opts.maxCost ?? Infinity;
    const startIndex = toIndex(start.x, start.y);
    const distances = new Uint32Array(roomArea);
    const previous = new Int16Array(roomArea);
    distances.fill(unreachable);
    previous.fill(-1);
    distances[startIndex] = 0;

    const heap = createHeap();
    pushHeap(heap, { cost: 0, sequence: 0, index: startIndex });

    let ops = 0;
    let reachedIndex = -1;
    let bestIndex = startIndex;
    let bestGoalDistance = minGoalDistance(start, goals);

    while (heap.entries.length > 0 && ops < maxOps) {
      const entry = popHeap(heap);
      if (entry === null) {
        break;
      }
      if (entry.cost !== distances[entry.index]) {
        continue;
      }

      ops += 1;
      const coord = fromIndex(entry.index);
      const remainingRange = minGoalDistance({ ...coord, roomName: start.roomName }, goals);
      if (
        remainingRange < bestGoalDistance
        || (remainingRange === bestGoalDistance && entry.cost < distances[bestIndex]!)
      ) {
        bestGoalDistance = remainingRange;
        bestIndex = entry.index;
      }

      if (remainingRange === 0) {
        reachedIndex = entry.index;
        break;
      }

      for (const offset of neighborOffsets) {
        const nextX = coord.x + offset.x;
        const nextY = coord.y + offset.y;
        if (!isInRoom(nextX, nextY)) {
          continue;
        }

        const nextIndex = toIndex(nextX, nextY);
        const stepCost = getStepCost(terrain, matrix, nextX, nextY, plainCost, swampCost, nextIndex === startIndex);
        if (stepCost >= 255) {
          continue;
        }

        const nextCost = entry.cost + stepCost;
        if (nextCost > maxCost || nextCost >= distances[nextIndex]!) {
          continue;
        }

        distances[nextIndex] = nextCost;
        previous[nextIndex] = entry.index;
        heap.sequence += 1;
        pushHeap(heap, { cost: nextCost, sequence: heap.sequence, index: nextIndex });
      }
    }

    const endIndex = reachedIndex >= 0 ? reachedIndex : bestIndex;
    return createResult(
      reconstructPath(previous, startIndex, endIndex, start.roomName),
      ops,
      distances[endIndex] === unreachable ? 0 : distances[endIndex]!,
      reachedIndex < 0
    );
  };
}

function normalizeGoals(
  rawGoal: RoomPosition | { pos: RoomPosition; range: number } | Array<RoomPosition | { pos: RoomPosition; range: number }>
): NormalizedGoal[] {
  const values = Array.isArray(rawGoal) ? rawGoal : [rawGoal];
  return values.map((goal) => {
    if ("pos" in goal) {
      return {
        pos: normalizePosition(goal.pos),
        range: goal.range
      };
    }

    return {
      pos: normalizePosition(goal),
      range: 0
    };
  });
}

function normalizePosition(position: RoomPosition): SearchPosition {
  return {
    x: position.x,
    y: position.y,
    roomName: position.roomName
  };
}

function resolveTerrain(source: PlannerTerrainSource, roomName: string): string {
  if (typeof source === "function") {
    return source(roomName) ?? createPlainTerrain();
  }
  if (source instanceof Map) {
    return source.get(roomName) ?? createPlainTerrain();
  }

  return source[roomName] ?? createPlainTerrain();
}

function getStepCost(
  terrain: string,
  matrix: CostMatrix | null,
  x: number,
  y: number,
  plainCost: number,
  swampCost: number,
  allowBlockedStart: boolean
): number {
  const matrixCost = matrix?.get(x, y) ?? 0;
  if (matrixCost >= 255 && !allowBlockedStart) {
    return 255;
  }
  if (matrixCost > 0 && matrixCost < 255) {
    return matrixCost;
  }

  const terrainCode = terrain.charCodeAt(toIndex(x, y)) - 48;
  if ((terrainCode & terrainMaskWall) !== 0 && !allowBlockedStart) {
    return 255;
  }

  return (terrainCode & terrainMaskSwamp) !== 0 ? swampCost : plainCost;
}

function minGoalDistance(position: SearchPosition, goals: NormalizedGoal[]): number {
  let best = unreachable;
  for (const goal of goals) {
    const distance = Math.max(Math.abs(position.x - goal.pos.x), Math.abs(position.y - goal.pos.y));
    best = Math.min(best, Math.max(distance - goal.range, 0));
  }
  return best;
}

function reconstructPath(previous: Int16Array, startIndex: number, endIndex: number, roomName: string): RoomPosition[] {
  if (endIndex === startIndex || previous[endIndex] === -1) {
    return [];
  }

  const reversed: number[] = [];
  let current = endIndex;
  while (current !== startIndex && current >= 0) {
    reversed.push(current);
    current = previous[current]!;
  }

  return reversed.reverse().map((index) => {
    const coord = fromIndex(index);
    return {
      x: coord.x,
      y: coord.y,
      roomName
    } as RoomPosition;
  });
}

function createResult(path: RoomPosition[], ops: number, cost: number, incomplete: boolean): PathFinderPath {
  return { path, ops, cost, incomplete };
}

function createHeap(): BinaryHeap {
  return {
    entries: [],
    sequence: 0
  };
}

function pushHeap(heap: BinaryHeap, entry: HeapEntry): void {
  heap.entries.push(entry);
  let index = heap.entries.length - 1;

  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    const parent = heap.entries[parentIndex]!;
    if (compareHeapEntry(parent, entry) <= 0) {
      break;
    }

    heap.entries[index] = parent;
    index = parentIndex;
  }

  heap.entries[index] = entry;
}

function popHeap(heap: BinaryHeap): HeapEntry | null {
  if (heap.entries.length === 0) {
    return null;
  }

  const result = heap.entries[0]!;
  const last = heap.entries.pop()!;
  if (heap.entries.length === 0) {
    return result;
  }

  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = leftIndex + 1;
    if (leftIndex >= heap.entries.length) {
      break;
    }

    const left = heap.entries[leftIndex]!;
    const right = rightIndex < heap.entries.length ? heap.entries[rightIndex]! : null;
    const childIndex = right !== null && compareHeapEntry(right, left) < 0 ? rightIndex : leftIndex;
    const child = heap.entries[childIndex]!;
    if (compareHeapEntry(last, child) <= 0) {
      break;
    }

    heap.entries[index] = child;
    index = childIndex;
  }

  heap.entries[index] = last;
  return result;
}

function compareHeapEntry(left: HeapEntry, right: HeapEntry): number {
  if (left.cost !== right.cost) {
    return left.cost - right.cost;
  }
  return left.sequence - right.sequence;
}

function validateTerrain(terrain: string, roomName: string): void {
  if (terrain.length !== roomArea) {
    throw new Error(`Expected terrain string length ${roomArea} for room ${roomName}, received ${terrain.length}.`);
  }
}

function createPlainTerrain(): string {
  return "0".repeat(roomArea);
}

function validateCoordinate(x: number, y: number): void {
  if (!isInRoom(x, y)) {
    throw new Error(`Invalid room coordinate (${x}, ${y}).`);
  }
}

function isInRoom(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < roomSize && y >= 0 && y < roomSize;
}

function toIndex(x: number, y: number): number {
  return y * roomSize + x;
}

function fromIndex(index: number): { x: number; y: number } {
  return {
    x: index % roomSize,
    y: Math.floor(index / roomSize)
  };
}

const neighborOffsets = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 }
] as const;
