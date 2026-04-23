import { createDijkstraMap, dijkstraUnreachable, type DijkstraMap } from "./dijkstra-map.ts";
import type { PreRampartStructurePlan } from "./pre-rampart-structures.ts";
import type { RoadPlan, RoadPlanPath, RoadPlanPathKind } from "./road-plan.ts";
import type { RoomPlanningObject, RoomPlanningRoomData } from "./room-plan.ts";
import type { RoomStampAnchor, RoomStampPlan, StampPlacement, StampRotation } from "./stamp-placement.ts";

const roomSize = 50;
const roomArea = roomSize * roomSize;
const terrainMaskWall = 1;

export type PlannedStructureType =
  | "container"
  | "extension"
  | "extractor"
  | "factory"
  | "lab"
  | "link"
  | "nuker"
  | "observer"
  | "powerSpawn"
  | "rampart"
  | "road"
  | "spawn"
  | "storage"
  | "terminal"
  | "tower";

export type PlannedStructurePlacement = RoomStampAnchor & {
  type: PlannedStructureType;
  tile: number;
  label: string;
  rcl: number;
  removeAtRcl?: number;
};

type Coord = RoomStampAnchor;

type SourceSinkOptions = {
  strictLinks?: boolean;
  blockedTiles?: Iterable<number>;
};

export function createStampStructurePlacements(stampPlan: RoomStampPlan): PlannedStructurePlacement[] {
  const structures: PlannedStructurePlacement[] = [
    ...createHubStructurePlacements(stampPlan),
    ...stampPlan.stamps.fastfillers.flatMap((pod, index) => createFastfillerStructurePlacements(pod, index + 1))
  ];

  if (stampPlan.policy === "normal" && stampPlan.stamps.labs !== null) {
    structures.push(...createLabStructurePlacements(stampPlan.stamps.labs));
  }

  return sortPlacements(dedupePlacements(structures));
}

export function createSourceSinkStructurePlacements(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  options: SourceSinkOptions = {}
): PlannedStructurePlacement[] {
  const strictLinks = options.strictLinks ?? true;
  const blockedTiles = new Set(options.blockedTiles ?? []);
  const structures: PlannedStructurePlacement[] = [];
  const sources = getSources(room);
  const roadMask = createRoadMask(roadPlan);
  const naturalBlockers = createNaturalBlockerMask(room);
  const hubCenter = stampPlan.stamps.hub.anchors.hubCenter ?? stampPlan.stamps.hub.anchor;
  const hubDistanceMap = createDijkstraMap(room.terrain, [hubCenter]);

  sources.forEach((source, index) => {
    const path = requirePath(roadPlan, index === 0 ? "storage-to-source1" : "storage-to-source2");
    const endpoint = requirePathEndpoint(path, `source${index + 1}`);
    structures.push(createPlacement("container", endpoint, 2, `source${index + 1}-container`));

    const linkTile = chooseSourceLinkTile(room, source, endpoint, roadMask, naturalBlockers, hubDistanceMap, blockedTiles);
    if (linkTile === null) {
      if (strictLinks) {
        throw new Error(`No source link tile found for ${source.id}.`);
      }
    } else {
      structures.push(createPlacement("link", fromIndex(linkTile), index === 0 ? 5 : 6, `source${index + 1}-link`));
    }
  });

  const mineral = requireObject(room, "mineral");
  const mineralPath = requirePath(roadPlan, "terminal-to-mineral");
  structures.push(createPlacement("container", requirePathEndpoint(mineralPath, "mineral"), 7, "mineral-container"));
  structures.push(createPlacement("extractor", mineral, 6, "mineral-extractor"));

  if (stampPlan.policy !== "temple") {
    const controller = requireObject(room, "controller");
    const controllerPath = requirePath(roadPlan, "storage-to-controller");
    const endpoint = requirePathEndpoint(controllerPath, "controller");
    structures.push({
      ...createPlacement("container", endpoint, 2, "controller-container"),
      removeAtRcl: 7
    });

    const linkTile = chooseControllerLinkTile(room, controller, endpoint, roadMask, naturalBlockers, hubDistanceMap, blockedTiles);
    if (linkTile === null) {
      if (strictLinks) {
        throw new Error(`No controller link tile found for controller '${controller.id}'.`);
      }
    } else {
      structures.push(createPlacement("link", fromIndex(linkTile), 7, "controller-link"));
    }
  }

  return sortPlacements(dedupePlacements(structures));
}

export function collectRampartPostProcessStructureTiles(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  preRampartStructures: PreRampartStructurePlan
): number[] {
  const stampStructures = createStampStructurePlacements(stampPlan);
  return [
    ...new Set([
      ...stampStructures.map((placement) => placement.tile),
      ...createSourceSinkStructurePlacements(room, stampPlan, roadPlan, {
        strictLinks: false,
        blockedTiles: [
          ...preRampartStructures.structureTiles,
          ...stampStructures.map((placement) => placement.tile)
        ]
      }).map((placement) => placement.tile),
      ...preRampartStructures.structureTiles
    ])
  ].sort(compareNumbers);
}

