import type { RoadPlan, RoadPlanPath, RoadPlanPathKind } from "./road-plan.ts";
import { isConstructionSiteTerrainAllowed, isRoadPlanningTerrain } from "./construction-rules.ts";
import type { RoomPlanningObject, RoomPlanningRoomData } from "./room-plan.ts";
import type { SourceSinkStructurePlan } from "./source-sink-structure-plan.ts";
import type { RoomStampAnchor, RoomStampPlan, StampPlacement } from "./stamp-placement.ts";

const roomSize = 50;
const roomArea = roomSize * roomSize;
const maxNeighbors = 8;
const controllerReserveRange = 3;
const sourceReserveRange = 2;
const maxExtensions = 60;
const fastfillerExtensionsPerPod = 12;
const maxTowers = 6;
const maxNukers = 1;
const maxObservers = 1;
const unreachableRoadDistance = 1_000_000;
const defaultMaxAccessRoadTiles = 24;
const defaultAccessRoadCost = 4;
const accessRoadGroupIndex = 1;
const structureRoadGroups: RoadPlanPathKind[][] = [
  ["storage-to-pod1", "storage-to-pod2"],
  ["terminal-to-labs", "storage-to-labs", "storage-to-controller", "terminal-to-mineral", "storage-to-source1", "storage-to-source2"]
];

export type PreRampartStructureKind = "extra-structure";

export type PreRampartStructurePlacement = RoomStampAnchor & {
  kind: PreRampartStructureKind;
  tile: number;
  score: number[];
};

export type PreRampartStructurePlan = {
  roomName: string;
  policy: RoomStampPlan["policy"];
  extensionCount: number;
  towerCount: number;
  nukerCount: number;
  observerCount: number;
  candidateCount: number;
  accessRoadTiles: number[];
  accessRoads: RoomStampAnchor[];
  extraStructures: PreRampartStructurePlacement[];
  structureTiles: number[];
};

export type PreRampartStructurePlanOptions = {
  extensionCount?: number;
  towerCount?: number;
  nukerCount?: number;
  observerCount?: number;
  candidateCount?: number;
  growAccessRoads?: boolean;
  maxAccessRoadTiles?: number;
  accessRoadCost?: number;
  growExtensionRoads?: boolean;
  maxExtensionRoadTiles?: number;
  extensionRoadCost?: number;
  extraRoadTiles?: Iterable<number>;
  allowedTiles?: Iterable<number>;
  blockedTiles?: Iterable<number>;
};

type StructurePlanningContext = {
  room: RoomPlanningRoomData;
  stampPlan: RoomStampPlan;
  roadPlan: RoadPlan;
  controller: RoomPlanningObject;
  sources: [RoomPlanningObject, RoomPlanningObject];
  storage: RoomStampAnchor;
  structureAllowed: Uint8Array;
  accessRoadAllowed: Uint8Array;
  baseBlocked: Uint8Array;
  blocked: Uint8Array;
  roadMask: Uint8Array;
  roadDistances: Int32Array;
  roadDistanceHistory: Int32Array[];
  accessRoadTiles: number[];
};

type Candidate = RoomStampAnchor & {
  tile: number;
  score: number[];
};

type CandidateScores = {
  tiles: number[];
  groups: Int16Array;
  distances: Int32Array;
};

type PreRampartStructurePlanConfig = {
  extensionCount: number;
  towerCount: number;
  nukerCount: number;
  observerCount: number;
  candidateCount: number;
  growAccessRoads: boolean;
  maxAccessRoadTiles: number;
  accessRoadCost: number;
  extraRoadTiles: number[];
  allowedTiles: number[] | null;
  blockedTiles: number[];
};

type ExtensionAllocationScore = {
  totalDistance: number;
  selectedCount: number;
};

