import type { RoomPlanningObject, RoomPlanningRoomData } from "./room-plan.ts";
import type { RoomStampAnchor, RoomStampPlan, StampPlacement } from "./stamp-placement.ts";

const roomSize = 50;
const roomArea = roomSize * roomSize;
const terrainMaskWall = 1;
const defaultPlainCost = 2;
const defaultSwampCost = 10;
const defaultRoadReuseCost = 1;
const defaultControllerReserveRoadCost = 50;
const defaultMaxOps = 10_000;
const controllerReserveRange = 3;

export type RoadPlanPathKind =
  | "storage-to-pod1"
  | "storage-to-pod2"
  | "storage-to-labs"
  | "terminal-to-labs"
  | "terminal-to-mineral"
  | "storage-to-source1"
  | "storage-to-source2"
  | "storage-to-controller";

export type RoadPlanEndpoint = RoomStampAnchor & {
  label: string;
  range: number;
};

export type RoadPlanPath = {
  kind: RoadPlanPathKind;
  origin: RoadPlanEndpoint;
  target: RoadPlanEndpoint;
  tiles: RoomStampAnchor[];
  roadTiles: number[];
  cost: number;
  ops: number;
  incomplete: boolean;
};

export type RoadPlan = {
  roomName: string;
  policy: RoomStampPlan["policy"];
  roadTiles: number[];
  roads: RoomStampAnchor[];
  paths: RoadPlanPath[];
};

export type RoadPlanOptions = {
  plainCost?: number;
  swampCost?: number;
  roadReuseCost?: number;
  controllerReserveRoadCost?: number;
  maxOps?: number;
};

type RoadPlanConfig = Required<RoadPlanOptions>;

type RoadPathRequest = {
  kind: RoadPlanPathKind;
  origin: RoadPlanEndpoint;
  target: RoadPlanEndpoint;
};

type PlanningState = {
  roadMask: Uint8Array;
  paths: RoadPlanPath[];
};

type GroupResult = {
  state: PlanningState;
  roadCount: number;
  cost: number;
};

export function planRoads(room: RoomPlanningRoomData, stampPlan: RoomStampPlan, options: RoadPlanOptions = {}): RoadPlan {
  if (room.roomName !== stampPlan.roomName) {
    throw new Error(`Road plan room mismatch: room '${room.roomName}' received stamp plan for '${stampPlan.roomName}'.`);
  }

  ensurePathFinder();
  const config = normalizeOptions(options);
  const context = createRoadPlanningContext(room, stampPlan);
  let state: PlanningState = {
    roadMask: new Uint8Array(roomArea),
    paths: []
  };

  state = chooseShortestRoadGroup(context, config, state, [
    createPodRequest("storage-to-pod1", context.storage, stampPlan.stamps.fastfillers[0], 1),
    createPodRequest("storage-to-pod2", context.storage, stampPlan.stamps.fastfillers[1], 2)
  ], [
    createPodRequest("storage-to-pod2", context.storage, stampPlan.stamps.fastfillers[1], 2),
    createPodRequest("storage-to-pod1", context.storage, stampPlan.stamps.fastfillers[0], 1)
  ]);

  if (stampPlan.policy === "normal") {
    if (stampPlan.stamps.labs === null) {
      throw new Error("Normal road planning requires a lab stamp.");
    }

    state = chooseShortestRoadGroup(context, config, state, [
      createLabRequest("terminal-to-labs", context.terminal, stampPlan.stamps.labs),
      createLabRequest("storage-to-labs", context.storage, stampPlan.stamps.labs)
    ], [
      createLabRequest("storage-to-labs", context.storage, stampPlan.stamps.labs),
      createLabRequest("terminal-to-labs", context.terminal, stampPlan.stamps.labs)
    ]);
  }

  state = planSequentialPath(context, config, state, {
    kind: "terminal-to-mineral",
    origin: context.terminal,
    target: {
      x: context.mineral.x,
      y: context.mineral.y,
      label: "mineral",
      range: 1
    }
  });

  state = chooseShortestRoadGroup(context, config, state, [
    createSourceRequest("storage-to-source1", context.storage, context.sources[0], 1),
    createSourceRequest("storage-to-source2", context.storage, context.sources[1], 2)
  ], [
    createSourceRequest("storage-to-source2", context.storage, context.sources[1], 2),
    createSourceRequest("storage-to-source1", context.storage, context.sources[0], 1)
  ]);

  state = planSequentialPath(context, config, state, {
    kind: "storage-to-controller",
    origin: context.storage,
    target: {
      x: context.controller.x,
      y: context.controller.y,
      label: "controller",
      range: 3
    }
  });

  const roadTiles = collectRoadTiles(state.roadMask);

  return {
    roomName: room.roomName,
    policy: stampPlan.policy,
    roadTiles,
    roads: roadTiles.map(fromIndex),
    paths: state.paths
  };
}

