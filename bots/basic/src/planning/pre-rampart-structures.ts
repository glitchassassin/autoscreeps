import type { RoadPlan, RoadPlanPath, RoadPlanPathKind } from "./road-plan.ts";
import type { RoomPlanningObject, RoomPlanningRoomData } from "./room-plan.ts";
import type { RoomStampAnchor, RoomStampPlan, StampPlacement } from "./stamp-placement.ts";

const roomSize = 50;
const roomArea = roomSize * roomSize;
const terrainMaskWall = 1;
const controllerReserveRange = 3;
const sourceReserveRange = 2;
const edgeReserveRange = 2;
const maxExtensions = 60;
const fastfillerExtensionsPerPod = 12;
const maxTowers = 6;
const unreachableRoadDistance = 1_000_000;
const defaultMaxAccessRoadTiles = 24;
const defaultAccessRoadCost = 4;
const accessRoadGroupIndex = 1;
const structureRoadGroups: RoadPlanPathKind[][] = [
  ["storage-to-pod1", "storage-to-pod2"],
  ["terminal-to-labs", "storage-to-controller", "terminal-to-mineral", "storage-to-source1", "storage-to-source2"]
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
  accessRoadTiles: number[];
  accessRoads: RoomStampAnchor[];
  extraStructures: PreRampartStructurePlacement[];
  structureTiles: number[];
};

export type PreRampartStructurePlanOptions = {
  extensionCount?: number;
  towerCount?: number;
  growAccessRoads?: boolean;
  maxAccessRoadTiles?: number;
  accessRoadCost?: number;
  growExtensionRoads?: boolean;
  maxExtensionRoadTiles?: number;
  extensionRoadCost?: number;
};

type StructurePlanningContext = {
  room: RoomPlanningRoomData;
  stampPlan: RoomStampPlan;
  roadPlan: RoadPlan;
  controller: RoomPlanningObject;
  sources: [RoomPlanningObject, RoomPlanningObject];
  storage: RoomStampAnchor;
  baseBlocked: Uint8Array;
  blocked: Uint8Array;
  roadMask: Uint8Array;
  roadDistances: Int32Array;
  accessRoadTiles: number[];
};

type Candidate = RoomStampAnchor & {
  tile: number;
  score: number[];
};

type PreRampartStructurePlanConfig = {
  extensionCount: number;
  towerCount: number;
  growAccessRoads: boolean;
  maxAccessRoadTiles: number;
  accessRoadCost: number;
};

type ExtensionAllocationScore = {
  totalDistance: number;
  selectedCount: number;
};