export function planPreRampartStructures(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  sourceSinkPlan: SourceSinkStructurePlan | null = null,
  options: PreRampartStructurePlanOptions = {}
): PreRampartStructurePlan {
  const config = normalizeOptions(options, stampPlan);
  const context = createStructurePlanningContext(room, stampPlan, roadPlan, sourceSinkPlan, config);
  const baseStructureCount = config.extensionCount + config.towerCount + config.nukerCount + config.observerCount;
  validateTargetCount(config.extensionCount, "extensionCount");
  validateTargetCount(config.towerCount, "towerCount");
  validateTargetCount(config.nukerCount, "nukerCount");
  validateTargetCount(config.observerCount, "observerCount");
  validateTargetCount(config.candidateCount, "candidateCount");
  validateTargetCount(config.maxAccessRoadTiles, "maxAccessRoadTiles");
  validateTargetCount(config.accessRoadCost, "accessRoadCost");
  if (config.candidateCount < baseStructureCount) {
    throw new Error(`candidateCount must be at least ${baseStructureCount}, received ${config.candidateCount}.`);
  }

  if (config.growAccessRoads && config.candidateCount > 0 && config.maxAccessRoadTiles > 0) {
    growAccessRoads(context, config.candidateCount, config);
  }
  const extraStructures = placeExtraStructures(context, config.candidateCount);
  for (const structure of extraStructures) {
    context.blocked[structure.tile] = 1;
  }

  return {
    roomName: room.roomName,
    policy: stampPlan.policy,
    extensionCount: config.extensionCount,
    towerCount: config.towerCount,
    nukerCount: config.nukerCount,
    observerCount: config.observerCount,
    candidateCount: config.candidateCount,
    accessRoadTiles: [...context.accessRoadTiles],
    accessRoads: context.accessRoadTiles.map(fromIndex),
    extraStructures,
    structureTiles: extraStructures.map((placement) => placement.tile).sort(compareNumbers)
  };
}

export function validatePreRampartStructurePlan(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  sourceSinkPlan: SourceSinkStructurePlan | null,
  plan: PreRampartStructurePlan,
  options: PreRampartStructurePlanOptions = {}
): string[] {
  const errors: string[] = [];
  if (plan.roomName !== room.roomName) {
    errors.push(`Pre-rampart structure plan room '${plan.roomName}' does not match room '${room.roomName}'.`);
  }
  if (plan.policy !== stampPlan.policy) {
    errors.push(`Pre-rampart structure plan policy '${plan.policy}' does not match stamp policy '${stampPlan.policy}'.`);
  }

  const config = normalizeOptions({
    ...options,
    extensionCount: plan.extensionCount,
    towerCount: plan.towerCount,
    nukerCount: plan.nukerCount,
    observerCount: plan.observerCount,
    candidateCount: plan.candidateCount
  }, stampPlan);
  const context = createStructurePlanningContext(room, stampPlan, roadPlan, sourceSinkPlan, config);
  const seenRoads = new Set<number>();
  const accessRoadTileSet = new Set<number>();
  for (const tile of plan.accessRoadTiles) {
    if (!isValidIndex(tile)) {
      errors.push(`Access road tile index ${tile} is outside the room.`);
      continue;
    }
    if (seenRoads.has(tile)) {
      errors.push("Access road tiles must be unique.");
    }
    seenRoads.add(tile);
    accessRoadTileSet.add(tile);

    const coord = fromIndex(tile);
    if (!isBuildableAccessRoadTile(context, coord.x, coord.y)) {
      errors.push(`Access road tile ${coord.x},${coord.y} is not buildable.`);
    }
  }

  const reachableAccessRoadTiles = collectReachableAccessRoadTiles(context.roadMask, accessRoadTileSet);
  for (const tile of accessRoadTileSet) {
    if (!reachableAccessRoadTiles.has(tile)) {
      const coord = fromIndex(tile);
      errors.push(`Access road tile ${coord.x},${coord.y} is not connected to the planned road network.`);
    }
    addAccessRoadTile(context, tile);
  }

  const expectedRoads = plan.accessRoadTiles.map(fromIndex);
  if (plan.accessRoads.length !== expectedRoads.length || plan.accessRoads.some((road, index) => road.x !== expectedRoads[index]!.x || road.y !== expectedRoads[index]!.y)) {
    errors.push("Access road coordinates must match access road tiles.");
  }

  const seen = new Set<number>();
  for (const placement of plan.extraStructures) {
    if (placement.tile !== toIndex(placement.x, placement.y)) {
      errors.push(`${placement.kind} at ${placement.x},${placement.y} has mismatched tile index ${placement.tile}.`);
    }
    if (seen.has(placement.tile)) {
      errors.push(`Multiple pre-rampart structures occupy ${placement.x},${placement.y}.`);
    }
    seen.add(placement.tile);

    if (!isBuildableStructureTile(context, placement.x, placement.y)) {
      errors.push(`${placement.kind} at ${placement.x},${placement.y} is not buildable.`);
    }
    if (!isAdjacentToRoad(context.roadMask, placement.x, placement.y)) {
      errors.push(`${placement.kind} at ${placement.x},${placement.y} is not adjacent to a planned road.`);
    }
    context.blocked[placement.tile] = 1;
  }

  if (plan.candidateCount < plan.extensionCount + plan.towerCount + plan.nukerCount + plan.observerCount) {
    errors.push("Pre-rampart candidateCount must cover all required final structures.");
  }
  if (plan.extraStructures.length > plan.candidateCount) {
    errors.push(`Pre-rampart structure plan resolved ${plan.extraStructures.length} candidates, exceeding target ${plan.candidateCount}.`);
  }

  const expectedTiles = [...plan.extraStructures].sort(comparePlacementsByTile).map((placement) => placement.tile);
  if (plan.structureTiles.join(",") !== expectedTiles.join(",")) {
    errors.push("Pre-rampart structure tiles must match sorted structure placements.");
  }

  return errors;
}

