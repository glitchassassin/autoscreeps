import { createDijkstraMap, dijkstraUnreachable, type DijkstraMap } from "./dijkstra-map.ts";
import { createFloodFill } from "./flood-fill.ts";
import {
  planPreRampartStructures,
  validatePreRampartStructurePlan,
  type PreRampartStructurePlan,
  type PreRampartStructurePlanOptions
} from "./pre-rampart-structures.ts";
import type { RoadPlan, RoadPlanPath, RoadPlanPathKind } from "./road-plan.ts";
import type { RoomPlanningObject, RoomPlanningRoomData } from "./room-plan.ts";
import type { RoomStampAnchor, RoomStampPlan, StampPlacement } from "./stamp-placement.ts";
import { solveWeightedMinCut, type WeightedMinCutEdge } from "./weighted-min-cut.ts";

const roomSize = 50;
const roomArea = roomSize * roomSize;
const terrainMaskWall = 1;
const defaultRampartCostScale = 10_000;
const defaultHubDistanceWeight = 1;
const defaultSourceRegionPenaltyRamparts = 8;
const defaultControllerRegionPenaltyRamparts = 8;
const impossibleCapacity = 1_000_000_000;
const maxTowers = 6;
const towerControllerReserveRange = 3;
const towerSourceReserveRange = 2;
const towerEdgeReserveRange = 2;

export type RampartOptionalRegionKey = "source1" | "source2" | "controller";

export type RampartOptionalRegionPlan = {
  key: RampartOptionalRegionKey;
  protected: boolean;
  tiles: number[];
  penalty: number;
};

export type RampartPlanScore = {
  rampartCount: number;
  rampartBaseCost: number;
  rampartDistanceCost: number;
  optionalPenalty: number;
  totalCost: number;
};

export type RampartTowerPlacement = RoomStampAnchor & {
  tile: number;
  minDamage: number;
  averageDamage: number;
};

export type RampartExtensionPlacement = RoomStampAnchor & {
  tile: number;
  score: number[];
};

export type RampartPlan = {
  roomName: string;
  policy: RoomStampPlan["policy"];
  rampartTiles: number[];
  ramparts: RoomStampAnchor[];
  outsideTiles: number[];
  defendedTiles: number[];
  preRampartStructures: PreRampartStructurePlan;
  extensionTiles: number[];
  extensions: RampartExtensionPlacement[];
  towerTiles: number[];
  towers: RampartTowerPlacement[];
  optionalRegions: RampartOptionalRegionPlan[];
  score: RampartPlanScore;
};

export type RampartPlanOptions = {
  rampartCostScale?: number;
  hubDistanceWeight?: number;
  sourceRegionPenaltyRamparts?: number | [number, number];
  controllerRegionPenaltyRamparts?: number;
  preRampartStructures?: PreRampartStructurePlan | null;
  preRampartStructureOptions?: PreRampartStructurePlanOptions;
};

type RampartPlanConfig = {
  rampartCostScale: number;
  hubDistanceWeight: number;
  preRampartStructures: PreRampartStructurePlan | null;
  preRampartStructureOptions: PreRampartStructurePlanOptions;
  sourceRegionPenalties: [number, number];
  controllerRegionPenalty: number;
};

type OptionalRegion = {
  key: RampartOptionalRegionKey;
  tiles: number[];
  penalty: number;
};

type RampartPlanningContext = {
  room: RoomPlanningRoomData;
  stampPlan: RoomStampPlan;
  roadPlan: RoadPlan;
  config: RampartPlanConfig;
  walkable: Uint8Array;
  exits: number[];
  mustDefend: Uint8Array;
  rampartAllowedOnMustDefend: Uint8Array;
  preRampartStructures: PreRampartStructurePlan;
  optionalRegions: OptionalRegion[];
  hubDistanceMap: DijkstraMap;
};

type RoomCutGraph = {
  nodeCount: number;
  source: number;
  sink: number;
  edges: WeightedMinCutEdge[];
  cutEdgeToTile: number[];
  tileCutCosts: Uint32Array;
};

type TowerCandidate = RoomStampAnchor & {
  tile: number;
  coverage: Int32Array;
  sortedCoverage: number[];
  totalCoverage: number;
  spread: number;
  hubDistance: number;
};

