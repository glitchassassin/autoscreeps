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
const structureRoadGroups: RoadPlanPathKind[][] = [
  ["storage-to-pod1", "storage-to-pod2"],
  ["terminal-to-labs", "storage-to-controller", "terminal-to-mineral", "storage-to-source1", "storage-to-source2"]
];

export type PreRampartStructureKind = "extension" | "tower";

export type PreRampartStructurePlacement = RoomStampAnchor & {
  kind: PreRampartStructureKind;
  tile: number;
  score: number[];
};

export type PreRampartStructurePlan = {
  roomName: string;
  policy: RoomStampPlan["policy"];
  extensions: PreRampartStructurePlacement[];
  towers: PreRampartStructurePlacement[];
  structures: PreRampartStructurePlacement[];
  structureTiles: number[];
};

export type PreRampartStructurePlanOptions = {
  extensionCount?: number;
  towerCount?: number;
};

type StructurePlanningContext = {
  room: RoomPlanningRoomData;
  stampPlan: RoomStampPlan;
  roadPlan: RoadPlan;
  controller: RoomPlanningObject;
  sources: [RoomPlanningObject, RoomPlanningObject];
  storage: RoomStampAnchor;
  blocked: Uint8Array;
  roadMask: Uint8Array;
  roadDistances: Int32Array;
};

type Candidate = RoomStampAnchor & {
  tile: number;
  score: number[];
};

export function planPreRampartStructures(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  options: PreRampartStructurePlanOptions = {}
): PreRampartStructurePlan {
  const context = createStructurePlanningContext(room, stampPlan, roadPlan);
  const extensionCount = options.extensionCount ?? Math.max(maxExtensions - stampPlan.stamps.fastfillers.length * fastfillerExtensionsPerPod, 0);
  const towerCount = options.towerCount ?? maxTowers;
  validateTargetCount(extensionCount, "extensionCount");
  validateTargetCount(towerCount, "towerCount");

  const extensions = placeExtensions(context, extensionCount);
  for (const extension of extensions) {
    context.blocked[extension.tile] = 1;
  }

  const towers = placeTowers(context, towerCount);
  const structures = [...extensions, ...towers].sort(comparePlacementsByTile);

  return {
    roomName: room.roomName,
    policy: stampPlan.policy,
    extensions,
    towers,
    structures,
    structureTiles: structures.map((placement) => placement.tile)
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
  const seen = new Set<number>();
  for (const placement of plan.structures) {
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

  const expectedTiles = [...plan.structures].sort(comparePlacementsByTile).map((placement) => placement.tile);
  if (plan.structureTiles.join(",") !== expectedTiles.join(",")) {
    errors.push("Pre-rampart structure tiles must match sorted structure placements.");
  }

  return errors;
}

function placeExtensions(context: StructurePlanningContext, targetCount: number): PreRampartStructurePlacement[] {
  const candidates = collectRoadAdjacentCandidates(context, structureRoadGroups);
  const placements: PreRampartStructurePlacement[] = [];

  for (const candidate of candidates) {
    if (placements.length >= targetCount) {
      break;
    }
    if (context.blocked[candidate.tile] !== 0) {
      continue;
    }
    const placement = createPlacement("extension", candidate);
    placements.push(placement);
    context.blocked[placement.tile] = 1;
  }

  return placements;
}

function placeTowers(context: StructurePlanningContext, targetCount: number): PreRampartStructurePlacement[] {
  const candidates = collectRoadAdjacentCandidates(context, structureRoadGroups);
  const placements: PreRampartStructurePlacement[] = [];

  while (placements.length < targetCount) {
    let best: Candidate | null = null;
    for (const candidate of candidates) {
      if (context.blocked[candidate.tile] !== 0) {
        continue;
      }

      const spread = placements.length === 0
        ? 0
        : Math.min(...placements.map((placement) => range(candidate, placement)));
      const score = [
        candidate.score[0] ?? 0,
        -spread,
        candidate.score[1] ?? unreachableRoadDistance,
        candidate.y,
        candidate.x
      ];
      if (best === null || compareScore(score, best.score) < 0) {
        best = {
          ...candidate,
          score
        };
      }
    }

    if (best === null) {
      break;
    }

    const placement = createPlacement("tower", best);
    placements.push(placement);
    context.blocked[placement.tile] = 1;
  }

  return placements;
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

  return [...bestByTile.values()].sort(compareCandidates);
}

function collectPathAdjacentCandidates(
  context: StructurePlanningContext,
  path: RoadPlanPath,
  groupIndex: number,
  bestByTile: Map<number, Candidate>
): void {
  for (const roadTile of path.roadTiles) {
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
  const blocked = new Uint8Array(roomArea);
  const roadMask = new Uint8Array(roomArea);

  for (let tile = 0; tile < roomArea; tile += 1) {
    const coord = fromIndex(tile);
    if (!isWalkableTerrain(room.terrain, coord.x, coord.y)) {
      blocked[tile] = 1;
    }
  }

  for (const object of room.objects) {
    if (isNaturalBlocker(object) && isInRoom(object.x, object.y)) {
      blocked[toIndex(object.x, object.y)] = 1;
    }
  }

  for (const stamp of getStamps(stampPlan)) {
    for (const tile of stamp.blockedTiles) {
      if (isValidIndex(tile)) {
        blocked[tile] = 1;
      }
    }
  }

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
    blocked,
    roadMask,
    roadDistances
  };
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