function placeExtraStructures(context: StructurePlanningContext, targetCount: number): PreRampartStructurePlacement[] {
  const candidates = collectRoadAdjacentCandidates(context, structureRoadGroups);
  const placements: PreRampartStructurePlacement[] = [];

  for (const candidate of candidates) {
    if (placements.length >= targetCount) {
      break;
    }
    if (context.blocked[candidate.tile] !== 0) {
      continue;
    }
    const placement = createPlacement("extra-structure", candidate);
    placements.push(placement);
    context.blocked[placement.tile] = 1;
  }

  return placements;
}

function growAccessRoads(
  context: StructurePlanningContext,
  targetCount: number,
  config: PreRampartStructurePlanConfig
): void {
  let currentScore = scoreExtraStructureAllocation(context, targetCount);

  while (context.accessRoadTiles.length < config.maxAccessRoadTiles) {
    const currentAdjustedScore = currentScore.totalDistance + context.accessRoadTiles.length * config.accessRoadCost;
    let best: { tile: number; adjustedScore: number; allocationScore: ExtensionAllocationScore } | null = null;

    for (const tile of collectAccessRoadFrontier(context)) {
      addAccessRoadTile(context, tile);
      const allocationScore = scoreExtraStructureAllocation(context, targetCount);
      const adjustedScore = allocationScore.totalDistance + context.accessRoadTiles.length * config.accessRoadCost;
      removeLastAccessRoadTile(context);

      if (adjustedScore >= currentAdjustedScore) {
        continue;
      }
      if (
        best === null
        || adjustedScore < best.adjustedScore
        || (adjustedScore === best.adjustedScore && tile < best.tile)
      ) {
        best = { tile, adjustedScore, allocationScore };
      }
    }

    if (best === null) {
      break;
    }

    addAccessRoadTile(context, best.tile);
    currentScore = best.allocationScore;
  }
}

function scoreExtraStructureAllocation(context: StructurePlanningContext, targetCount: number): ExtensionAllocationScore {
  const candidates = collectRoadAdjacentCandidateScores(context, structureRoadGroups, false);
  const selectedTiles: number[] = [];
  let totalDistance = 0;

  for (const tile of candidates.tiles) {
    insertBestCandidateTile(selectedTiles, targetCount, tile, candidates.groups, candidates.distances);
  }

  for (const tile of selectedTiles) {
    totalDistance += candidates.distances[tile] ?? unreachableRoadDistance;
  }

  return {
    totalDistance: totalDistance + (targetCount - selectedTiles.length) * unreachableRoadDistance,
    selectedCount: selectedTiles.length
  };
}

function collectAccessRoadFrontier(context: StructurePlanningContext): number[] {
  const frontierMask = new Uint8Array(roomArea);
  const frontierDistances = new Int32Array(roomArea);
  const frontier: number[] = [];

  for (let tile = 0; tile < roomArea; tile += 1) {
    if (context.roadMask[tile] === 0) {
      continue;
    }
    const neighborOffset = tile * maxNeighbors;
    const neighborCount = neighborCounts[tile]!;
    for (let neighborIndex = 0; neighborIndex < neighborCount; neighborIndex += 1) {
      const neighborTile = neighborIndexes[neighborOffset + neighborIndex]!;
      if (frontierMask[neighborTile] !== 0 || !isBuildableAccessRoadTileByIndex(context, neighborTile)) {
        continue;
      }
      frontierMask[neighborTile] = 1;
      frontierDistances[neighborTile] = getRoadConnectionDistance(context, neighborTile);
      frontier.push(neighborTile);
    }
  }

  return frontier.sort((left, right) => {
    const leftDistance = frontierDistances[left]!;
    const rightDistance = frontierDistances[right]!;
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
    return left - right;
  });
}