export function planRamparts(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  options: RampartPlanOptions = {}
): RampartPlan {
  let config = normalizeOptions(options);
  let context = createRampartPlanningContext(room, stampPlan, roadPlan, config);
  let graph = buildRoomCutGraph(context);
  let result = solveWeightedMinCut({
    nodeCount: graph.nodeCount,
    source: graph.source,
    sink: graph.sink,
    edges: graph.edges
  });

  if (result.maxFlow >= impossibleCapacity / 2) {
    const growAccessRoads = config.preRampartStructureOptions.growAccessRoads
      ?? config.preRampartStructureOptions.growExtensionRoads;
    const canRetryWithoutExtensionRoadGrowth = config.preRampartStructures === null
      && growAccessRoads !== false;
    if (!canRetryWithoutExtensionRoadGrowth) {
      throw new Error(`No finite rampart cut found for room '${room.roomName}'.`);
    }

    config = {
      ...config,
      preRampartStructureOptions: {
        ...config.preRampartStructureOptions,
        growAccessRoads: false,
        growExtensionRoads: false
      }
    };
    context = createRampartPlanningContext(room, stampPlan, roadPlan, config);
    graph = buildRoomCutGraph(context);
    result = solveWeightedMinCut({
      nodeCount: graph.nodeCount,
      source: graph.source,
      sink: graph.sink,
      edges: graph.edges
    });
    if (result.maxFlow >= impossibleCapacity / 2) {
      throw new Error(`No finite rampart cut found for room '${room.roomName}'.`);
    }
  }

  const rampartTiles = collectRampartTiles(result.cutEdgeIndexes, graph.cutEdgeToTile);
  const rampartMask = createTileMask(rampartTiles);
  const outsideMask = createOutsideMask(context.walkable, context.exits, rampartMask);
  const outsideTiles = collectMaskTiles(outsideMask);
  const defendedTiles = collectDefendedTiles(context.walkable, outsideMask, rampartMask);
  const towers = planTowers(context, rampartTiles, defendedTiles);
  const extensions = planExtensions(context.preRampartStructures, towers);
  const optionalRegions = context.optionalRegions.map((region) => createOptionalRegionPlan(region, outsideMask));
  const score = createRampartScore(context, graph, rampartTiles, optionalRegions, result.cutCapacity);

  return {
    roomName: room.roomName,
    policy: stampPlan.policy,
    rampartTiles,
    ramparts: rampartTiles.map(fromIndex),
    outsideTiles,
    defendedTiles,
    preRampartStructures: context.preRampartStructures,
    extensionTiles: extensions.map((extension) => extension.tile).sort(compareNumbers),
    extensions,
    towerTiles: towers.map((tower) => tower.tile).sort(compareNumbers),
    towers,
    optionalRegions,
    score
  };
}

export function validateRampartPlan(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  rampartPlan: RampartPlan,
  options: RampartPlanOptions = {}
): string[] {
  const errors: string[] = [];
  if (rampartPlan.roomName !== room.roomName) {
    errors.push(`Rampart plan room '${rampartPlan.roomName}' does not match room '${room.roomName}'.`);
  }
  if (rampartPlan.policy !== stampPlan.policy) {
    errors.push(`Rampart plan policy '${rampartPlan.policy}' does not match stamp policy '${stampPlan.policy}'.`);
  }

  const context = createRampartPlanningContext(room, stampPlan, roadPlan, normalizeOptions({
    ...options,
    preRampartStructures: rampartPlan.preRampartStructures
  }));
  errors.push(...validatePreRampartStructurePlan(room, stampPlan, roadPlan, rampartPlan.preRampartStructures));
  const rampartMask = new Uint8Array(roomArea);
  let previousTile = -1;

  for (const tile of rampartPlan.rampartTiles) {
    if (!isValidIndex(tile)) {
      errors.push(`Rampart tile index ${tile} is outside the room.`);
      continue;
    }
    if (tile <= previousTile) {
      errors.push("Rampart tiles must be sorted and unique.");
    }
    previousTile = tile;

    const coord = fromIndex(tile);
    if (!isRampartBuildable(context, tile)) {
      errors.push(`Rampart tile ${coord.x},${coord.y} is not buildable for the cut line.`);
    }
    if (context.mustDefend[tile] !== 0 && context.rampartAllowedOnMustDefend[tile] === 0) {
      errors.push(`Rampart tile ${coord.x},${coord.y} overlaps a non-rampartable mandatory defended tile.`);
    }
    rampartMask[tile] = 1;
  }

  const outsideMask = createOutsideMask(context.walkable, context.exits, rampartMask);
  for (let tile = 0; tile < roomArea; tile += 1) {
    if (context.mustDefend[tile] !== 0 && outsideMask[tile] !== 0) {
      const coord = fromIndex(tile);
      errors.push(`Mandatory defended tile ${coord.x},${coord.y} is reachable from an exit.`);
    }
  }

  errors.push(...validateTowerPlan(context, rampartPlan, rampartMask, outsideMask));
  errors.push(...validateExtensionPlan(rampartPlan));

  const optionalByKey = new Map(rampartPlan.optionalRegions.map((region) => [region.key, region]));
  for (const region of context.optionalRegions) {
    const planned = optionalByKey.get(region.key);
    if (!planned) {
      errors.push(`Rampart plan is missing optional region '${region.key}'.`);
      continue;
    }
    const protectedRegion = isRegionProtected(region.tiles, outsideMask);
    if (planned.protected !== protectedRegion) {
      errors.push(`Optional region '${region.key}' protected=${planned.protected} does not match reachability protected=${protectedRegion}.`);
    }
  }

  return errors;
}