export function validateRoadPlan(room: RoomPlanningRoomData, stampPlan: RoomStampPlan, roadPlan: RoadPlan): string[] {
  const errors: string[] = [];
  if (roadPlan.roomName !== room.roomName) {
    errors.push(`Road plan room '${roadPlan.roomName}' does not match room '${room.roomName}'.`);
  }
  if (roadPlan.policy !== stampPlan.policy) {
    errors.push(`Road plan policy '${roadPlan.policy}' does not match stamp policy '${stampPlan.policy}'.`);
  }

  const context = createRoadPlanningContext(room, stampPlan);
  const roadTileSet = new Set<number>();
  const pathTileSet = new Set<number>();
  let previousTile = -1;

  for (const tile of roadPlan.roadTiles) {
    if (!isValidIndex(tile)) {
      errors.push(`Road tile index ${tile} is outside the room.`);
      continue;
    }
    if (tile <= previousTile) {
      errors.push("Road tiles must be sorted and unique.");
    }
    previousTile = tile;
    roadTileSet.add(tile);

    const coord = fromIndex(tile);
    if (!isWalkableTerrain(room.terrain, coord.x, coord.y)) {
      errors.push(`Road tile ${coord.x},${coord.y} is on unwalkable terrain.`);
    }
    if (context.blocked[tile] !== 0) {
      errors.push(`Road tile ${coord.x},${coord.y} overlaps a blocked planner tile.`);
    }
  }

  for (const path of roadPlan.paths) {
    if (path.incomplete) {
      errors.push(`${path.kind} path is incomplete.`);
    }
    if (path.tiles.length !== path.roadTiles.length) {
      errors.push(`${path.kind} path tiles and road tile indexes have different lengths.`);
    }

    let previous: RoomStampAnchor = path.origin;
    for (let index = 0; index < path.tiles.length; index += 1) {
      const tile = path.tiles[index]!;
      const tileIndex = toIndex(tile.x, tile.y);
      pathTileSet.add(tileIndex);
      if (path.roadTiles[index] !== tileIndex) {
        errors.push(`${path.kind} road tile ${index} does not match path coordinate ${tile.x},${tile.y}.`);
      }
      if (range(previous, tile) > 1) {
        errors.push(`${path.kind} path jumps from ${previous.x},${previous.y} to ${tile.x},${tile.y}.`);
      }
      previous = tile;
    }

    const finalPosition = path.tiles.at(-1) ?? path.origin;
    if (range(finalPosition, path.target) > path.target.range) {
      errors.push(`${path.kind} ends at ${finalPosition.x},${finalPosition.y}, outside range ${path.target.range} of ${path.target.label}.`);
    }
  }

  for (const tile of pathTileSet) {
    if (!roadTileSet.has(tile)) {
      const coord = fromIndex(tile);
      errors.push(`Path tile ${coord.x},${coord.y} is missing from the road tile set.`);
    }
  }

  for (const tile of roadTileSet) {
    if (!pathTileSet.has(tile)) {
      const coord = fromIndex(tile);
      errors.push(`Road tile ${coord.x},${coord.y} is not used by any path.`);
    }
  }

  const pathKinds = new Set(roadPlan.paths.map((path) => path.kind));
  if (stampPlan.policy === "normal" && !pathKinds.has("terminal-to-labs")) {
    errors.push("Normal road plans must include a terminal-to-labs path.");
  }
  if (stampPlan.policy === "normal" && !pathKinds.has("storage-to-labs")) {
    errors.push("Normal road plans must include a storage-to-labs path.");
  }
  if (stampPlan.policy === "temple" && (pathKinds.has("terminal-to-labs") || pathKinds.has("storage-to-labs"))) {
    errors.push("Temple road plans must not include lab paths.");
  }

  return errors;
}

function createRoadPlanningContext(room: RoomPlanningRoomData, stampPlan: RoomStampPlan): {
  room: RoomPlanningRoomData;
  stampPlan: RoomStampPlan;
  blocked: Uint8Array;
  controllerReserveMask: Uint8Array;
  storage: RoadPlanEndpoint;
  terminal: RoadPlanEndpoint;
  controller: RoomPlanningObject;
  sources: [RoomPlanningObject, RoomPlanningObject];
  mineral: RoomPlanningObject;
} {
  const controller = requireObject(room, "controller");
  const sources = getSources(room);
  const mineral = requireObject(room, "mineral");
  const storage = requireAnchor(stampPlan.stamps.hub, "storage");
  const terminal = requireAnchor(stampPlan.stamps.hub, "terminal");

  return {
    room,
    stampPlan,
    blocked: createBlockedMask(room, stampPlan),
    controllerReserveMask: createControllerReserveMask(controller),
    storage: {
      ...storage,
      label: "storage",
      range: 0
    },
    terminal: {
      ...terminal,
      label: "terminal",
      range: 0
    },
    controller,
    sources,
    mineral
  };
}

