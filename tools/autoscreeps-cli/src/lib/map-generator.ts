import fs from "node:fs/promises";
import path from "node:path";

export type MapGeneratorConfig = {
  type: "mirrored-random-1x1";
  sourceMapId?: string;
  roomSelectionStrategy?: RoomSelectionStrategy;
  highwayPortals?: HighwayPortalConfig;
};

export type HighwayPortalConfig = {
  type: "wraparound";
  forcePlainEndpoints?: boolean;
  excludeCorners?: boolean;
};

export type RoomSelectionStrategy = {
  type: "max-plains-two-sources" | "center-most-controller";
};

type RemoteMapIndexEntry = {
  id: string;
  width: number | string;
  height: number | string;
};

type MapRoomObject = {
  room?: string;
  type?: string;
  [key: string]: unknown;
};

type MapRoom = {
  room: string;
  terrain: string;
  objects: MapRoomObject[];
  x?: number;
  y?: number;
  status?: string;
  [key: string]: unknown;
};

type RemoteMapFile = {
  rooms: MapRoom[];
};

export type GeneratedExperimentMap = {
  hostFilePath: string;
  label: string;
  rooms: {
    baseline: string;
    candidate: string;
  };
};

type ArenaBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const mapIndexUrl = "https://maps.screepspl.us/maps/index.json";
const mapFileUrl = (mapId: string) => `https://maps.screepspl.us/maps/map-${mapId}.json`;
const sourceEdgeExclusionRange = 2;

export async function generateExperimentMap(config: MapGeneratorConfig, runDir: string): Promise<GeneratedExperimentMap> {
  if (config.type !== "mirrored-random-1x1") {
    throw new Error(`Unsupported map generator type '${config.type}'.`);
  }

  const mapId = config.sourceMapId ?? await pickRandomMapId(1, 1);
  const remoteMap = await fetchJson<RemoteMapFile>(mapFileUrl(mapId));
  const generatedMap = buildMirroredMap(remoteMap.rooms, config.roomSelectionStrategy, config.highwayPortals);
  const hostFilePath = path.join(runDir, "generated-map.json");

  await fs.writeFile(hostFilePath, `${JSON.stringify({ rooms: generatedMap.rooms }, null, 2)}\n`, "utf8");

  return {
    hostFilePath,
    label: `generated:mirrored-random-1x1:${mapId}`,
    rooms: generatedMap.startRooms
  };
}

export function buildMirroredMap(
  sourceRooms: MapRoom[],
  roomSelectionStrategy: RoomSelectionStrategy = { type: "max-plains-two-sources" },
  highwayPortals?: HighwayPortalConfig
): { rooms: MapRoom[]; startRooms: { baseline: string; candidate: string } } {
  const bounds = getMapBounds(sourceRooms);
  const rightShiftX = -bounds.minPlayableX;
  const leftShiftX = rightShiftX - bounds.playableWidth;

  const baselineStartRoom = selectBaselineRoom(sourceRooms, roomSelectionStrategy);
  const baselineMirroredRoom = translateRoomName(baselineStartRoom, leftShiftX, 0);
  const candidateStartRoom = translateRoomName(baselineStartRoom, rightShiftX, 0);

  const rooms = [
    ...sourceRooms
      .filter((room) => roomNameToXY(room.room)[0] !== bounds.maxX)
      .map((room) => cloneRoom(room, leftShiftX, 0)),
    ...sourceRooms
      .filter((room) => roomNameToXY(room.room)[0] !== bounds.minX)
      .map((room) => cloneRoom(room, rightShiftX, 0))
  ];
  const blockedPortalEndpoints = new Set<string>();

  const leftJoinX = leftShiftX + bounds.maxPlayableX;
  const rightJoinX = rightShiftX + bounds.minPlayableX;
  for (const room of rooms) {
    const [x] = roomNameToXY(room.room);
    if (x === leftJoinX) {
      blockRoomEdge(room, "right");
      markBlockedPortalEdge(blockedPortalEndpoints, room, "right");
    }
    if (x === rightJoinX) {
      blockRoomEdge(room, "left");
      markBlockedPortalEdge(blockedPortalEndpoints, room, "left");
    }
  }

  if (highwayPortals?.type === "wraparound") {
    addHighwayWraparoundPortals(
      rooms,
      {
        minX: leftShiftX + bounds.minPlayableX,
        maxX: leftShiftX + bounds.maxPlayableX,
        minY: bounds.minPlayableY,
        maxY: bounds.maxPlayableY
      },
      highwayPortals,
      blockedPortalEndpoints
    );
    addHighwayWraparoundPortals(
      rooms,
      {
        minX: rightShiftX + bounds.minPlayableX,
        maxX: rightShiftX + bounds.maxPlayableX,
        minY: bounds.minPlayableY,
        maxY: bounds.maxPlayableY
      },
      highwayPortals,
      blockedPortalEndpoints
    );
  }

  return {
    rooms,
    startRooms: {
      baseline: baselineMirroredRoom,
      candidate: candidateStartRoom
    }
  };
}