function buildRoomCutGraph(context: RampartPlanningContext): RoomCutGraph {
  const source = 0;
  const sink = 1;
  const tileInNodes = new Int32Array(roomArea);
  const tileOutNodes = new Int32Array(roomArea);
  const tileCutCosts = new Uint32Array(roomArea);
  const edges: WeightedMinCutEdge[] = [];
  const cutEdgeToTile: number[] = [];
  let nodeCount = 2;

  tileInNodes.fill(-1);
  tileOutNodes.fill(-1);

  for (let tile = 0; tile < roomArea; tile += 1) {
    if (context.walkable[tile] === 0) {
      continue;
    }
    tileInNodes[tile] = nodeCount;
    nodeCount += 1;
    tileOutNodes[tile] = nodeCount;
    nodeCount += 1;
  }

  for (let tile = 0; tile < roomArea; tile += 1) {
    if (tileInNodes[tile] < 0) {
      continue;
    }

    const cutCost = getTileCutCost(context, tile);
    tileCutCosts[tile] = cutCost;
    const cutEdgeIndex = addEdge(edges, cutEdgeToTile, tileInNodes[tile]!, tileOutNodes[tile]!, cutCost);
    cutEdgeToTile[cutEdgeIndex] = cutCost >= impossibleCapacity ? -1 : tile;

    const coord = fromIndex(tile);
    for (const neighbor of neighbors(coord)) {
      const neighborIndex = toIndex(neighbor.x, neighbor.y);
      if (tileInNodes[neighborIndex] < 0) {
        continue;
      }
      addEdge(edges, cutEdgeToTile, tileOutNodes[tile]!, tileInNodes[neighborIndex]!, impossibleCapacity);
    }
  }

  for (const exitTile of context.exits) {
    addEdge(edges, cutEdgeToTile, source, tileInNodes[exitTile]!, impossibleCapacity);
  }

  for (let tile = 0; tile < roomArea; tile += 1) {
    if (context.mustDefend[tile] !== 0 && tileOutNodes[tile] >= 0) {
      addEdge(edges, cutEdgeToTile, tileOutNodes[tile]!, sink, impossibleCapacity);
    }
  }

  for (const region of context.optionalRegions) {
    const regionNode = nodeCount;
    nodeCount += 1;
    for (const tile of region.tiles) {
      if (tileOutNodes[tile] >= 0) {
        addEdge(edges, cutEdgeToTile, tileOutNodes[tile]!, regionNode, impossibleCapacity);
      }
    }
    addEdge(edges, cutEdgeToTile, regionNode, sink, region.penalty);
  }

  return {
    nodeCount,
    source,
    sink,
    edges,
    cutEdgeToTile,
    tileCutCosts
  };
}

function addEdge(edges: WeightedMinCutEdge[], cutEdgeToTile: number[], from: number, to: number, capacity: number): number {
  const index = edges.length;
  edges.push({ from, to, capacity });
  cutEdgeToTile.push(-1);
  return index;
}

function getTileCutCost(context: RampartPlanningContext, tile: number): number {
  if (!isRampartBuildable(context, tile)) {
    return impossibleCapacity;
  }
  if (context.mustDefend[tile] !== 0 && context.rampartAllowedOnMustDefend[tile] === 0) {
    return impossibleCapacity;
  }

  const coord = fromIndex(tile);
  const distance = context.hubDistanceMap.get(coord.x, coord.y);
  const distanceCost = distance === dijkstraUnreachable ? roomArea * context.config.hubDistanceWeight : distance * context.config.hubDistanceWeight;
  return context.config.rampartCostScale + distanceCost;
}

function createRampartPlanningContext(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  config: RampartPlanConfig
): RampartPlanningContext {
  validateInputs(room, stampPlan, roadPlan);
  const naturalBlockers = createNaturalBlockerMask(room);
  const walkable = createWalkableMask(room.terrain, naturalBlockers);
  const exits = findExitTiles(walkable);
  if (exits.length === 0) {
    throw new Error(`Room '${room.roomName}' has no walkable exits for rampart planning.`);
  }

  const hubCenter = stampPlan.stamps.hub.anchors.hubCenter ?? stampPlan.stamps.hub.anchor;
  const hubDistanceMap = createDijkstraMap(room.terrain, [hubCenter]);
  const roadMask = createRoadMask(roadPlan);
  const preRampartStructures = config.preRampartStructures
    ?? planPreRampartStructures(room, stampPlan, roadPlan, config.preRampartStructureOptions);
  const mustDefend = createMustDefendMask(room, stampPlan, roadPlan, preRampartStructures, walkable);
  const rampartAllowedOnMustDefend = createRampartAllowedOnMustDefendMask(room, stampPlan, roadPlan, preRampartStructures, walkable);
  const optionalRegions = createOptionalRegions(room, roadPlan, walkable, roadMask, hubDistanceMap, config);

  return {
    room,
    stampPlan,
    roadPlan,
    config,
    walkable,
    exits,
    mustDefend,
    rampartAllowedOnMustDefend,
    preRampartStructures,
    optionalRegions,
    hubDistanceMap
  };
}

function createMustDefendMask(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  preRampartStructures: PreRampartStructurePlan,
  walkable: Uint8Array
): Uint8Array {
  const mask = new Uint8Array(roomArea);

  addStampToMask(mask, walkable, stampPlan.stamps.hub);
  for (const pod of stampPlan.stamps.fastfillers) {
    addStampToMask(mask, walkable, pod);
  }
  if (stampPlan.policy === "normal" && stampPlan.stamps.labs !== null) {
    addStampToMask(mask, walkable, stampPlan.stamps.labs);
  }

  addControllerRangeToMask(mask, walkable, requireObject(room, "controller"), 1);

  for (const kind of getMandatoryRoadKinds(stampPlan.policy)) {
    addPathToMask(mask, walkable, requirePath(roadPlan, kind));
  }

  for (const tile of preRampartStructures.accessRoadTiles) {
    if (isValidIndex(tile) && walkable[tile] !== 0) {
      mask[tile] = 1;
    }
  }

  for (const placement of preRampartStructures.extraStructures) {
    if (isValidIndex(placement.tile) && walkable[placement.tile] !== 0) {
      mask[placement.tile] = 1;
    }
  }

  if (stampPlan.policy === "temple") {
    const controller = requireObject(room, "controller");
    for (let y = Math.max(1, controller.y - 3); y <= Math.min(roomSize - 2, controller.y + 3); y += 1) {
      for (let x = Math.max(1, controller.x - 3); x <= Math.min(roomSize - 2, controller.x + 3); x += 1) {
        const tile = toIndex(x, y);
        if (walkable[tile] !== 0 && range({ x, y }, controller) <= 3) {
          mask[tile] = 1;
        }
      }
    }
  }

  return mask;
}