function collectRoadAdjacentCandidates(context: StructurePlanningContext, groups: RoadPlanPathKind[][]): Candidate[] {
  const candidates = collectRoadAdjacentCandidateScores(context, groups);
  return candidates.tiles.map((tile) => createCandidateFromTile(tile, candidates.groups[tile]!, candidates.distances[tile]!));
}

function collectRoadAdjacentCandidateScores(context: StructurePlanningContext, groups: RoadPlanPathKind[][], sortCandidates = true): CandidateScores {
  const bestGroup = new Int16Array(roomArea);
  const bestDistance = new Int32Array(roomArea);
  const candidateTiles: number[] = [];
  bestGroup.fill(-1);

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    for (const kind of groups[groupIndex]!) {
      const path = context.roadPlan.paths.find((candidate) => candidate.kind === kind);
      if (!path) {
        continue;
      }

      collectPathAdjacentCandidates(context, path, groupIndex, bestGroup, bestDistance, candidateTiles);
    }
  }
  collectRoadTileAdjacentCandidates(context, context.accessRoadTiles, accessRoadGroupIndex, bestGroup, bestDistance, candidateTiles);

  if (sortCandidates) {
    candidateTiles.sort((left, right) => compareCandidateTiles(left, right, bestGroup, bestDistance));
  }
  return {
    tiles: candidateTiles,
    groups: bestGroup,
    distances: bestDistance
  };
}

function insertBestCandidateTile(
  selectedTiles: number[],
  targetCount: number,
  tile: number,
  bestGroup: Int16Array,
  bestDistance: Int32Array
): void {
  if (targetCount <= 0) {
    return;
  }

  if (
    selectedTiles.length >= targetCount
    && compareCandidateTiles(tile, selectedTiles[selectedTiles.length - 1]!, bestGroup, bestDistance) >= 0
  ) {
    return;
  }

  if (selectedTiles.length < targetCount) {
    selectedTiles.push(tile);
  } else {
    selectedTiles[selectedTiles.length - 1] = tile;
  }

  for (let index = selectedTiles.length - 1; index > 0; index -= 1) {
    if (compareCandidateTiles(selectedTiles[index]!, selectedTiles[index - 1]!, bestGroup, bestDistance) >= 0) {
      break;
    }
    const previous = selectedTiles[index - 1]!;
    selectedTiles[index - 1] = selectedTiles[index]!;
    selectedTiles[index] = previous;
  }
}

function collectPathAdjacentCandidates(
  context: StructurePlanningContext,
  path: RoadPlanPath,
  groupIndex: number,
  bestGroup: Int16Array,
  bestDistance: Int32Array,
  candidateTiles: number[]
): void {
  collectRoadTileAdjacentCandidates(context, path.roadTiles, groupIndex, bestGroup, bestDistance, candidateTiles);
}

function collectRoadTileAdjacentCandidates(
  context: StructurePlanningContext,
  roadTiles: number[],
  groupIndex: number,
  bestGroup: Int16Array,
  bestDistance: Int32Array,
  candidateTiles: number[]
): void {
  for (const roadTile of roadTiles) {
    if (!isValidIndex(roadTile)) {
      continue;
    }
    const roadDistance = context.roadDistances[roadTile]!;
    const neighborOffset = roadTile * maxNeighbors;
    const neighborCount = neighborCounts[roadTile]!;
    for (let neighborIndex = 0; neighborIndex < neighborCount; neighborIndex += 1) {
      const tile = neighborIndexes[neighborOffset + neighborIndex]!;
      if (!isBuildableStructureTileByIndex(context, tile)) {
        continue;
      }

      const scoreDistance = roadDistance >= 0 ? roadDistance + 1 : unreachableRoadDistance + rangeTileToCoord(tile, context.storage);
      const previousGroup = bestGroup[tile]!;
      if (previousGroup === -1) {
        bestGroup[tile] = groupIndex;
        bestDistance[tile] = scoreDistance;
        candidateTiles.push(tile);
        continue;
      }

      if (groupIndex < previousGroup || (groupIndex === previousGroup && scoreDistance < bestDistance[tile]!)) {
        bestGroup[tile] = groupIndex;
        bestDistance[tile] = scoreDistance;
      }
    }
  }
}