async function pickRandomMapId(width: number, height: number): Promise<string> {
  const index = await fetchJson<RemoteMapIndexEntry[]>(mapIndexUrl);
  const matches = index.filter((entry) => Number(entry.width) === width && Number(entry.height) === height);

  if (matches.length === 0) {
    throw new Error(`No remote maps matched size ${width}x${height}.`);
  }

  const selected = matches[Math.floor(Math.random() * matches.length)];
  return selected!.id;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function selectBaselineRoom(sourceRooms: MapRoom[], roomSelectionStrategy: RoomSelectionStrategy): string {
  if (roomSelectionStrategy.type === "center-most-controller") {
    return selectCenterMostControllerRoom(sourceRooms);
  }

  return selectMaxPlainsTwoSourceRoom(sourceRooms);
}

function selectMaxPlainsTwoSourceRoom(sourceRooms: MapRoom[]): string {
  const candidateRooms = sourceRooms
    .filter((room) => room.status === "normal")
    .filter((room) => countObjects(room, "controller") === 1)
    .filter((room) => countObjects(room, "source") === 2)
    .filter((room) => !hasSourceWithinRangeOfEdge(room, sourceEdgeExclusionRange));

  if (candidateRooms.length === 0) {
    throw new Error("The generated source map did not contain any normal controller rooms with exactly two sources and no source within range 2 of an edge.");
  }

  const controllerCoordinates = candidateRooms.map((room) => roomNameToXY(room.room));
  const centerX = average(controllerCoordinates.map(([x]) => x));
  const centerY = average(controllerCoordinates.map(([, y]) => y));

  candidateRooms.sort((left, right) => {
    const plainsDelta = countPlainTiles(right.terrain) - countPlainTiles(left.terrain);
    if (plainsDelta !== 0) {
      return plainsDelta;
    }

    const [leftX, leftY] = roomNameToXY(left.room);
    const [rightX, rightY] = roomNameToXY(right.room);
    const leftCenterDistance = Math.abs(leftX - centerX) + Math.abs(leftY - centerY);
    const rightCenterDistance = Math.abs(rightX - centerX) + Math.abs(rightY - centerY);
    if (leftCenterDistance !== rightCenterDistance) {
      return leftCenterDistance - rightCenterDistance;
    }

    return left.room.localeCompare(right.room);
  });

  return candidateRooms[0]!.room;
}

function selectCenterMostControllerRoom(sourceRooms: MapRoom[]): string {
  const controllerRooms = sourceRooms
    .filter((room) => room.status === "normal")
    .filter((room) => room.objects.some((object) => object.type === "controller"))
    .filter((room) => !hasSourceWithinRangeOfEdge(room, sourceEdgeExclusionRange));

  if (controllerRooms.length === 0) {
    throw new Error("The generated source map did not contain any controller rooms with no source within range 2 of an edge.");
  }

  const playableCoordinates = controllerRooms.map((room) => roomNameToXY(room.room));
  const centerX = average(playableCoordinates.map(([x]) => x));
  const centerY = average(playableCoordinates.map(([, y]) => y));

  controllerRooms.sort((left, right) => {
    const [leftX, leftY] = roomNameToXY(left.room);
    const [rightX, rightY] = roomNameToXY(right.room);
    const leftScore = Math.abs(leftX - centerX) + Math.abs(leftY - centerY);
    const rightScore = Math.abs(rightX - centerX) + Math.abs(rightY - centerY);

    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    return left.room.localeCompare(right.room);
  });

  return controllerRooms[0]!.room;
}

function countObjects(room: MapRoom, type: string): number {
  return room.objects.filter((object) => object.type === type).length;
}

function hasSourceWithinRangeOfEdge(room: MapRoom, range: number): boolean {
  return room.objects.some((object) => {
    if (object.type !== "source" || typeof object.x !== "number" || typeof object.y !== "number") {
      return false;
    }

    return object.x <= range || object.x >= 49 - range || object.y <= range || object.y >= 49 - range;
  });
}

function countPlainTiles(terrain: string): number {
  let plains = 0;

  for (const cell of terrain) {
    if (cell === "0") {
      plains += 1;
    }
  }

  return plains;
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function getMapBounds(sourceRooms: MapRoom[]): {
  minX: number;
  maxX: number;
  minPlayableX: number;
  maxPlayableX: number;
  minPlayableY: number;
  maxPlayableY: number;
  playableWidth: number;
} {
  const coordinates = sourceRooms.map((room) => roomNameToXY(room.room));
  const playableCoordinates = sourceRooms
    .filter((room) => room.status === "normal")
    .map((room) => roomNameToXY(room.room));

  if (playableCoordinates.length === 0) {
    throw new Error("The source map does not contain any playable rooms.");
  }

  const minX = Math.min(...coordinates.map(([x]) => x));
  const maxX = Math.max(...coordinates.map(([x]) => x));
  const minPlayableX = Math.min(...playableCoordinates.map(([x]) => x));
  const maxPlayableX = Math.max(...playableCoordinates.map(([x]) => x));
  const minPlayableY = Math.min(...playableCoordinates.map(([, y]) => y));
  const maxPlayableY = Math.max(...playableCoordinates.map(([, y]) => y));

  return {
    minX,
    maxX,
    minPlayableX,
    maxPlayableX,
    minPlayableY,
    maxPlayableY,
    playableWidth: maxPlayableX - minPlayableX + 1
  };
}

function addHighwayWraparoundPortals(
  rooms: MapRoom[],
  arena: ArenaBounds,
  config: HighwayPortalConfig,
  blockedPortalEndpoints: Set<string>
): void {
  const roomByName = new Map(rooms.map((room) => [room.room, room]));
  const tiles = edgeTiles(config.excludeCorners ?? true);
  const topY = findHighwayRow(arena, "top");
  const bottomY = findHighwayRow(arena, "bottom");

  if (topY !== undefined && bottomY !== undefined && topY !== bottomY) {
    for (let x = arena.minX; x <= arena.maxX; x += 1) {
      const topRoom = roomByName.get(roomNameFromXY(x, topY));
      const bottomRoom = roomByName.get(roomNameFromXY(x, bottomY));
      if (!isPortalEndpointRoom(topRoom) || !isPortalEndpointRoom(bottomRoom)) {
        continue;
      }

      for (const tileX of tiles) {
        addPortalPair(topRoom, tileX, 0, bottomRoom, tileX, 49, config, blockedPortalEndpoints);
      }
    }
  }

  const leftX = findHighwayColumn(arena, "left");
  const rightX = findHighwayColumn(arena, "right");
  if (leftX !== undefined && rightX !== undefined && leftX !== rightX) {
    for (let y = arena.minY; y <= arena.maxY; y += 1) {
      const leftRoom = roomByName.get(roomNameFromXY(leftX, y));
      const rightRoom = roomByName.get(roomNameFromXY(rightX, y));
      if (!isPortalEndpointRoom(leftRoom) || !isPortalEndpointRoom(rightRoom)) {
        continue;
      }

      for (const tileY of tiles) {
        addPortalPair(leftRoom, 0, tileY, rightRoom, 49, tileY, config, blockedPortalEndpoints);
      }
    }
  }
}

function findHighwayRow(arena: ArenaBounds, side: "top" | "bottom"): number | undefined {
  const step = side === "top" ? 1 : -1;
  const end = side === "top" ? arena.maxY : arena.minY;

  for (let y = side === "top" ? arena.minY : arena.maxY; ; y += step) {
    if (isHighwayRow(y)) {
      return y;
    }
    if (y === end) {
      return undefined;
    }
  }
}

function findHighwayColumn(arena: ArenaBounds, side: "left" | "right"): number | undefined {
  const step = side === "left" ? 1 : -1;
  const end = side === "left" ? arena.maxX : arena.minX;

  for (let x = side === "left" ? arena.minX : arena.maxX; ; x += step) {
    if (isHighwayColumn(x)) {
      return x;
    }
    if (x === end) {
      return undefined;
    }
  }
}

function isPortalEndpointRoom(room: MapRoom | undefined): room is MapRoom {
  return room?.status === "normal" && isHighwayRoom(room.room);
}

function edgeTiles(excludeCorners: boolean): number[] {
  const start = excludeCorners ? 1 : 0;
  const end = excludeCorners ? 48 : 49;
  const tiles: number[] = [];

  for (let tile = start; tile <= end; tile += 1) {
    tiles.push(tile);
  }

  return tiles;
}

function markBlockedPortalEdge(blockedPortalEndpoints: Set<string>, room: MapRoom, side: "left" | "right"): void {
  const x = side === "left" ? 0 : 49;

  for (let y = 0; y < 50; y += 1) {
    blockedPortalEndpoints.add(portalEndpointKey(room.room, x, y));
  }
}

function isBlockedPortalEndpoint(blockedPortalEndpoints: Set<string>, room: MapRoom, x: number, y: number): boolean {
  return blockedPortalEndpoints.has(portalEndpointKey(room.room, x, y));
}

function portalEndpointKey(room: string, x: number, y: number): string {
  return `${room}:${x}:${y}`;
}

function addPortalPair(
  firstRoom: MapRoom,
  firstX: number,
  firstY: number,
  secondRoom: MapRoom,
  secondX: number,
  secondY: number,
  config: HighwayPortalConfig,
  blockedPortalEndpoints: Set<string>
): void {
  addPortal(firstRoom, firstX, firstY, secondRoom, secondX, secondY, config, blockedPortalEndpoints);
  addPortal(secondRoom, secondX, secondY, firstRoom, firstX, firstY, config, blockedPortalEndpoints);
}

function addPortal(
  originRoom: MapRoom,
  originX: number,
  originY: number,
  destinationRoom: MapRoom,
  destinationX: number,
  destinationY: number,
  config: HighwayPortalConfig,
  blockedPortalEndpoints: Set<string>
): void {
  if (config.forcePlainEndpoints && !isBlockedPortalEndpoint(blockedPortalEndpoints, originRoom, originX, originY)) {
    originRoom.terrain = setPlainTerrain(originRoom.terrain, originX, originY);
  }

  originRoom.objects.push({
    type: "portal",
    room: originRoom.room,
    x: originX,
    y: originY,
    destination: { x: destinationX, y: destinationY, room: destinationRoom.room }
  });
}

function setPlainTerrain(terrain: string, x: number, y: number): string {
  const chars = terrain.split("");
  chars[y * 50 + x] = "0";
  return chars.join("");
}

function cloneRoom(room: MapRoom, deltaX: number, deltaY: number): MapRoom {
  const nextRoomName = translateRoomName(room.room, deltaX, deltaY);

  return {
    ...room,
    room: nextRoomName,
    x: typeof room.x === "number" ? room.x + deltaX : room.x,
    y: typeof room.y === "number" ? room.y + deltaY : room.y,
    objects: room.objects.map((object) => cloneObject(object, nextRoomName))
  };
}

function cloneObject(object: MapRoomObject, roomName: string): MapRoomObject {
  const { room: _room, _id: _id, ...rest } = object;

  return {
    ...rest,
    room: roomName
  };
}

function blockRoomEdge(room: MapRoom, side: "left" | "right"): void {
  room.terrain = wallTerrainEdge(room.terrain, side);

  if (isRecord(room.exits)) {
    delete room.exits[side];
  }

  if (isRecord(room.opts) && isRecord(room.opts.exits)) {
    delete room.opts.exits[side];
  }
}

function wallTerrainEdge(terrain: string, side: "left" | "right"): string {
  const chars = terrain.split("");
  const x = side === "left" ? 0 : 49;

  for (let y = 0; y < 50; y += 1) {
    const index = y * 50 + x;
    const value = Number(chars[index] ?? "0") | 1;
    chars[index] = String(value);
  }

  return chars.join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function translateRoomName(roomName: string, deltaX: number, deltaY: number): string {
  const [x, y] = roomNameToXY(roomName);
  return roomNameFromXY(x + deltaX, y + deltaY);
}

function roomNameToXY(name: string): [number, number] {
  const match = name.toUpperCase().match(/^(\w)(\d+)(\w)(\d+)$/);
  if (!match) {
    throw new Error(`Invalid room name '${name}'.`);
  }

  const [, horizontal, rawX, vertical, rawY] = match;
  const x = horizontal === "W" ? -Number(rawX) - 1 : Number(rawX);
  const y = vertical === "N" ? -Number(rawY) - 1 : Number(rawY);
  return [x, y];
}

function isHighwayRoom(name: string): boolean {
  const match = name.toUpperCase().match(/^(\w)(\d+)(\w)(\d+)$/);
  if (!match) {
    throw new Error(`Invalid room name '${name}'.`);
  }

  const [, , rawX, , rawY] = match;
  return Number(rawX) % 10 === 0 || Number(rawY) % 10 === 0;
}

function isHighwayRow(y: number): boolean {
  return roomCoordinateToSectorIndex(y) % 10 === 0;
}

function isHighwayColumn(x: number): boolean {
  return roomCoordinateToSectorIndex(x) % 10 === 0;
}

function roomCoordinateToSectorIndex(coordinate: number): number {
  return coordinate < 0 ? -coordinate - 1 : coordinate;
}

function roomNameFromXY(x: number, y: number): string {
  const horizontal = x < 0 ? `W${-x - 1}` : `E${x}`;
  const vertical = y < 0 ? `N${-y - 1}` : `S${y}`;
  return `${horizontal}${vertical}`;
}