function createRampartAllowedOnMustDefendMask(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  preRampartStructures: PreRampartStructurePlan,
  walkable: Uint8Array
): Uint8Array {
  const mask = new Uint8Array(roomArea);

  addControllerRangeToMask(mask, walkable, requireObject(room, "controller"), 1);

  for (const kind of getMandatoryRoadKinds(stampPlan.policy)) {
    addPathToMask(mask, walkable, requirePath(roadPlan, kind));
  }

  for (const tile of preRampartStructures.accessRoadTiles) {
    if (isValidIndex(tile) && walkable[tile] !== 0) {
      mask[tile] = 1;
    }
  }

  return mask;
}

function addControllerRangeToMask(
  mask: Uint8Array,
  walkable: Uint8Array,
  controller: RoomPlanningObject,
  rangeLimit: number
): void {
  for (let y = Math.max(0, controller.y - rangeLimit); y <= Math.min(roomSize - 1, controller.y + rangeLimit); y += 1) {
    for (let x = Math.max(0, controller.x - rangeLimit); x <= Math.min(roomSize - 1, controller.x + rangeLimit); x += 1) {
      const tile = toIndex(x, y);
      if (walkable[tile] !== 0 && range({ x, y }, controller) <= rangeLimit) {
        mask[tile] = 1;
      }
    }
  }
}

function getMandatoryRoadKinds(policy: RoomStampPlan["policy"]): RoadPlanPathKind[] {
  return [
    "storage-to-pod1",
    "storage-to-pod2",
    ...(policy === "normal" ? ["terminal-to-labs" as const] : [])
  ];
}

function addStampToMask(mask: Uint8Array, walkable: Uint8Array, stamp: StampPlacement): void {
  for (const tile of stamp.blockedTiles) {
    if (isValidIndex(tile) && walkable[tile] !== 0) {
      mask[tile] = 1;
    }
  }
}

function addPathToMask(mask: Uint8Array, walkable: Uint8Array, path: RoadPlanPath): void {
  for (const tile of path.roadTiles) {
    if (isValidIndex(tile) && walkable[tile] !== 0) {
      mask[tile] = 1;
    }
  }
}

function createOptionalRegions(
  room: RoomPlanningRoomData,
  roadPlan: RoadPlan,
  walkable: Uint8Array,
  roadMask: Uint8Array,
  hubDistanceMap: DijkstraMap,
  config: RampartPlanConfig
): OptionalRegion[] {
  const sources = getSources(room);

  const sourceRegions: OptionalRegion[] = sources.map((source, index) => {
    const path = requirePath(roadPlan, index === 0 ? "storage-to-source1" : "storage-to-source2");
    const endpointTile = path.roadTiles.at(-1);
    if (endpointTile === undefined) {
      throw new Error(`${path.kind} path has no source-adjacent endpoint tile.`);
    }

    const endpoint = fromIndex(endpointTile);
    if (range(endpoint, source) > 1) {
      throw new Error(`${path.kind} endpoint ${endpoint.x},${endpoint.y} is not adjacent to ${source.id}.`);
    }

    const tiles = new Set<number>();
    if (walkable[endpointTile] !== 0) {
      tiles.add(endpointTile);
    }

    const linkTile = chooseSourceLinkTile(source, endpoint, walkable, roadMask, hubDistanceMap);
    if (linkTile !== null) {
      tiles.add(linkTile);
    }

    return {
      key: index === 0 ? "source1" as const : "source2" as const,
      tiles: [...tiles].sort((left, right) => left - right),
      penalty: config.sourceRegionPenalties[index]!
    };
  });

  return [
    ...sourceRegions,
    createControllerRegion(room, roadPlan, walkable, config)
  ];
}

function createControllerRegion(
  room: RoomPlanningRoomData,
  roadPlan: RoadPlan,
  walkable: Uint8Array,
  config: RampartPlanConfig
): OptionalRegion {
  const controller = requireObject(room, "controller");
  const path = requirePath(roadPlan, "storage-to-controller");
  const endpointTile = path.roadTiles.at(-1);
  if (endpointTile === undefined) {
    throw new Error("storage-to-controller path has no controller endpoint tile.");
  }

  const endpoint = fromIndex(endpointTile);
  if (range(endpoint, controller) > 3) {
    throw new Error(`storage-to-controller endpoint ${endpoint.x},${endpoint.y} is not in range 3 of the controller.`);
  }

  return {
    key: "controller",
    tiles: path.roadTiles.filter((tile) => isValidIndex(tile) && walkable[tile] !== 0).sort(compareNumbers),
    penalty: config.controllerRegionPenalty
  };
}