function compareCandidateTiles(left: number, right: number, bestGroup: Int16Array, bestDistance: Int32Array): number {
  const leftGroup = bestGroup[left]!;
  const rightGroup = bestGroup[right]!;
  if (leftGroup !== rightGroup) {
    return leftGroup - rightGroup;
  }

  const leftDistance = bestDistance[left]!;
  const rightDistance = bestDistance[right]!;
  if (leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }

  const leftY = tileYs[left]!;
  const rightY = tileYs[right]!;
  if (leftY !== rightY) {
    return leftY - rightY;
  }

  const leftX = tileXs[left]!;
  const rightX = tileXs[right]!;
  if (leftX !== rightX) {
    return leftX - rightX;
  }

  return left - right;
}

function createCandidateFromTile(tile: number, groupIndex: number, roadDistance: number): Candidate {
  const x = tileXs[tile]!;
  const y = tileYs[tile]!;
  return {
    x,
    y,
    tile,
    score: [
      groupIndex,
      roadDistance,
      y,
      x
    ]
  };
}

function createStructurePlanningContext(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  sourceSinkPlan: SourceSinkStructurePlan | null,
  config: PreRampartStructurePlanConfig
): StructurePlanningContext {
  validateInputs(room, stampPlan, roadPlan, sourceSinkPlan);
  const controller = requireObject(room, "controller");
  const sources = getSources(room);
  const storage = stampPlan.stamps.hub.anchors.storage ?? stampPlan.stamps.hub.anchor;
  const allowedMask = createAllowedMask(config.allowedTiles);
  const structureAllowed = new Uint8Array(roomArea);
  const accessRoadAllowed = new Uint8Array(roomArea);
  const baseBlocked = new Uint8Array(roomArea);
  const roadMask = new Uint8Array(roomArea);

  for (let tile = 0; tile < roomArea; tile += 1) {
    const coord = fromIndex(tile);
    const roadTerrainAllowed = isRoadPlanningTerrain(room.terrain, coord.x, coord.y);
    if (!roadTerrainAllowed) {
      baseBlocked[tile] = 1;
    }
    if (allowedMask[tile] !== 0 && isOutsideReservedRanges(coord, controller, sources)) {
      if (roadTerrainAllowed) {
        accessRoadAllowed[tile] = 1;
      }
      if (isConstructionSiteTerrainAllowed(room.terrain, "extension", coord.x, coord.y)) {
        structureAllowed[tile] = 1;
      }
    }
  }

  for (const object of room.objects) {
    if (isNaturalBlocker(object) && isInRoom(object.x, object.y)) {
      baseBlocked[toIndex(object.x, object.y)] = 1;
    }
  }

  for (const stamp of getStamps(stampPlan)) {
    for (const tile of stamp.blockedTiles) {
      if (isValidIndex(tile)) {
        baseBlocked[tile] = 1;
      }
    }
  }

  for (const tile of sourceSinkPlan?.structureTiles ?? []) {
    if (isValidIndex(tile)) {
      baseBlocked[tile] = 1;
    }
  }
  for (const tile of config.blockedTiles) {
    if (isValidIndex(tile)) {
      baseBlocked[tile] = 1;
    }
  }

  const blocked = new Uint8Array(baseBlocked);
  for (const tile of roadPlan.roadTiles) {
    if (isValidIndex(tile) && allowedMask[tile] !== 0) {
      blocked[tile] = 1;
      roadMask[tile] = 1;
    }
  }
  for (const tile of config.extraRoadTiles) {
    if (isValidIndex(tile) && allowedMask[tile] !== 0) {
      blocked[tile] = 1;
      roadMask[tile] = 1;
    }
  }
  const roadDistances = createRoadDistanceMap(storage, roadMask);

  return {
    room,
    stampPlan,
    roadPlan,
    controller,
    sources,
    storage,
    structureAllowed,
    accessRoadAllowed,
    baseBlocked,
    blocked,
    roadMask,
    roadDistances,
    roadDistanceHistory: [],
    accessRoadTiles: []
  };
}

function addAccessRoadTile(context: StructurePlanningContext, tile: number): void {
  context.roadDistanceHistory.push(context.roadDistances);
  context.accessRoadTiles.push(tile);
  context.roadMask[tile] = 1;
  context.blocked[tile] = 1;
  context.roadDistances = extendRoadDistanceMap(context.storage, context.roadDistances, context.roadMask, tile);
}

function removeLastAccessRoadTile(context: StructurePlanningContext): void {
  const tile = context.accessRoadTiles.pop();
  if (tile === undefined) {
    return;
  }
  context.roadMask[tile] = 0;
  context.blocked[tile] = context.baseBlocked[tile]!;
  context.roadDistances = context.roadDistanceHistory.pop() ?? createRoadDistanceMap(context.storage, context.roadMask);
}