function createPodRequest(kind: RoadPlanPathKind, storage: RoadPlanEndpoint, pod: StampPlacement, podNumber: number): RoadPathRequest {
  const container = requireAnchor(pod, "container");
  return {
    kind,
    origin: storage,
    target: {
      ...container,
      label: `pod${podNumber} container`,
      range: 0
    }
  };
}

function createLabRequest(kind: RoadPlanPathKind, origin: RoadPlanEndpoint, labs: StampPlacement): RoadPathRequest {
  return {
    kind,
    origin,
    target: {
      ...requireAnchor(labs, "entrance"),
      label: "lab entrance",
      range: 1
    }
  };
}

function createSourceRequest(kind: RoadPlanPathKind, storage: RoadPlanEndpoint, source: RoomPlanningObject, sourceNumber: number): RoadPathRequest {
  return {
    kind,
    origin: storage,
    target: {
      x: source.x,
      y: source.y,
      label: `source${sourceNumber}`,
      range: 1
    }
  };
}

function chooseShortestRoadGroup(
  context: ReturnType<typeof createRoadPlanningContext>,
  config: RoadPlanConfig,
  initialState: PlanningState,
  firstOrder: RoadPathRequest[],
  secondOrder: RoadPathRequest[]
): PlanningState {
  const firstResult = tryPlanGroup(context, config, initialState, firstOrder);
  const secondResult = tryPlanGroup(context, config, initialState, secondOrder);

  if (firstResult === null && secondResult === null) {
    throw new Error(`No viable road ordering found for ${firstOrder.map((request) => request.kind).join(" + ")}.`);
  }
  if (firstResult === null) {
    return secondResult!.state;
  }
  if (secondResult === null) {
    return firstResult.state;
  }
  if (firstResult.roadCount !== secondResult.roadCount) {
    return firstResult.roadCount < secondResult.roadCount ? firstResult.state : secondResult.state;
  }
  if (firstResult.cost !== secondResult.cost) {
    return firstResult.cost <= secondResult.cost ? firstResult.state : secondResult.state;
  }

  return firstResult.state;
}

function tryPlanGroup(
  context: ReturnType<typeof createRoadPlanningContext>,
  config: RoadPlanConfig,
  initialState: PlanningState,
  requests: RoadPathRequest[]
): GroupResult | null {
  let state = cloneState(initialState);
  try {
    for (const request of requests) {
      state = planSequentialPath(context, config, state, request);
    }
  } catch {
    return null;
  }

  return {
    state,
    roadCount: countRoadTiles(state.roadMask),
    cost: state.paths.slice(initialState.paths.length).reduce((total, path) => total + path.cost, 0)
  };
}

function planSequentialPath(
  context: ReturnType<typeof createRoadPlanningContext>,
  config: RoadPlanConfig,
  state: PlanningState,
  request: RoadPathRequest
): PlanningState {
  const result = searchRoadPath(context, config, state.roadMask, request);
  const roadMask = new Uint8Array(state.roadMask);
  for (const tile of result.roadTiles) {
    roadMask[tile] = 1;
  }

  return {
    roadMask,
    paths: [...state.paths, result]
  };
}

function searchRoadPath(
  context: ReturnType<typeof createRoadPlanningContext>,
  config: RoadPlanConfig,
  roadMask: Uint8Array,
  request: RoadPathRequest
): RoadPlanPath {
  const matrix = createCostMatrix(
    context.blocked,
    roadMask,
    request.kind === "storage-to-controller" ? null : context.controllerReserveMask,
    config
  );
  matrix.set(request.origin.x, request.origin.y, 0);
  const search = PathFinder.search(
    toRoomPosition(request.origin, context.room.roomName),
    {
      pos: toRoomPosition(request.target, context.room.roomName),
      range: request.target.range
    },
    {
      plainCost: config.plainCost,
      swampCost: config.swampCost,
      maxOps: config.maxOps,
      maxRooms: 1,
      roomCallback: (roomName) => roomName === context.room.roomName ? matrix : false
    }
  );
  const tiles = search.path.map((position) => ({ x: position.x, y: position.y }));
  const roadTiles = tiles.map((tile) => toIndex(tile.x, tile.y));
  const finalPosition = tiles.at(-1) ?? request.origin;

  if (search.incomplete || range(finalPosition, request.target) > request.target.range) {
    throw new Error(`No complete road path found for ${request.kind}.`);
  }

  return {
    kind: request.kind,
    origin: request.origin,
    target: request.target,
    tiles,
    roadTiles,
    cost: search.cost,
    ops: search.ops,
    incomplete: search.incomplete
  };
}