function createHubStructurePlacements(stampPlan: RoomStampPlan): PlannedStructurePlacement[] {
  const hub = stampPlan.stamps.hub;
  const structures: Array<{ type: PlannedStructureType; offset: Coord; rcl: number; label: string }> = [
    { type: "storage" as const, offset: { x: 0, y: 0 }, rcl: 4, label: "hub-storage" },
    { type: "link" as const, offset: { x: 1, y: 0 }, rcl: 5, label: "hub-link" },
    { type: "terminal" as const, offset: { x: 2, y: 0 }, rcl: 6, label: "hub-terminal" },
    { type: "factory" as const, offset: { x: 0, y: 1 }, rcl: 7, label: "hub-factory" },
    { type: "powerSpawn" as const, offset: { x: 0, y: 2 }, rcl: 8, label: "hub-power-spawn" },
    { type: "spawn" as const, offset: { x: 1, y: 2 }, rcl: 1, label: "hub-spawn" }
  ];
  if (stampPlan.policy === "temple") {
    structures.push(
      { type: "lab" as const, offset: { x: 2, y: 2 }, rcl: 6, label: "temple-lab-1" },
      { type: "lab" as const, offset: { x: 3, y: 2 }, rcl: 6, label: "temple-lab-2" },
      { type: "lab" as const, offset: { x: 3, y: 1 }, rcl: 6, label: "temple-lab-3" }
    );
  }

  return structures.map((structure) => createPlacement(
    structure.type,
    applyStampOffset(hub, structure.offset),
    structure.rcl,
    structure.label
  ));
}

function createFastfillerStructurePlacements(pod: StampPlacement, podNumber: number): PlannedStructurePlacement[] {
  const fillerOffsets = new Set(["-1,1", "1,-1"]);
  const containerOffset = { x: 0, y: 0 };
  const spawnOffset = { x: -1, y: 0 };
  const linkOffset = { x: 1, y: 0 };
  const structures: PlannedStructurePlacement[] = [
    createPlacement("container", applyStampOffset(pod, containerOffset), 1, `pod${podNumber}-container`),
    createPlacement("spawn", applyStampOffset(pod, spawnOffset), podNumber === 1 ? 7 : 8, `pod${podNumber}-spawn`),
    createPlacement("link", applyStampOffset(pod, linkOffset), 8, `pod${podNumber}-link`)
  ];

  let extensionIndex = 1;
  for (const offset of fastfillerOffsets()) {
    const key = `${offset.x},${offset.y}`;
    if (
      key === `${containerOffset.x},${containerOffset.y}`
      || key === `${spawnOffset.x},${spawnOffset.y}`
      || key === `${linkOffset.x},${linkOffset.y}`
      || fillerOffsets.has(key)
    ) {
      continue;
    }

    structures.push(createPlacement(
      "extension",
      applyStampOffset(pod, offset),
      8,
      `pod${podNumber}-extension-${extensionIndex.toString().padStart(2, "0")}`
    ));
    extensionIndex += 1;
  }

  return structures;
}

function createLabStructurePlacements(labs: StampPlacement): PlannedStructurePlacement[] {
  const labOffsets = [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 0, y: 2 },
    { x: 1, y: 2 },
    { x: 3, y: 2 },
    { x: 1, y: 3 },
    { x: 2, y: 3 }
  ];
  const roadOffsets = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 3 }
  ];

  return [
    ...roadOffsets.map((offset, index) => createPlacement(
      "road",
      applyStampOffset(labs, offset),
      2,
      `lab-road-${(index + 1).toString().padStart(2, "0")}`
    )),
    ...labOffsets.map((offset, index) => createPlacement(
      "lab",
      applyStampOffset(labs, offset),
      index < 3 ? 6 : index < 6 ? 7 : 8,
      `lab-${(index + 1).toString().padStart(2, "0")}`
    ))
  ];
}