function createRoadDistanceMap(storage: RoomStampAnchor, roadMask: Uint8Array): Int32Array {
  const distances = new Int32Array(roomArea);
  const queue = new Int16Array(roomArea);
  let head = 0;
  let tail = 0;
  distances.fill(-1);

  const storageTile = toIndex(storage.x, storage.y);
  if (roadMask[storageTile] !== 0) {
    distances[storageTile] = 0;
    queue[tail] = storageTile;
    tail += 1;
  }

  const storageNeighborOffset = storageTile * maxNeighbors;
  const storageNeighborCount = neighborCounts[storageTile]!;
  for (let neighborIndex = 0; neighborIndex < storageNeighborCount; neighborIndex += 1) {
    const tile = neighborIndexes[storageNeighborOffset + neighborIndex]!;
    if (roadMask[tile] === 0 || distances[tile] >= 0) {
      continue;
    }
    distances[tile] = rangeTileToCoord(tile, storage);
    queue[tail] = tile;
    tail += 1;
  }

  while (head < tail) {
    const tile = queue[head]!;
    head += 1;
    const nextDistance = distances[tile]! + 1;
    const neighborOffset = tile * maxNeighbors;
    const neighborCount = neighborCounts[tile]!;
    for (let neighborIndex = 0; neighborIndex < neighborCount; neighborIndex += 1) {
      const neighborTile = neighborIndexes[neighborOffset + neighborIndex]!;
      if (roadMask[neighborTile] === 0 || distances[neighborTile] >= 0) {
        continue;
      }
      distances[neighborTile] = nextDistance;
      queue[tail] = neighborTile;
      tail += 1;
    }
  }

  return distances;
}

function extendRoadDistanceMap(storage: RoomStampAnchor, currentDistances: Int32Array, roadMask: Uint8Array, addedTile: number): Int32Array {
  const seedDistance = getRoadConnectionDistanceFromMap(storage, currentDistances, addedTile);
  const distances = new Int32Array(currentDistances);
  if (seedDistance < 0) {
    return distances;
  }

  const queue = new Int16Array(roomArea);
  let head = 0;
  let tail = 0;
  distances[addedTile] = seedDistance;
  queue[tail] = addedTile;
  tail += 1;

  while (head < tail) {
    const tile = queue[head]!;
    head += 1;
    const nextDistance = distances[tile]! + 1;
    const neighborOffset = tile * maxNeighbors;
    const neighborCount = neighborCounts[tile]!;
    for (let neighborIndex = 0; neighborIndex < neighborCount; neighborIndex += 1) {
      const neighborTile = neighborIndexes[neighborOffset + neighborIndex]!;
      if (roadMask[neighborTile] === 0 || (distances[neighborTile]! >= 0 && distances[neighborTile]! <= nextDistance)) {
        continue;
      }
      distances[neighborTile] = nextDistance;
      queue[tail] = neighborTile;
      tail += 1;
    }
  }

  return distances;
}

function getRoadConnectionDistanceFromMap(storage: RoomStampAnchor, distances: Int32Array, tile: number): number {
  const coord = fromIndex(tile);
  if (coord.x === storage.x && coord.y === storage.y) {
    return 0;
  }

  let best = -1;
  if (range(storage, coord) <= 1) {
    best = range(storage, coord);
  }

  const neighborOffset = tile * maxNeighbors;
  const neighborCount = neighborCounts[tile]!;
  for (let neighborIndex = 0; neighborIndex < neighborCount; neighborIndex += 1) {
    const distance = distances[neighborIndexes[neighborOffset + neighborIndex]!]!;
    if (distance >= 0 && (best < 0 || distance + 1 < best)) {
      best = distance + 1;
    }
  }
  return best;
}

function isBuildableStructureTile(context: StructurePlanningContext, x: number, y: number): boolean {
  if (!isInRoom(x, y)) {
    return false;
  }
  return isBuildableStructureTileByIndex(context, toIndex(x, y));
}

function isBuildableStructureTileByIndex(context: StructurePlanningContext, tile: number): boolean {
  return context.structureAllowed[tile] !== 0 && context.blocked[tile] === 0;
}

function isBuildableAccessRoadTile(context: StructurePlanningContext, x: number, y: number): boolean {
  if (!isInRoom(x, y)) {
    return false;
  }
  return isBuildableAccessRoadTileByIndex(context, toIndex(x, y));
}