export function planPreRampartStructures(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  options: PreRampartStructurePlanOptions = {}
): PreRampartStructurePlan {
  const config = normalizeOptions(options, stampPlan);
  const context = createStructurePlanningContext(room, stampPlan, roadPlan);
  const structureCount = config.extensionCount + config.towerCount;
  validateTargetCount(config.extensionCount, "extensionCount");
  validateTargetCount(config.towerCount, "towerCount");
  validateTargetCount(config.maxAccessRoadTiles, "maxAccessRoadTiles");
  validateTargetCount(config.accessRoadCost, "accessRoadCost");

  if (config.growAccessRoads && structureCount > 0 && config.maxAccessRoadTiles > 0) {
    growAccessRoads(context, structureCount, config);
  }
  const extraStructures = placeExtraStructures(context, structureCount);
  for (const structure of extraStructures) {
    context.blocked[structure.tile] = 1;
  }

  return {
    roomName: room.roomName,
    policy: stampPlan.policy,
    extensionCount: config.extensionCount,
    towerCount: config.towerCount,
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
  plan: PreRampartStructurePlan
): string[] {
  const errors: string[] = [];
  if (plan.roomName !== room.roomName) {
    errors.push(`Pre-rampart structure plan room '${plan.roomName}' does not match room '${room.roomName}'.`);
  }
  if (plan.policy !== stampPlan.policy) {
    errors.push(`Pre-rampart structure plan policy '${plan.policy}' does not match stamp policy '${stampPlan.policy}'.`);
  }

  const context = createStructurePlanningContext(room, stampPlan, roadPlan);
  const seenRoads = new Set<number>();
  for (const tile of plan.accessRoadTiles) {
    if (!isValidIndex(tile)) {
      errors.push(`Access road tile index ${tile} is outside the room.`);
      continue;
    }
    if (seenRoads.has(tile)) {
      errors.push("Access road tiles must be unique.");
    }
    seenRoads.add(tile);

    const coord = fromIndex(tile);
    if (!isBuildableAccessRoadTile(context, coord.x, coord.y)) {
      errors.push(`Access road tile ${coord.x},${coord.y} is not buildable.`);
    }
    if (!isAdjacentToRoad(context.roadMask, coord.x, coord.y)) {
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
  const candidates = collectRoadAdjacentCandidates(context, structureRoadGroups);
  let totalDistance = 0;
  let selectedCount = 0;

  for (const candidate of candidates) {
    if (selectedCount >= targetCount) {
      break;
    }
    totalDistance += candidate.score[1] ?? unreachableRoadDistance;
    selectedCount += 1;
  }

  return {
    totalDistance: totalDistance + (targetCount - selectedCount) * unreachableRoadDistance,
    selectedCount
  };
}

function collectAccessRoadFrontier(context: StructurePlanningContext): number[] {
  const frontier = new Set<number>();

  for (let tile = 0; tile < roomArea; tile += 1) {
    if (context.roadMask[tile] === 0) {
      continue;
    }
    for (const coord of neighbors(fromIndex(tile))) {
      if (isBuildableAccessRoadTile(context, coord.x, coord.y)) {
        frontier.add(toIndex(coord.x, coord.y));
      }
    }
  }

  return [...frontier].sort((left, right) => {
    const leftDistance = getRoadConnectionDistance(context, left);
    const rightDistance = getRoadConnectionDistance(context, right);
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
    return left - right;
  });
}

function collectRoadAdjacentCandidates(context: StructurePlanningContext, groups: RoadPlanPathKind[][]): Candidate[] {
  const bestByTile = new Map<number, Candidate>();

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    for (const kind of groups[groupIndex]!) {
      const path = context.roadPlan.paths.find((candidate) => candidate.kind === kind);
      if (!path) {
        continue;
      }

      collectPathAdjacentCandidates(context, path, groupIndex, bestByTile);
    }
  }
  collectRoadTileAdjacentCandidates(context, context.accessRoadTiles, accessRoadGroupIndex, bestByTile);

  return [...bestByTile.values()].sort(compareCandidates);
}

function collectPathAdjacentCandidates(
  context: StructurePlanningContext,
  path: RoadPlanPath,
  groupIndex: number,
  bestByTile: Map<number, Candidate>
): void {
  collectRoadTileAdjacentCandidates(context, path.roadTiles, groupIndex, bestByTile);
}

function collectRoadTileAdjacentCandidates(
  context: StructurePlanningContext,
  roadTiles: number[],
  groupIndex: number,
  bestByTile: Map<number, Candidate>
): void {
  for (const roadTile of roadTiles) {
    if (!isValidIndex(roadTile)) {
      continue;
    }
    const roadCoord = fromIndex(roadTile);
    for (const coord of neighbors(roadCoord)) {
      if (!isBuildableStructureTile(context, coord.x, coord.y)) {
        continue;
      }

      const tile = toIndex(coord.x, coord.y);
      const roadDistance = context.roadDistances[roadTile]!;
      const score = [
        groupIndex,
        roadDistance >= 0 ? roadDistance + 1 : unreachableRoadDistance + range(coord, context.storage),
        coord.y,
        coord.x
      ];
      const existing = bestByTile.get(tile);
      if (!existing || compareScore(score, existing.score) < 0) {
        bestByTile.set(tile, {
          ...coord,
          tile,
          score
        });
      }
    }
  }
}

function createStructurePlanningContext(room: RoomPlanningRoomData, stampPlan: RoomStampPlan, roadPlan: RoadPlan): StructurePlanningContext {
  validateInputs(room, stampPlan, roadPlan);
  const controller = requireObject(room, "controller");
  const sources = getSources(room);
  const storage = stampPlan.stamps.hub.anchors.storage ?? stampPlan.stamps.hub.anchor;
  const baseBlocked = new Uint8Array(roomArea);
  const roadMask = new Uint8Array(roomArea);

  for (let tile = 0; tile < roomArea; tile += 1) {
    const coord = fromIndex(tile);
    if (!isWalkableTerrain(room.terrain, coord.x, coord.y)) {
      baseBlocked[tile] = 1;
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

  const blocked = new Uint8Array(baseBlocked);
  for (const tile of roadPlan.roadTiles) {
    if (isValidIndex(tile)) {
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
    baseBlocked,
    blocked,
    roadMask,
    roadDistances,
    accessRoadTiles: []
  };
}

function addAccessRoadTile(context: StructurePlanningContext, tile: number): void {
  context.accessRoadTiles.push(tile);
  context.roadMask[tile] = 1;
  context.blocked[tile] = 1;
  context.roadDistances = createRoadDistanceMap(context.storage, context.roadMask);
}

function removeLastAccessRoadTile(context: StructurePlanningContext): void {
  const tile = context.accessRoadTiles.pop();
  if (tile === undefined) {
    return;
  }
  context.roadMask[tile] = 0;
  context.blocked[tile] = context.baseBlocked[tile]!;
  context.roadDistances = createRoadDistanceMap(context.storage, context.roadMask);
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

  for (const coord of neighbors(storage)) {
    const tile = toIndex(coord.x, coord.y);
    if (roadMask[tile] === 0 || distances[tile] >= 0) {
      continue;
    }
    distances[tile] = range(storage, coord);
    queue[tail] = tile;
    tail += 1;
  }

  while (head < tail) {
    const tile = queue[head]!;
    head += 1;
    const nextDistance = distances[tile]! + 1;
    for (const coord of neighbors(fromIndex(tile))) {
      const neighborTile = toIndex(coord.x, coord.y);
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

function isBuildableStructureTile(context: StructurePlanningContext, x: number, y: number): boolean {
  if (!isInRoom(x, y)) {
    return false;
  }
  const tile = toIndex(x, y);
  if (context.blocked[tile] !== 0) {
    return false;
  }
  if (x <= edgeReserveRange || y <= edgeReserveRange || x >= roomSize - 1 - edgeReserveRange || y >= roomSize - 1 - edgeReserveRange) {
    return false;
  }

  const coord = { x, y };
  return range(coord, context.controller) > controllerReserveRange
    && context.sources.every((source) => range(coord, source) > sourceReserveRange);
}

function isBuildableAccessRoadTile(context: StructurePlanningContext, x: number, y: number): boolean {
  if (!isInRoom(x, y)) {
    return false;
  }
  const tile = toIndex(x, y);
  if (context.baseBlocked[tile] !== 0 || context.roadMask[tile] !== 0) {
    return false;
  }
  if (x <= edgeReserveRange || y <= edgeReserveRange || x >= roomSize - 1 - edgeReserveRange || y >= roomSize - 1 - edgeReserveRange) {
    return false;
  }

  const coord = { x, y };
  return range(coord, context.controller) > controllerReserveRange
    && context.sources.every((source) => range(coord, source) > sourceReserveRange);
}

function getRoadConnectionDistance(context: StructurePlanningContext, tile: number): number {
  let best = unreachableRoadDistance;
  for (const coord of neighbors(fromIndex(tile))) {
    const distance = context.roadDistances[toIndex(coord.x, coord.y)]!;
    if (distance >= 0) {
      best = Math.min(best, distance + 1);
    }
  }
  return best;
}

function isAdjacentToRoad(roadMask: Uint8Array, x: number, y: number): boolean {
  return neighbors({ x, y }).some((coord) => roadMask[toIndex(coord.x, coord.y)] !== 0);
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

function validateInputs(room: RoomPlanningRoomData, stampPlan: RoomStampPlan, roadPlan: RoadPlan): void {
  validateTerrain(room.terrain);
  if (room.roomName !== stampPlan.roomName) {
    throw new Error(`Pre-rampart structure planning room mismatch: room '${room.roomName}' received stamp plan for '${stampPlan.roomName}'.`);
  }
  if (room.roomName !== roadPlan.roomName) {
    throw new Error(`Pre-rampart structure planning room mismatch: room '${room.roomName}' received road plan for '${roadPlan.roomName}'.`);
  }
  if (stampPlan.policy !== roadPlan.policy) {
    throw new Error(`Pre-rampart structure planning policy mismatch: stamp plan '${stampPlan.policy}' received road plan '${roadPlan.policy}'.`);
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

  return {
    extensionCount: options.extensionCount ?? Math.max(maxExtensions - stampPlan.stamps.fastfillers.length * fastfillerExtensionsPerPod, 0),
    towerCount: options.towerCount ?? maxTowers,
    growAccessRoads,
    maxAccessRoadTiles,
    accessRoadCost
  };
}

function validateTerrain(terrain: string): void {
  if (terrain.length !== roomArea) {
    throw new Error(`Expected terrain string length ${roomArea}, received ${terrain.length}.`);
  }
}

function isNaturalBlocker(object: RoomPlanningObject): boolean {
  return object.type === "controller" || object.type === "source" || object.type === "mineral" || object.type === "deposit";
}

function isWalkableTerrain(terrain: string, x: number, y: number): boolean {
  return isInRoom(x, y) && (terrain.charCodeAt(toIndex(x, y)) - 48 & terrainMaskWall) === 0;
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

function compareCandidates(left: Candidate, right: Candidate): number {
  const scoreComparison = compareScore(left.score, right.score);
  if (scoreComparison !== 0) {
    return scoreComparison;
  }
  return left.tile - right.tile;
}

function compareScore(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftScore = left[index] ?? 0;
    const rightScore = right[index] ?? 0;
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }
  }
  return 0;
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