function chooseSourceLinkTile(
  source: RoomPlanningObject,
  endpoint: RoomStampAnchor,
  walkable: Uint8Array,
  roadMask: Uint8Array,
  hubDistanceMap: DijkstraMap
): number | null {
  let bestTile: number | null = null;
  let bestScore: number[] | null = null;

  for (const coord of neighbors(endpoint)) {
    const tile = toIndex(coord.x, coord.y);
    if (walkable[tile] === 0 || roadMask[tile] !== 0 || range(coord, source) > 2) {
      continue;
    }

    const distance = hubDistanceMap.get(coord.x, coord.y);
    const score = [
      distance === dijkstraUnreachable ? Number.MAX_SAFE_INTEGER : distance,
      range(coord, source),
      coord.y,
      coord.x
    ];
    if (bestScore === null || compareScore(score, bestScore) < 0) {
      bestScore = score;
      bestTile = tile;
    }
  }

  return bestTile;
}

function createRampartScore(
  context: RampartPlanningContext,
  graph: RoomCutGraph,
  rampartTiles: number[],
  optionalRegions: RampartOptionalRegionPlan[],
  totalCost: number
): RampartPlanScore {
  let rampartDistanceCost = 0;
  for (const tile of rampartTiles) {
    rampartDistanceCost += Math.max(graph.tileCutCosts[tile]! - context.config.rampartCostScale, 0);
  }

  return {
    rampartCount: rampartTiles.length,
    rampartBaseCost: rampartTiles.length * context.config.rampartCostScale,
    rampartDistanceCost,
    optionalPenalty: optionalRegions.reduce((total, region) => total + (region.protected ? 0 : region.penalty), 0),
    totalCost
  };
}

function createOptionalRegionPlan(region: OptionalRegion, outsideMask: Uint8Array): RampartOptionalRegionPlan {
  return {
    key: region.key,
    protected: isRegionProtected(region.tiles, outsideMask),
    tiles: region.tiles,
    penalty: region.penalty
  };
}

function isRegionProtected(tiles: number[], outsideMask: Uint8Array): boolean {
  return tiles.length > 0 && tiles.every((tile) => outsideMask[tile] === 0);
}

function collectRampartTiles(cutEdgeIndexes: number[], cutEdgeToTile: number[]): number[] {
  const tiles: number[] = [];
  for (const edgeIndex of cutEdgeIndexes) {
    const tile = cutEdgeToTile[edgeIndex] ?? -1;
    if (tile >= 0) {
      tiles.push(tile);
    }
  }

  tiles.sort((left, right) => left - right);
  return tiles;
}

function createTileMask(tiles: number[]): Uint8Array {
  const mask = new Uint8Array(roomArea);
  for (const tile of tiles) {
    if (isValidIndex(tile)) {
      mask[tile] = 1;
    }
  }
  return mask;
}

function createOutsideMask(walkable: Uint8Array, exits: number[], rampartMask: Uint8Array): Uint8Array {
  const mask = new Uint8Array(walkable);
  for (let tile = 0; tile < roomArea; tile += 1) {
    if (rampartMask[tile] !== 0) {
      mask[tile] = 0;
    }
  }

  const seeds = exits.filter((tile) => mask[tile] !== 0).map(fromIndex);
  if (seeds.length === 0) {
    return new Uint8Array(roomArea);
  }

  return createFloodFill(mask, seeds).visited;
}

function collectMaskTiles(mask: Uint8Array): number[] {
  const tiles: number[] = [];
  for (let tile = 0; tile < roomArea; tile += 1) {
    if (mask[tile] !== 0) {
      tiles.push(tile);
    }
  }
  return tiles;
}

function collectDefendedTiles(walkable: Uint8Array, outsideMask: Uint8Array, rampartMask: Uint8Array): number[] {
  const tiles: number[] = [];
  for (let tile = 0; tile < roomArea; tile += 1) {
    if (walkable[tile] !== 0 && outsideMask[tile] === 0 && rampartMask[tile] === 0) {
      tiles.push(tile);
    }
  }
  return tiles;
}

function planExtensions(
  preRampartStructures: PreRampartStructurePlan,
  towers: RampartTowerPlacement[]
): RampartExtensionPlacement[] {
  const towerTiles = new Set(towers.map((tower) => tower.tile));
  const extensions: RampartExtensionPlacement[] = [];

  for (const slot of preRampartStructures.extraStructures) {
    if (extensions.length >= preRampartStructures.extensionCount) {
      break;
    }
    if (towerTiles.has(slot.tile)) {
      continue;
    }

    extensions.push({
      x: slot.x,
      y: slot.y,
      tile: slot.tile,
      score: slot.score
    });
  }

  return extensions;
}