function isBuildableAccessRoadTileByIndex(context: StructurePlanningContext, tile: number): boolean {
  return context.accessRoadAllowed[tile] !== 0 && context.baseBlocked[tile] === 0 && context.roadMask[tile] === 0;
}

function isOutsideReservedRanges(
  coord: RoomStampAnchor,
  controller: RoomPlanningObject,
  sources: [RoomPlanningObject, RoomPlanningObject]
): boolean {
  return range(coord, controller) > controllerReserveRange
    && sources.every((source) => range(coord, source) > sourceReserveRange);
}

function getRoadConnectionDistance(context: StructurePlanningContext, tile: number): number {
  let best = unreachableRoadDistance;
  const neighborOffset = tile * maxNeighbors;
  const neighborCount = neighborCounts[tile]!;
  for (let neighborIndex = 0; neighborIndex < neighborCount; neighborIndex += 1) {
    const distance = context.roadDistances[neighborIndexes[neighborOffset + neighborIndex]!]!;
    if (distance >= 0) {
      best = Math.min(best, distance + 1);
    }
  }
  return best;
}

function isAdjacentToRoad(roadMask: Uint8Array, x: number, y: number): boolean {
  return neighbors({ x, y }).some((coord) => roadMask[toIndex(coord.x, coord.y)] !== 0);
}

function collectReachableAccessRoadTiles(roadMask: Uint8Array, accessRoadTiles: Set<number>): Set<number> {
  const reachable = new Set<number>();
  const queue: number[] = [];

  for (const tile of accessRoadTiles) {
    const coord = fromIndex(tile);
    if (isAdjacentToRoad(roadMask, coord.x, coord.y)) {
      reachable.add(tile);
      queue.push(tile);
    }
  }

  while (queue.length > 0) {
    const tile = queue.shift()!;
    for (const coord of neighbors(fromIndex(tile))) {
      const neighborTile = toIndex(coord.x, coord.y);
      if (!accessRoadTiles.has(neighborTile) || reachable.has(neighborTile)) {
        continue;
      }
      reachable.add(neighborTile);
      queue.push(neighborTile);
    }
  }

  return reachable;
}

function createPlacement(kind: PreRampartStructureKind, candidate: Candidate): PreRampartStructurePlacement {
  return {
    kind,
    x: candidate.x,
    y: candidate.y,
    tile: candidate.tile,
    score: candidate.score
  };
}

function getStamps(stampPlan: RoomStampPlan): StampPlacement[] {
  return [
    stampPlan.stamps.hub,
    ...stampPlan.stamps.fastfillers,
    ...(stampPlan.stamps.labs ? [stampPlan.stamps.labs] : [])
  ];
}

function requireObject(room: RoomPlanningRoomData, type: string): RoomPlanningObject {
  const object = room.objects.find((candidate) => candidate.type === type);
  if (!object) {
    throw new Error(`Room '${room.roomName}' is missing required object '${type}'.`);
  }
  return object;
}

function getSources(room: RoomPlanningRoomData): [RoomPlanningObject, RoomPlanningObject] {
  const sources = room.objects.filter((object) => object.type === "source").sort(compareObjects);
  if (sources.length !== 2) {
    throw new Error(`Room '${room.roomName}' must have exactly two sources for pre-rampart structure planning.`);
  }
  return [sources[0]!, sources[1]!];
}

function validateInputs(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  sourceSinkPlan: SourceSinkStructurePlan | null
): void {
  validateTerrain(room.terrain);
  if (room.roomName !== stampPlan.roomName) {
    throw new Error(`Pre-rampart structure planning room mismatch: room '${room.roomName}' received stamp plan for '${stampPlan.roomName}'.`);
  }
  if (room.roomName !== roadPlan.roomName) {
    throw new Error(`Pre-rampart structure planning room mismatch: room '${room.roomName}' received road plan for '${roadPlan.roomName}'.`);
  }
  if (sourceSinkPlan !== null && room.roomName !== sourceSinkPlan.roomName) {
    throw new Error(`Pre-rampart structure planning room mismatch: room '${room.roomName}' received source/sink plan for '${sourceSinkPlan.roomName}'.`);
  }
  if (stampPlan.policy !== roadPlan.policy || (sourceSinkPlan !== null && stampPlan.policy !== sourceSinkPlan.policy)) {
    throw new Error(`Pre-rampart structure planning policy mismatch: stamp plan '${stampPlan.policy}' received incompatible inputs.`);
  }
}

