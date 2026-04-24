import {
  createDijkstraMap,
  dijkstraUnreachable,
  type DijkstraCostMatrix,
  type DijkstraFallbackQueue,
  type DijkstraGoal,
  type DijkstraMap,
  type DijkstraMapOptions,
  type DijkstraQueueStrategy
} from "./dijkstra-map.ts";

const roomSize = 50;
const roomArea = roomSize * roomSize;
const maxNeighbors = 8;

export type RepairableDijkstraMap = DijkstraMap & {
  parents: Int16Array;
  childHeads: Int16Array;
  siblingNext: Int16Array;
};

export type RepairableDijkstraRepairStats = {
  blockedTiles: number;
  invalidatedTiles: number;
  repairedTiles: number;
};

export type RepairableDijkstraRepairResult = {
  map: RepairableDijkstraMap;
  stats: RepairableDijkstraRepairStats;
};

export type RepairableDijkstraReadOnlyRepairResult = {
  map: DijkstraMap;
  stats: RepairableDijkstraRepairStats;
};

export type RepairableDijkstraDistanceRepairResult = {
  distance: number;
  stats: RepairableDijkstraRepairStats;
};

export type RepairableDijkstraScratch = {
  invalidMarks: Uint16Array;
  blockedMarks: Uint16Array;
  distanceMarks: Uint16Array;
  repairDistances: Uint32Array;
  invalidTiles: Uint16Array;
  stack: Uint16Array;
  epoch: number;
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

export type RepairableDijkstraMapOptions = Pick<
  DijkstraMapOptions,
  "plainCost" | "swampCost" | "wallCost" | "costMatrix" | "queueStrategy" | "fallbackQueue" | "bucketThreshold"
>;

export type {
  DijkstraCostMatrix,
  DijkstraFallbackQueue,
  DijkstraGoal,
  DijkstraQueueStrategy
};

export function createRepairableDijkstraMap(
  terrain: string,
  goals: DijkstraGoal[],
  options: RepairableDijkstraMapOptions = {}
): RepairableDijkstraMap {
  const map = createDijkstraMap(terrain, goals, options);
  const parents = deriveParents(map);
  const { childHeads, siblingNext } = buildChildren(parents);
  return createRepairableMap(map.distances, map.movementCosts, parents, childHeads, siblingNext);
}

export function createRepairableDijkstraScratch(): RepairableDijkstraScratch {
  return {
    invalidMarks: new Uint16Array(roomArea),
    blockedMarks: new Uint16Array(roomArea),
    distanceMarks: new Uint16Array(roomArea),
    repairDistances: new Uint32Array(roomArea),
    invalidTiles: new Uint16Array(roomArea),
    stack: new Uint16Array(roomArea),
    epoch: 0
  };
}

export function blockRepairableDijkstraMap(baseMap: RepairableDijkstraMap, blockedTiles: readonly number[]): RepairableDijkstraRepairResult {
  const uniqueBlockedTiles = normalizeBlockedTiles(baseMap, blockedTiles);
  if (uniqueBlockedTiles.length === 0) {
    return {
      map: baseMap,
      stats: {
        blockedTiles: 0,
        invalidatedTiles: 0,
        repairedTiles: 0
      }
    };
  }

  const distances = new Uint32Array(baseMap.distances);
  const movementCosts = new Uint32Array(baseMap.movementCosts);
  const parents = new Int16Array(baseMap.parents);
  const invalid = new Uint8Array(roomArea);
  const invalidTiles = new Uint16Array(roomArea);
  const stack = new Uint16Array(roomArea);
  let invalidatedTiles = 0;

  for (const tile of uniqueBlockedTiles) {
    movementCosts[tile] = dijkstraUnreachable;
    invalidatedTiles = invalidateSubtree(baseMap, tile, invalid, invalidTiles, invalidatedTiles, stack, distances, parents);
  }

  const repairedTiles = repairInvalidatedTiles(distances, movementCosts, parents, invalid, invalidTiles, invalidatedTiles);
  const { childHeads, siblingNext } = buildChildren(parents);

  return {
    map: createRepairableMap(distances, movementCosts, parents, childHeads, siblingNext),
    stats: {
      blockedTiles: uniqueBlockedTiles.length,
      invalidatedTiles,
      repairedTiles
    }
  };
}

export function blockRepairableDijkstraMapReadOnly(
  baseMap: RepairableDijkstraMap,
  blockedTiles: readonly number[]
): RepairableDijkstraReadOnlyRepairResult {
  const uniqueBlockedTiles = normalizeBlockedTiles(baseMap, blockedTiles);
  if (uniqueBlockedTiles.length === 0) {
    return {
      map: baseMap,
      stats: {
        blockedTiles: 0,
        invalidatedTiles: 0,
        repairedTiles: 0
      }
    };
  }

  const distances = new Uint32Array(baseMap.distances);
  const movementCosts = new Uint32Array(baseMap.movementCosts);
  const invalid = new Uint8Array(roomArea);
  const invalidTiles = new Uint16Array(roomArea);
  const stack = new Uint16Array(roomArea);
  let invalidatedTiles = 0;

  for (const tile of uniqueBlockedTiles) {
    movementCosts[tile] = dijkstraUnreachable;
    invalidatedTiles = invalidateSubtreeDistances(baseMap, tile, invalid, invalidTiles, invalidatedTiles, stack, distances);
  }

  const repairedTiles = repairInvalidatedDistances(distances, movementCosts, invalid, invalidTiles, invalidatedTiles);

  return {
    map: createMap(distances, movementCosts),
    stats: {
      blockedTiles: uniqueBlockedTiles.length,
      invalidatedTiles,
      repairedTiles
    }
  };
}

export function getRepairedDijkstraDistance(
  baseMap: RepairableDijkstraMap,
  blockedTiles: readonly number[],
  targetTiles: readonly number[],
  scratch: RepairableDijkstraScratch = createRepairableDijkstraScratch()
): RepairableDijkstraDistanceRepairResult {
  if (targetTiles.length === 0) {
    return {
      distance: dijkstraUnreachable,
      stats: {
        blockedTiles: 0,
        invalidatedTiles: 0,
        repairedTiles: 0
      }
    };
  }

  for (const target of targetTiles) {
    validateIndex(target);
  }

  const uniqueBlockedTiles = normalizeBlockedTiles(baseMap, blockedTiles);
  if (uniqueBlockedTiles.length === 0) {
    return {
      distance: minBaseDistance(baseMap, targetTiles),
      stats: {
        blockedTiles: 0,
        invalidatedTiles: 0,
        repairedTiles: 0
      }
    };
  }

  const repairTargets: number[] = [];
  let bestDistance = dijkstraUnreachable;
  let minAffectedBaseDistance = dijkstraUnreachable;

  for (const target of targetTiles) {
    const distance = baseMap.distances[target]!;
    if (isShortestPathAffected(baseMap, uniqueBlockedTiles, target)) {
      repairTargets.push(target);
      if (distance < minAffectedBaseDistance) {
        minAffectedBaseDistance = distance;
      }
    } else if (distance < bestDistance) {
      bestDistance = distance;
    }
  }

  if (repairTargets.length === 0 || bestDistance <= minAffectedBaseDistance) {
    return {
      distance: bestDistance,
      stats: {
        blockedTiles: uniqueBlockedTiles.length,
        invalidatedTiles: 0,
        repairedTiles: 0
      }
    };
  }

  const invalidMarks = scratch.invalidMarks;
  const invalidEpoch = nextScratchEpoch(scratch);
  const blockedMarks = scratch.blockedMarks;
  const invalidTiles = scratch.invalidTiles;
  const stack = scratch.stack;
  let invalidatedTiles = 0;

  for (const tile of uniqueBlockedTiles) {
    blockedMarks[tile] = invalidEpoch;
    invalidatedTiles = markInvalidSubtree(baseMap, tile, invalidMarks, invalidEpoch, invalidTiles, invalidatedTiles, stack);
  }

  const repair = repairInvalidatedDistanceToAny(
    baseMap,
    invalidMarks,
    blockedMarks,
    scratch.distanceMarks,
    scratch.repairDistances,
    invalidEpoch,
    invalidTiles,
    invalidatedTiles,
    repairTargets,
    bestDistance
  );

  return {
    distance: repair.distance,
    stats: {
      blockedTiles: uniqueBlockedTiles.length,
      invalidatedTiles,
      repairedTiles: repair.repairedTiles
    }
  };
}

function nextScratchEpoch(scratch: RepairableDijkstraScratch): number {
  scratch.epoch += 1;
  if (scratch.epoch > 0xffff) {
    scratch.invalidMarks.fill(0);
    scratch.blockedMarks.fill(0);
    scratch.distanceMarks.fill(0);
    scratch.epoch = 1;
  }
  return scratch.epoch;
}

function normalizeBlockedTiles(baseMap: RepairableDijkstraMap, blockedTiles: readonly number[]): number[] {
  const result: number[] = [];

  for (const tile of blockedTiles) {
    validateIndex(tile);
    if (baseMap.movementCosts[tile] === dijkstraUnreachable || result.includes(tile)) {
      continue;
    }
    result.push(tile);
  }

  return result;
}

function minBaseDistance(baseMap: RepairableDijkstraMap, targetTiles: readonly number[]): number {
  let bestDistance = dijkstraUnreachable;
  for (const target of targetTiles) {
    const distance = baseMap.distances[target]!;
    if (distance < bestDistance) {
      bestDistance = distance;
    }
  }
  return bestDistance;
}

function isShortestPathAffected(baseMap: RepairableDijkstraMap, blockedTiles: readonly number[], target: number): boolean {
  for (let tile = target; tile !== -1; tile = baseMap.parents[tile]!) {
    if (blockedTiles.includes(tile)) {
      return true;
    }
  }
  return false;
}

function markInvalidSubtree(
  baseMap: RepairableDijkstraMap,
  root: number,
  invalidMarks: Uint16Array,
  invalidEpoch: number,
  invalidTiles: Uint16Array,
  invalidatedTiles: number,
  stack: Uint16Array
): number {
  let stackSize = 0;

  if (invalidMarks[root] !== invalidEpoch) {
    stack[stackSize] = root;
    stackSize += 1;
    invalidMarks[root] = invalidEpoch;
    invalidTiles[invalidatedTiles] = root;
    invalidatedTiles += 1;
  }

  while (stackSize > 0) {
    stackSize -= 1;
    const tile = stack[stackSize]!;

    for (let child = baseMap.childHeads[tile]!; child !== -1; child = baseMap.siblingNext[child]!) {
      if (invalidMarks[child] === invalidEpoch) {
        continue;
      }
      invalidMarks[child] = invalidEpoch;
      invalidTiles[invalidatedTiles] = child;
      invalidatedTiles += 1;
      stack[stackSize] = child;
      stackSize += 1;
    }
  }

  return invalidatedTiles;
}

function invalidateSubtree(
  baseMap: RepairableDijkstraMap,
  root: number,
  invalid: Uint8Array,
  invalidTiles: Uint16Array,
  invalidatedTiles: number,
  stack: Uint16Array,
  distances: Uint32Array,
  parents: Int16Array
): number {
  let stackSize = 0;

  if (invalid[root] === 0) {
    stack[stackSize] = root;
    stackSize += 1;
    invalid[root] = 1;
    invalidTiles[invalidatedTiles] = root;
    invalidatedTiles += 1;
  }

  while (stackSize > 0) {
    stackSize -= 1;
    const tile = stack[stackSize]!;
    distances[tile] = dijkstraUnreachable;
    parents[tile] = -1;

    for (let child = baseMap.childHeads[tile]!; child !== -1; child = baseMap.siblingNext[child]!) {
      if (invalid[child] !== 0) {
        continue;
      }
      invalid[child] = 1;
      invalidTiles[invalidatedTiles] = child;
      invalidatedTiles += 1;
      stack[stackSize] = child;
      stackSize += 1;
    }
  }

  return invalidatedTiles;
}

function invalidateSubtreeDistances(
  baseMap: RepairableDijkstraMap,
  root: number,
  invalid: Uint8Array,
  invalidTiles: Uint16Array,
  invalidatedTiles: number,
  stack: Uint16Array,
  distances: Uint32Array
): number {
  let stackSize = 0;

  if (invalid[root] === 0) {
    stack[stackSize] = root;
    stackSize += 1;
    invalid[root] = 1;
    invalidTiles[invalidatedTiles] = root;
    invalidatedTiles += 1;
  }

  while (stackSize > 0) {
    stackSize -= 1;
    const tile = stack[stackSize]!;
    distances[tile] = dijkstraUnreachable;

    for (let child = baseMap.childHeads[tile]!; child !== -1; child = baseMap.siblingNext[child]!) {
      if (invalid[child] !== 0) {
        continue;
      }
      invalid[child] = 1;
      invalidTiles[invalidatedTiles] = child;
      invalidatedTiles += 1;
      stack[stackSize] = child;
      stackSize += 1;
    }
  }

  return invalidatedTiles;
}

function repairInvalidatedTiles(
  distances: Uint32Array,
  movementCosts: Uint32Array,
  parents: Int16Array,
  invalid: Uint8Array,
  invalidTiles: Uint16Array,
  invalidatedTiles: number
): number {
  const heap = createBinaryHeap();
  const entry: HeapEntry = { cost: 0, index: 0 };

  for (let invalidTileIndex = 0; invalidTileIndex < invalidatedTiles; invalidTileIndex += 1) {
    const tile = invalidTiles[invalidTileIndex]!;
    if (invalid[tile] === 0 || movementCosts[tile] === dijkstraUnreachable) {
      continue;
    }

    const neighborOffset = tile * maxNeighbors;
    const neighborCount = neighborCounts[tile]!;
    let bestDistance = dijkstraUnreachable;
    let bestParent = -1;

    for (let neighborOffsetIndex = 0; neighborOffsetIndex < neighborCount; neighborOffsetIndex += 1) {
      const neighbor = neighborIndexes[neighborOffset + neighborOffsetIndex]!;
      if (invalid[neighbor] !== 0 || distances[neighbor] === dijkstraUnreachable) {
        continue;
      }

      const distance = distances[neighbor] + movementCosts[tile];
      if (distance < bestDistance || (distance === bestDistance && neighbor < bestParent)) {
        bestDistance = distance;
        bestParent = neighbor;
      }
    }

    if (bestParent !== -1) {
      distances[tile] = bestDistance;
      parents[tile] = bestParent;
      pushHeap(heap, bestDistance, tile);
    }
  }

  while (heap.size > 0) {
    if (!popHeap(heap, entry)) {
      break;
    }
    if (entry.cost !== distances[entry.index]) {
      continue;
    }

    const neighborOffset = entry.index * maxNeighbors;
    const neighborCount = neighborCounts[entry.index]!;

    for (let neighborOffsetIndex = 0; neighborOffsetIndex < neighborCount; neighborOffsetIndex += 1) {
      const next = neighborIndexes[neighborOffset + neighborOffsetIndex]!;
      const stepCost = movementCosts[next];
      if (invalid[next] === 0 || stepCost === dijkstraUnreachable) {
        continue;
      }

      const distance = entry.cost + stepCost;
      if (distance >= distances[next]) {
        continue;
      }

      distances[next] = distance;
      parents[next] = entry.index;
      pushHeap(heap, distance, next);
    }
  }

  let repairedTiles = 0;
  for (let invalidTileIndex = 0; invalidTileIndex < invalidatedTiles; invalidTileIndex += 1) {
    const tile = invalidTiles[invalidTileIndex]!;
    if (invalid[tile] !== 0 && distances[tile] !== dijkstraUnreachable) {
      repairedTiles += 1;
    }
  }
  return repairedTiles;
}

function repairInvalidatedDistanceToAny(
  baseMap: RepairableDijkstraMap,
  invalidMarks: Uint16Array,
  blockedMarks: Uint16Array,
  distanceMarks: Uint16Array,
  repairDistances: Uint32Array,
  invalidEpoch: number,
  invalidTiles: Uint16Array,
  invalidatedTiles: number,
  targetTiles: readonly number[],
  initialBestDistance: number
): { distance: number; repairedTiles: number } {
  const heap = createBinaryHeap();
  const entry: HeapEntry = { cost: 0, index: 0 };
  let bestDistance = initialBestDistance;

  for (let invalidTileIndex = 0; invalidTileIndex < invalidatedTiles; invalidTileIndex += 1) {
    const tile = invalidTiles[invalidTileIndex]!;
    const movementCost = blockedMarks[tile] === invalidEpoch ? dijkstraUnreachable : baseMap.movementCosts[tile]!;
    if (invalidMarks[tile] !== invalidEpoch || movementCost === dijkstraUnreachable) {
      continue;
    }

    const neighborOffset = tile * maxNeighbors;
    const neighborCount = neighborCounts[tile]!;
    let seedDistance = dijkstraUnreachable;

    for (let neighborOffsetIndex = 0; neighborOffsetIndex < neighborCount; neighborOffsetIndex += 1) {
      const neighbor = neighborIndexes[neighborOffset + neighborOffsetIndex]!;
      const neighborDistance = baseMap.distances[neighbor]!;
      if (invalidMarks[neighbor] === invalidEpoch || neighborDistance === dijkstraUnreachable) {
        continue;
      }

      const distance = neighborDistance + movementCost;
      if (distance < seedDistance) {
        seedDistance = distance;
      }
    }

    if (seedDistance !== dijkstraUnreachable && seedDistance < bestDistance) {
      repairDistances[tile] = seedDistance;
      distanceMarks[tile] = invalidEpoch;
      pushHeap(heap, seedDistance, tile);
    }
  }

  let repairedTiles = 0;
  while (heap.size > 0) {
    if (!popHeap(heap, entry)) {
      break;
    }
    if (distanceMarks[entry.index] !== invalidEpoch || entry.cost !== repairDistances[entry.index]) {
      continue;
    }
    if (entry.cost >= bestDistance) {
      break;
    }

    repairedTiles += 1;
    if (isTargetTile(entry.index, targetTiles)) {
      bestDistance = entry.cost;
      break;
    }

    const neighborOffset = entry.index * maxNeighbors;
    const neighborCount = neighborCounts[entry.index]!;

    for (let neighborOffsetIndex = 0; neighborOffsetIndex < neighborCount; neighborOffsetIndex += 1) {
      const next = neighborIndexes[neighborOffset + neighborOffsetIndex]!;
      const stepCost = blockedMarks[next] === invalidEpoch ? dijkstraUnreachable : baseMap.movementCosts[next]!;
      if (invalidMarks[next] !== invalidEpoch || stepCost === dijkstraUnreachable) {
        continue;
      }

      const distance = entry.cost + stepCost;
      const previousDistance = distanceMarks[next] === invalidEpoch ? repairDistances[next] : dijkstraUnreachable;
      if (distance >= previousDistance || distance >= bestDistance) {
        continue;
      }

      repairDistances[next] = distance;
      distanceMarks[next] = invalidEpoch;
      pushHeap(heap, distance, next);
    }
  }

  return { distance: bestDistance, repairedTiles };
}

function isTargetTile(tile: number, targetTiles: readonly number[]): boolean {
  for (const target of targetTiles) {
    if (target === tile) {
      return true;
    }
  }
  return false;
}

function repairInvalidatedDistances(
  distances: Uint32Array,
  movementCosts: Uint32Array,
  invalid: Uint8Array,
  invalidTiles: Uint16Array,
  invalidatedTiles: number
): number {
  const heap = createBinaryHeap();
  const entry: HeapEntry = { cost: 0, index: 0 };

  for (let invalidTileIndex = 0; invalidTileIndex < invalidatedTiles; invalidTileIndex += 1) {
    const tile = invalidTiles[invalidTileIndex]!;
    if (invalid[tile] === 0 || movementCosts[tile] === dijkstraUnreachable) {
      continue;
    }

    const neighborOffset = tile * maxNeighbors;
    const neighborCount = neighborCounts[tile]!;
    let bestDistance = dijkstraUnreachable;

    for (let neighborOffsetIndex = 0; neighborOffsetIndex < neighborCount; neighborOffsetIndex += 1) {
      const neighbor = neighborIndexes[neighborOffset + neighborOffsetIndex]!;
      if (invalid[neighbor] !== 0 || distances[neighbor] === dijkstraUnreachable) {
        continue;
      }

      const distance = distances[neighbor] + movementCosts[tile];
      if (distance < bestDistance) {
        bestDistance = distance;
      }
    }

    if (bestDistance !== dijkstraUnreachable) {
      distances[tile] = bestDistance;
      pushHeap(heap, bestDistance, tile);
    }
  }

  while (heap.size > 0) {
    if (!popHeap(heap, entry)) {
      break;
    }
    if (entry.cost !== distances[entry.index]) {
      continue;
    }

    const neighborOffset = entry.index * maxNeighbors;
    const neighborCount = neighborCounts[entry.index]!;

    for (let neighborOffsetIndex = 0; neighborOffsetIndex < neighborCount; neighborOffsetIndex += 1) {
      const next = neighborIndexes[neighborOffset + neighborOffsetIndex]!;
      const stepCost = movementCosts[next];
      if (invalid[next] === 0 || stepCost === dijkstraUnreachable) {
        continue;
      }

      const distance = entry.cost + stepCost;
      if (distance >= distances[next]) {
        continue;
      }

      distances[next] = distance;
      pushHeap(heap, distance, next);
    }
  }

  let repairedTiles = 0;
  for (let invalidTileIndex = 0; invalidTileIndex < invalidatedTiles; invalidTileIndex += 1) {
    const tile = invalidTiles[invalidTileIndex]!;
    if (invalid[tile] !== 0 && distances[tile] !== dijkstraUnreachable) {
      repairedTiles += 1;
    }
  }
  return repairedTiles;
}

function deriveParents(map: DijkstraMap): Int16Array {
  const parents = new Int16Array(roomArea);
  parents.fill(-1);

  for (let tile = 0; tile < roomArea; tile += 1) {
    const distance = map.distances[tile]!;
    const movementCost = map.movementCosts[tile]!;
    if (distance === dijkstraUnreachable || distance === 0 || movementCost === dijkstraUnreachable) {
      continue;
    }

    const neighborOffset = tile * maxNeighbors;
    const neighborCount = neighborCounts[tile]!;
    for (let neighborOffsetIndex = 0; neighborOffsetIndex < neighborCount; neighborOffsetIndex += 1) {
      const neighbor = neighborIndexes[neighborOffset + neighborOffsetIndex]!;
      if (map.distances[neighbor] + movementCost === distance) {
        parents[tile] = neighbor;
        break;
      }
    }
  }

  return parents;
}

function buildChildren(parents: Int16Array): { childHeads: Int16Array; siblingNext: Int16Array } {
  const childHeads = new Int16Array(roomArea);
  const siblingNext = new Int16Array(roomArea);
  childHeads.fill(-1);
  siblingNext.fill(-1);

  for (let tile = 0; tile < roomArea; tile += 1) {
    const parent = parents[tile]!;
    if (parent === -1) {
      continue;
    }
    siblingNext[tile] = childHeads[parent]!;
    childHeads[parent] = tile;
  }

  return { childHeads, siblingNext };
}

function createRepairableMap(
  distances: Uint32Array,
  movementCosts: Uint32Array,
  parents: Int16Array,
  childHeads: Int16Array,
  siblingNext: Int16Array
): RepairableDijkstraMap {
  return {
    distances,
    movementCosts,
    parents,
    childHeads,
    siblingNext,
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

function createMap(distances: Uint32Array, movementCosts: Uint32Array): DijkstraMap {
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

function validateIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= roomArea) {
    throw new Error(`Invalid room tile index ${index}.`);
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

const neighborIndexes = new Uint16Array(roomArea * maxNeighbors);
const neighborCounts = new Uint8Array(roomArea);

for (let y = 0; y < roomSize; y += 1) {
  for (let x = 0; x < roomSize; x += 1) {
    const index = toIndex(x, y);
    const offset = index * maxNeighbors;
    let count = 0;

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }

        const neighborX = x + dx;
        const neighborY = y + dy;
        if (neighborX < 0 || neighborX >= roomSize || neighborY < 0 || neighborY >= roomSize) {
          continue;
        }

        neighborIndexes[offset + count] = toIndex(neighborX, neighborY);
        count += 1;
      }
    }

    neighborCounts[index] = count;
  }
}