function planTowers(context: RampartPlanningContext, rampartTiles: number[], defendedTiles: number[]): RampartTowerPlacement[] {
  if (rampartTiles.length === 0) {
    return [];
  }

  const roadMask = createTowerRoadMask(context.roadPlan, context.preRampartStructures);
  const blocked = createTowerBlockedMask(context, rampartTiles, roadMask);
  const defendedMask = createTileMask(defendedTiles);
  const coverage = new Int32Array(rampartTiles.length);
  const towers: RampartTowerPlacement[] = [];
  const candidateTiles = context.preRampartStructures.extraStructures.map((structure) => structure.tile);
  const targetTowers = Math.min(maxTowers, context.preRampartStructures.towerCount);

  while (towers.length < targetTowers) {
    let best: TowerCandidate | null = null;
    for (const tile of candidateTiles) {
      if (!isTowerCandidateTile(context, tile, defendedMask, roadMask, blocked)) {
        continue;
      }

      const candidate = createTowerCandidate(context, tile, rampartTiles, coverage, towers);
      if (best === null || isBetterTowerCandidate(candidate, best)) {
        best = candidate;
      }
    }

    if (best === null) {
      break;
    }

    coverage.set(best.coverage);
    blocked[best.tile] = 1;
    towers.push({
      x: best.x,
      y: best.y,
      tile: best.tile,
      minDamage: best.sortedCoverage[0] ?? 0,
      averageDamage: best.totalCoverage / rampartTiles.length
    });
  }

  return towers;
}

function createTowerCandidate(
  context: RampartPlanningContext,
  tile: number,
  rampartTiles: number[],
  currentCoverage: Int32Array,
  towers: RampartTowerPlacement[]
): TowerCandidate {
  const coord = fromIndex(tile);
  const coverage = new Int32Array(rampartTiles.length);
  let totalCoverage = 0;
  for (let index = 0; index < rampartTiles.length; index += 1) {
    const damage = currentCoverage[index]! + getTowerDamage(range(coord, fromIndex(rampartTiles[index]!)));
    coverage[index] = damage;
    totalCoverage += damage;
  }
  const sortedCoverage = Array.from(coverage).sort((left, right) => left - right);
  const spread = towers.length === 0
    ? roomSize
    : Math.min(...towers.map((tower) => range(coord, tower)));
  const hubDistance = context.hubDistanceMap.get(coord.x, coord.y);

  return {
    ...coord,
    tile,
    coverage,
    sortedCoverage,
    totalCoverage,
    spread,
    hubDistance: hubDistance === dijkstraUnreachable ? Number.MAX_SAFE_INTEGER : hubDistance
  };
}

function isBetterTowerCandidate(left: TowerCandidate, right: TowerCandidate): boolean {
  const coverageLength = Math.max(left.sortedCoverage.length, right.sortedCoverage.length);
  for (let index = 0; index < coverageLength; index += 1) {
    const leftDamage = left.sortedCoverage[index] ?? 0;
    const rightDamage = right.sortedCoverage[index] ?? 0;
    if (leftDamage !== rightDamage) {
      return leftDamage > rightDamage;
    }
  }

  if (left.totalCoverage !== right.totalCoverage) {
    return left.totalCoverage > right.totalCoverage;
  }
  if (left.spread !== right.spread) {
    return left.spread > right.spread;
  }
  if (left.hubDistance !== right.hubDistance) {
    return left.hubDistance < right.hubDistance;
  }
  if (left.y !== right.y) {
    return left.y < right.y;
  }
  return left.x < right.x;
}

function getTowerDamage(distance: number): number {
  if (distance <= 5) {
    return 600;
  }
  if (distance >= 20) {
    return 150;
  }
  return 750 - 30 * distance;
}

function isTowerCandidateTile(
  context: RampartPlanningContext,
  tile: number,
  defendedMask: Uint8Array,
  roadMask: Uint8Array,
  blocked: Uint8Array
): boolean {
  if (defendedMask[tile] === 0 || blocked[tile] !== 0) {
    return false;
  }

  const coord = fromIndex(tile);
  if (
    coord.x <= towerEdgeReserveRange
    || coord.y <= towerEdgeReserveRange
    || coord.x >= roomSize - 1 - towerEdgeReserveRange
    || coord.y >= roomSize - 1 - towerEdgeReserveRange
  ) {
    return false;
  }
  if (neighbors(coord).every((neighbor) => roadMask[toIndex(neighbor.x, neighbor.y)] === 0)) {
    return false;
  }

  const controller = requireObject(context.room, "controller");
  if (range(coord, controller) <= towerControllerReserveRange) {
    return false;
  }
  return getSources(context.room).every((source) => range(coord, source) > towerSourceReserveRange);
}

function createTowerRoadMask(roadPlan: RoadPlan, preRampartStructures: PreRampartStructurePlan): Uint8Array {
  const mask = createRoadMask(roadPlan);
  for (const tile of preRampartStructures.accessRoadTiles) {
    if (isValidIndex(tile)) {
      mask[tile] = 1;
    }
  }
  return mask;
}

function createTowerBlockedMask(context: RampartPlanningContext, rampartTiles: number[], roadMask: Uint8Array): Uint8Array {
  const blocked = new Uint8Array(roomArea);

  for (let tile = 0; tile < roomArea; tile += 1) {
    if (context.walkable[tile] === 0 || roadMask[tile] !== 0) {
      blocked[tile] = 1;
    }
  }

  for (const stamp of getStamps(context.stampPlan)) {
    for (const tile of stamp.blockedTiles) {
      if (isValidIndex(tile)) {
        blocked[tile] = 1;
      }
    }
  }

  for (const tile of rampartTiles) {
    if (isValidIndex(tile)) {
      blocked[tile] = 1;
    }
  }

  return blocked;
}