function chooseSourceLinkTile(
  room: RoomPlanningRoomData,
  source: RoomPlanningObject,
  endpoint: RoomStampAnchor,
  roadMask: Uint8Array,
  naturalBlockers: Uint8Array,
  hubDistanceMap: DijkstraMap,
  blockedTiles: Set<number>
): number | null {
  let bestTile: number | null = null;
  let bestScore: number[] | null = null;

  for (const coord of neighbors(endpoint)) {
    const tile = toIndex(coord.x, coord.y);
    if (
      !isWalkableTerrain(room.terrain, coord.x, coord.y)
      || naturalBlockers[tile] !== 0
      || roadMask[tile] !== 0
      || blockedTiles.has(tile)
      || range(coord, source) > 2
    ) {
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

function chooseControllerLinkTile(
  room: RoomPlanningRoomData,
  controller: RoomPlanningObject,
  endpoint: RoomStampAnchor,
  roadMask: Uint8Array,
  naturalBlockers: Uint8Array,
  hubDistanceMap: DijkstraMap,
  blockedTiles: Set<number>
): number | null {
  let bestTile: number | null = null;
  let bestScore: number[] | null = null;

  for (const coord of neighbors(endpoint)) {
    const tile = toIndex(coord.x, coord.y);
    if (
      !isWalkableTerrain(room.terrain, coord.x, coord.y)
      || naturalBlockers[tile] !== 0
      || roadMask[tile] !== 0
      || blockedTiles.has(tile)
      || range(coord, controller) !== 4
    ) {
      continue;
    }

    const distance = hubDistanceMap.get(coord.x, coord.y);
    const score = [
      distance === dijkstraUnreachable ? Number.MAX_SAFE_INTEGER : distance,
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

function requirePath(roadPlan: RoadPlan, kind: RoadPlanPathKind): RoadPlanPath {
  const path = roadPlan.paths.find((candidate) => candidate.kind === kind);
  if (!path) {
    throw new Error(`Road plan for room '${roadPlan.roomName}' is missing required path '${kind}'.`);
  }
  return path;
}

function requirePathEndpoint(path: RoadPlanPath, label: string): RoomStampAnchor {
  return path.tiles.at(-1) ?? path.origin;
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
    throw new Error(`Room '${room.roomName}' must have exactly two sources for structure planning.`);
  }
  return [sources[0]!, sources[1]!];
}

function createPlacement(type: PlannedStructureType, coord: Coord, rcl: number, label: string): PlannedStructurePlacement {
  return {
    type,
    x: coord.x,
    y: coord.y,
    tile: toIndex(coord.x, coord.y),
    label,
    rcl
  };
}

function applyStampOffset(stamp: StampPlacement, offset: Coord): Coord {
  const rotated = rotateOffset(offset, stamp.rotation);
  return {
    x: stamp.anchor.x + rotated.x,
    y: stamp.anchor.y + rotated.y
  };
}

function rotateOffset(offset: Coord, rotation: StampRotation): Coord {
  switch (rotation) {
    case 0:
      return offset;
    case 90:
      return { x: -offset.y, y: offset.x };
    case 180:
      return { x: -offset.x, y: -offset.y };
    case 270:
      return { x: offset.y, y: -offset.x };
  }
}

function fastfillerOffsets(): Coord[] {
  const offsets = new Map<string, Coord>();
  for (const coord of [
    ...rectangleOffsets(3, 3, { x: -2, y: 0 }),
    ...rectangleOffsets(3, 3, { x: 0, y: -2 })
  ]) {
    offsets.set(`${coord.x},${coord.y}`, coord);
  }
  return [...offsets.values()];
}

function rectangleOffsets(width: number, height: number, origin: Coord = { x: 0, y: 0 }): Coord[] {
  const offsets: Coord[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      offsets.push({ x: x + origin.x, y: y + origin.y });
    }
  }
  return offsets;
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

function createNaturalBlockerMask(room: RoomPlanningRoomData): Uint8Array {
  const mask = new Uint8Array(roomArea);
  for (const object of room.objects) {
    if (isNaturalBlocker(object) && isInRoom(object.x, object.y)) {
      mask[toIndex(object.x, object.y)] = 1;
    }
  }
  return mask;
}

function dedupePlacements(placements: PlannedStructurePlacement[]): PlannedStructurePlacement[] {
  const byKey = new Map<string, PlannedStructurePlacement>();
  for (const placement of placements) {
    const key = `${placement.type}:${placement.tile}`;
    if (!byKey.has(key)) {
      byKey.set(key, placement);
    }
  }
  return [...byKey.values()];
}

function sortPlacements<T extends PlannedStructurePlacement>(placements: T[]): T[] {
  return [...placements].sort((left, right) => {
    if (left.tile !== right.tile) {
      return left.tile - right.tile;
    }
    return left.type.localeCompare(right.type);
  });
}

function isNaturalBlocker(object: RoomPlanningObject): boolean {
  return object.type === "controller" || object.type === "source" || object.type === "mineral" || object.type === "deposit";
}

function isWalkableTerrain(terrain: string, x: number, y: number): boolean {
  return isInRoom(x, y) && (terrain.charCodeAt(toIndex(x, y)) - 48 & terrainMaskWall) === 0;
}

function neighbors(coord: Coord): Coord[] {
  const result: Coord[] = [];
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

function range(left: Coord, right: Coord): number {
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

function fromIndex(index: number): Coord {
  return {
    x: index % roomSize,
    y: Math.floor(index / roomSize)
  };
}