function createCostMatrix(
  blocked: Uint8Array,
  roadMask: Uint8Array,
  controllerReserveMask: Uint8Array | null,
  config: RoadPlanConfig
): CostMatrix {
  const matrix = new PathFinder.CostMatrix();

  for (let index = 0; index < roomArea; index += 1) {
    const coord = fromIndex(index);
    if (blocked[index] !== 0) {
      matrix.set(coord.x, coord.y, 255);
      continue;
    }
    if (controllerReserveMask?.[index] !== 0) {
      matrix.set(coord.x, coord.y, config.controllerReserveRoadCost);
      continue;
    }
    if (roadMask[index] !== 0) {
      matrix.set(coord.x, coord.y, config.roadReuseCost);
    }
  }

  return matrix;
}

function createBlockedMask(room: RoomPlanningRoomData, stampPlan: RoomStampPlan): Uint8Array {
  const blocked = new Uint8Array(roomArea);

  for (let index = 0; index < roomArea; index += 1) {
    const coord = fromIndex(index);
    if (!isWalkableTerrain(room.terrain, coord.x, coord.y)) {
      blocked[index] = 1;
    }
  }

  for (const object of room.objects) {
    if (isNaturalBlocker(object)) {
      blocked[toIndex(object.x, object.y)] = 1;
    }
  }

  const stamps = [
    stampPlan.stamps.hub,
    ...stampPlan.stamps.fastfillers,
    ...(stampPlan.stamps.labs ? [stampPlan.stamps.labs] : [])
  ];
  for (const stamp of stamps) {
    for (const tile of stamp.blockedTiles) {
      if (isValidIndex(tile)) {
        blocked[tile] = 1;
      }
    }
  }

  for (const pod of stampPlan.stamps.fastfillers) {
    const container = requireAnchor(pod, "container");
    blocked[toIndex(container.x, container.y)] = 0;
  }

  return blocked;
}

function collectRoadTiles(mask: Uint8Array): number[] {
  const tiles: number[] = [];
  for (let index = 0; index < roomArea; index += 1) {
    if (mask[index] !== 0) {
      tiles.push(index);
    }
  }
  return tiles;
}

function countRoadTiles(mask: Uint8Array): number {
  let count = 0;
  for (const value of mask) {
    if (value !== 0) {
      count += 1;
    }
  }
  return count;
}

function cloneState(state: PlanningState): PlanningState {
  return {
    roadMask: new Uint8Array(state.roadMask),
    paths: [...state.paths]
  };
}

function normalizeOptions(options: RoadPlanOptions): RoadPlanConfig {
  return {
    plainCost: options.plainCost ?? defaultPlainCost,
    swampCost: options.swampCost ?? defaultSwampCost,
    roadReuseCost: options.roadReuseCost ?? defaultRoadReuseCost,
    controllerReserveRoadCost: options.controllerReserveRoadCost ?? defaultControllerReserveRoadCost,
    maxOps: options.maxOps ?? defaultMaxOps
  };
}

function createControllerReserveMask(controller: RoomPlanningObject): Uint8Array {
  const mask = new Uint8Array(roomArea);

  for (let y = Math.max(0, controller.y - controllerReserveRange); y <= Math.min(roomSize - 1, controller.y + controllerReserveRange); y += 1) {
    for (let x = Math.max(0, controller.x - controllerReserveRange); x <= Math.min(roomSize - 1, controller.x + controllerReserveRange); x += 1) {
      if (range({ x, y }, controller) <= controllerReserveRange) {
        mask[toIndex(x, y)] = 1;
      }
    }
  }

  return mask;
}

function requireAnchor(stamp: StampPlacement, name: string): RoomStampAnchor {
  const anchor = stamp.anchors[name];
  if (!anchor) {
    throw new Error(`${stamp.label} is missing required '${name}' anchor.`);
  }
  return anchor;
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
    throw new Error(`Room '${room.roomName}' must have exactly two sources for road planning.`);
  }

  return [sources[0]!, sources[1]!];
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

function isNaturalBlocker(object: RoomPlanningObject): boolean {
  return object.type === "controller" || object.type === "source" || object.type === "mineral" || object.type === "deposit";
}

function toRoomPosition(coord: RoomStampAnchor, roomName: string): RoomPosition {
  return {
    x: coord.x,
    y: coord.y,
    roomName
  } as RoomPosition;
}

function ensurePathFinder(): void {
  if (typeof PathFinder === "undefined" || typeof PathFinder.search !== "function") {
    throw new Error("PathFinder global is not installed.");
  }
}

function isWalkableTerrain(terrain: string, x: number, y: number): boolean {
  return isInRoom(x, y) && (terrain.charCodeAt(toIndex(x, y)) - 48 & terrainMaskWall) === 0;
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