function validateTowerPlan(
  context: RampartPlanningContext,
  rampartPlan: RampartPlan,
  rampartMask: Uint8Array,
  outsideMask: Uint8Array
): string[] {
  const errors: string[] = [];
  const towerLimit = Math.min(maxTowers, rampartPlan.preRampartStructures.towerCount);
  if (rampartPlan.towers.length > towerLimit) {
    errors.push(`Rampart plan has ${rampartPlan.towers.length} towers, maximum is ${towerLimit}.`);
  }

  const roadMask = createTowerRoadMask(context.roadPlan, rampartPlan.preRampartStructures);
  const blocked = createTowerBlockedMask(context, rampartPlan.rampartTiles, roadMask);
  const defendedTiles = collectDefendedTiles(context.walkable, outsideMask, rampartMask);
  const defendedMask = createTileMask(defendedTiles);
  const extraStructureTiles = new Set(rampartPlan.preRampartStructures.extraStructures.map((structure) => structure.tile));
  const expectedTowerTiles = rampartPlan.towers.map((tower) => tower.tile).sort(compareNumbers);
  if (rampartPlan.towerTiles.join(",") !== expectedTowerTiles.join(",")) {
    errors.push("Tower tiles must match sorted tower placements.");
  }

  const seen = new Set<number>();
  const coverage = new Int32Array(rampartPlan.rampartTiles.length);
  for (const tower of rampartPlan.towers) {
    if (tower.tile !== toIndex(tower.x, tower.y)) {
      errors.push(`Tower at ${tower.x},${tower.y} has mismatched tile index ${tower.tile}.`);
    }
    if (seen.has(tower.tile)) {
      errors.push(`Multiple towers occupy ${tower.x},${tower.y}.`);
    }
    seen.add(tower.tile);

    if (!extraStructureTiles.has(tower.tile)) {
      errors.push(`Tower at ${tower.x},${tower.y} does not occupy a planned extra-structure slot.`);
    }
    if (!isTowerCandidateTile(context, tower.tile, defendedMask, roadMask, blocked)) {
      errors.push(`Tower at ${tower.x},${tower.y} is not a valid defended tower candidate.`);
    }
    blocked[tower.tile] = 1;

    let minDamage = Number.POSITIVE_INFINITY;
    let totalDamage = 0;
    for (let index = 0; index < rampartPlan.rampartTiles.length; index += 1) {
      const damage = coverage[index]! + getTowerDamage(range(tower, fromIndex(rampartPlan.rampartTiles[index]!)));
      coverage[index] = damage;
      minDamage = Math.min(minDamage, damage);
      totalDamage += damage;
    }

    if (rampartPlan.rampartTiles.length === 0) {
      errors.push(`Tower at ${tower.x},${tower.y} has no ramparts to cover.`);
      continue;
    }

    const averageDamage = totalDamage / rampartPlan.rampartTiles.length;
    if (tower.minDamage !== minDamage) {
      errors.push(`Tower at ${tower.x},${tower.y} has min damage ${tower.minDamage}, expected ${minDamage}.`);
    }
    if (Math.abs(tower.averageDamage - averageDamage) > 0.001) {
      errors.push(`Tower at ${tower.x},${tower.y} has average damage ${tower.averageDamage}, expected ${averageDamage}.`);
    }
  }

  return errors;
}

function validateExtensionPlan(rampartPlan: RampartPlan): string[] {
  const errors: string[] = [];
  if (rampartPlan.extensions.length !== rampartPlan.preRampartStructures.extensionCount) {
    errors.push(`Rampart plan has ${rampartPlan.extensions.length} extensions, expected ${rampartPlan.preRampartStructures.extensionCount}.`);
  }

  const extraStructureTiles = new Set(rampartPlan.preRampartStructures.extraStructures.map((structure) => structure.tile));
  const towerTiles = new Set(rampartPlan.towers.map((tower) => tower.tile));
  const expectedExtensionTiles = rampartPlan.extensions.map((extension) => extension.tile).sort(compareNumbers);
  if (rampartPlan.extensionTiles.join(",") !== expectedExtensionTiles.join(",")) {
    errors.push("Extension tiles must match sorted extension placements.");
  }

  const seen = new Set<number>();
  for (const extension of rampartPlan.extensions) {
    if (extension.tile !== toIndex(extension.x, extension.y)) {
      errors.push(`Extension at ${extension.x},${extension.y} has mismatched tile index ${extension.tile}.`);
    }
    if (seen.has(extension.tile)) {
      errors.push(`Multiple extensions occupy ${extension.x},${extension.y}.`);
    }
    seen.add(extension.tile);

    if (!extraStructureTiles.has(extension.tile)) {
      errors.push(`Extension at ${extension.x},${extension.y} does not occupy a planned extra-structure slot.`);
    }
    if (towerTiles.has(extension.tile)) {
      errors.push(`Extension at ${extension.x},${extension.y} overlaps a tower.`);
    }
  }

  return errors;
}

function createRoadMask(roadPlan: RoadPlan): Uint8Array {
  const mask = new Uint8Array(roomArea);
  for (const tile of roadPlan.roadTiles) {
    if (isValidIndex(tile)) {
      mask[tile] = 1;
    }
  }
  return mask;
}

function createWalkableMask(terrain: string, naturalBlockers: Uint8Array): Uint8Array {
  validateTerrain(terrain);
  const mask = new Uint8Array(roomArea);
  for (let tile = 0; tile < roomArea; tile += 1) {
    if ((terrain.charCodeAt(tile) - 48 & terrainMaskWall) === 0 && naturalBlockers[tile] === 0) {
      mask[tile] = 1;
    }
  }
  return mask;
}