function validateTargetCount(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer, received ${value}.`);
  }
}

function normalizeOptions(options: PreRampartStructurePlanOptions, stampPlan: RoomStampPlan): PreRampartStructurePlanConfig {
  const growAccessRoads = options.growAccessRoads ?? options.growExtensionRoads ?? true;
  const maxAccessRoadTiles = options.maxAccessRoadTiles ?? options.maxExtensionRoadTiles ?? defaultMaxAccessRoadTiles;
  const accessRoadCost = options.accessRoadCost ?? options.extensionRoadCost ?? defaultAccessRoadCost;
  const extensionCount = options.extensionCount ?? Math.max(maxExtensions - stampPlan.stamps.fastfillers.length * fastfillerExtensionsPerPod, 0);
  const towerCount = options.towerCount ?? maxTowers;
  const nukerCount = options.nukerCount ?? maxNukers;
  const observerCount = options.observerCount ?? maxObservers;
  const candidateCount = options.candidateCount ?? extensionCount + towerCount + nukerCount + observerCount;

  return {
    extensionCount,
    towerCount,
    nukerCount,
    observerCount,
    candidateCount,
    growAccessRoads,
    maxAccessRoadTiles,
    accessRoadCost,
    extraRoadTiles: [...new Set(options.extraRoadTiles ?? [])].sort(compareNumbers),
    allowedTiles: options.allowedTiles ? [...new Set(options.allowedTiles)].sort(compareNumbers) : null,
    blockedTiles: [...new Set(options.blockedTiles ?? [])].sort(compareNumbers)
  };
}

function createAllowedMask(allowedTiles: number[] | null): Uint8Array {
  if (allowedTiles === null) {
    return new Uint8Array(Array.from({ length: roomArea }, () => 1));
  }

  const mask = new Uint8Array(roomArea);
  for (const tile of allowedTiles) {
    if (isValidIndex(tile)) {
      mask[tile] = 1;
    }
  }
  return mask;
}

function validateTerrain(terrain: string): void {
  if (terrain.length !== roomArea) {
    throw new Error(`Expected terrain string length ${roomArea}, received ${terrain.length}.`);
  }
}

function isNaturalBlocker(object: RoomPlanningObject): boolean {
  return object.type === "controller" || object.type === "source" || object.type === "mineral" || object.type === "deposit";
}

function neighbors(coord: RoomStampAnchor): RoomStampAnchor[] {
  const result: RoomStampAnchor[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const x = coord.x + dx;
      const y = coord.y + dy;
      if (isInRoom(x, y)) {
        result.push({ x, y });
      }
    }
  }
  return result;
}

function comparePlacementsByTile(left: PreRampartStructurePlacement, right: PreRampartStructurePlacement): number {
  return left.tile - right.tile;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function compareObjects(left: RoomPlanningObject, right: RoomPlanningObject): number {
  if (left.x !== right.x) {
    return left.x - right.x;
  }
  if (left.y !== right.y) {
    return left.y - right.y;
  }
  return left.id.localeCompare(right.id);
}

function range(left: RoomStampAnchor, right: RoomStampAnchor): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function rangeTileToCoord(tile: number, coord: RoomStampAnchor): number {
  return Math.max(Math.abs(tileXs[tile]! - coord.x), Math.abs(tileYs[tile]! - coord.y));
}

function isValidIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < roomArea;
}

function isInRoom(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < roomSize && y >= 0 && y < roomSize;
}

function toIndex(x: number, y: number): number {
  return y * roomSize + x;
}

function fromIndex(index: number): RoomStampAnchor {
  return {
    x: index % roomSize,
    y: Math.floor(index / roomSize)
  };
}

const tileXs = new Uint8Array(roomArea);
const tileYs = new Uint8Array(roomArea);
const neighborIndexes = new Uint16Array(roomArea * maxNeighbors);
const neighborCounts = new Uint8Array(roomArea);

for (let y = 0; y < roomSize; y += 1) {
  for (let x = 0; x < roomSize; x += 1) {
    const index = toIndex(x, y);
    const offset = index * maxNeighbors;
    let count = 0;
    tileXs[index] = x;
    tileYs[index] = y;

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }

        const neighborX = x + dx;
        const neighborY = y + dy;
        if (isInRoom(neighborX, neighborY)) {
          neighborIndexes[offset + count] = toIndex(neighborX, neighborY);
          count += 1;
        }
      }
    }

    neighborCounts[index] = count;
  }
}