function createNaturalBlockerMask(room: RoomPlanningRoomData): Uint8Array {
  const mask = new Uint8Array(roomArea);
  for (const object of room.objects) {
    if (isNaturalBlocker(object) && isInRoom(object.x, object.y)) {
      mask[toIndex(object.x, object.y)] = 1;
    }
  }
  return mask;
}

function findExitTiles(walkable: Uint8Array): number[] {
  const exits: number[] = [];
  for (let x = 0; x < roomSize; x += 1) {
    addExitIfWalkable(exits, walkable, x, 0);
    addExitIfWalkable(exits, walkable, x, roomSize - 1);
  }
  for (let y = 1; y < roomSize - 1; y += 1) {
    addExitIfWalkable(exits, walkable, 0, y);
    addExitIfWalkable(exits, walkable, roomSize - 1, y);
  }
  return exits;
}

function addExitIfWalkable(exits: number[], walkable: Uint8Array, x: number, y: number): void {
  const tile = toIndex(x, y);
  if (walkable[tile] !== 0) {
    exits.push(tile);
  }
}

function isRampartBuildable(context: RampartPlanningContext, tile: number): boolean {
  const coord = fromIndex(tile);
  const edgeOffset = context.mustDefend[tile] !== 0 && context.rampartAllowedOnMustDefend[tile] !== 0 ? 0 : 1;
  return context.walkable[tile] !== 0
    && coord.x > edgeOffset
    && coord.y > edgeOffset
    && coord.x < roomSize - 1 - edgeOffset
    && coord.y < roomSize - 1 - edgeOffset;
}

function requirePath(roadPlan: RoadPlan, kind: RoadPlanPathKind): RoadPlanPath {
  const path = roadPlan.paths.find((candidate) => candidate.kind === kind);
  if (!path) {
    throw new Error(`Road plan for room '${roadPlan.roomName}' is missing required path '${kind}'.`);
  }
  return path;
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
    throw new Error(`Room '${room.roomName}' must have exactly two sources for rampart planning.`);
  }
  return [sources[0]!, sources[1]!];
}

function normalizeOptions(options: RampartPlanOptions): RampartPlanConfig {
  const rampartCostScale = options.rampartCostScale ?? defaultRampartCostScale;
  const hubDistanceWeight = options.hubDistanceWeight ?? defaultHubDistanceWeight;
  validatePositiveInteger(rampartCostScale, "rampartCostScale");
  validateNonNegativeInteger(hubDistanceWeight, "hubDistanceWeight");

  const rawPenalty = options.sourceRegionPenaltyRamparts ?? defaultSourceRegionPenaltyRamparts;
  const penaltyRamparts = Array.isArray(rawPenalty) ? rawPenalty : [rawPenalty, rawPenalty];
  if (penaltyRamparts.length !== 2) {
    throw new Error("sourceRegionPenaltyRamparts must contain exactly two values.");
  }

  return {
    rampartCostScale,
    hubDistanceWeight,
    preRampartStructures: options.preRampartStructures ?? null,
    preRampartStructureOptions: options.preRampartStructureOptions ?? {},
    controllerRegionPenalty: normalizePenalty(
      options.controllerRegionPenaltyRamparts ?? defaultControllerRegionPenaltyRamparts,
      rampartCostScale,
      "controller"
    ),
    sourceRegionPenalties: [
      normalizePenalty(penaltyRamparts[0]!, rampartCostScale, "source1"),
      normalizePenalty(penaltyRamparts[1]!, rampartCostScale, "source2")
    ]
  };
}

function normalizePenalty(value: number, rampartCostScale: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} optional region penalty must be a finite non-negative number, received ${value}.`);
  }
  return Math.round(value * rampartCostScale);
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, received ${value}.`);
  }
}

function validateNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer, received ${value}.`);
  }
}

function validateInputs(room: RoomPlanningRoomData, stampPlan: RoomStampPlan, roadPlan: RoadPlan): void {
  validateTerrain(room.terrain);
  if (room.roomName !== stampPlan.roomName) {
    throw new Error(`Rampart planning room mismatch: room '${room.roomName}' received stamp plan for '${stampPlan.roomName}'.`);
  }
  if (room.roomName !== roadPlan.roomName) {
    throw new Error(`Rampart planning room mismatch: room '${room.roomName}' received road plan for '${roadPlan.roomName}'.`);
  }
  if (stampPlan.policy !== roadPlan.policy) {
    throw new Error(`Rampart planning policy mismatch: stamp plan '${stampPlan.policy}' received road plan '${roadPlan.policy}'.`);
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

function compareObjects(left: RoomPlanningObject, right: RoomPlanningObject): number {
  if (left.x !== right.x) {
    return left.x - right.x;
  }
  if (left.y !== right.y) {
    return left.y - right.y;
  }
  return left.id.localeCompare(right.id);
}

function compareNumbers(left: number, right: number): number {
  return left - right;
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

function getStamps(stampPlan: RoomStampPlan): StampPlacement[] {
  return [
    stampPlan.stamps.hub,
    ...stampPlan.stamps.fastfillers,
    ...(stampPlan.stamps.labs ? [stampPlan.stamps.labs] : [])
  ];
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
