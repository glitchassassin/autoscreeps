import type { RoomPlanningMap, RoomPlanningObject, RoomPlanningRoomData } from "../../src/planning/room-plan.ts";
import { isHighwayRoom, isSourceKeeperRoom } from "../../src/world/room-topology.ts";

type RawMapFile = {
  rooms: RawMapRoom[];
};

type RawMapRoom = {
  room: string;
  status?: string;
  terrain: string;
  objects: RawMapObject[];
};

type RawMapObject = {
  _id?: string;
  room?: string;
  type?: string;
  x?: number;
  y?: number;
  mineralType?: string;
  depositType?: string;
};

export type BrowserPlanningFixture = {
  map: RoomPlanningMap;
  rooms: Map<string, RoomPlanningRoomData>;
  candidateRooms: string[];
};

let cachedFixture: BrowserPlanningFixture | null = null;

export async function loadBrowserPlanningFixture(): Promise<BrowserPlanningFixture> {
  if (cachedFixture !== null) {
    return cachedFixture;
  }

  const response = await fetch(new URL("../../test/fixtures/maps/map-botarena-212.json", import.meta.url));
  if (!response.ok) {
    throw new Error(`Failed to load bundled map fixture: ${response.status} ${response.statusText}`);
  }

  const rawMap = parseRawMap(await response.json());
  const rooms = new Map<string, RoomPlanningRoomData>();
  const candidateRooms: string[] = [];

  for (const rawRoom of rawMap.rooms) {
    const room = normalizeRoom(rawRoom);
    rooms.set(room.roomName, room);
    if (isPlannerCandidate(rawRoom)) {
      candidateRooms.push(room.roomName);
    }
  }

  candidateRooms.sort((left, right) => left.localeCompare(right));
  cachedFixture = {
    rooms,
    candidateRooms,
    map: {
      getRoom(roomName: string): RoomPlanningRoomData | null {
        return rooms.get(roomName) ?? null;
      }
    }
  };
  return cachedFixture;
}

function parseRawMap(input: unknown): RawMapFile {
  if (!input || typeof input !== "object" || !Array.isArray((input as { rooms?: unknown }).rooms)) {
    throw new Error("Room planning fixture must contain a top-level rooms array.");
  }

  return input as RawMapFile;
}

function normalizeRoom(rawRoom: RawMapRoom): RoomPlanningRoomData {
  return {
    roomName: rawRoom.room,
    terrain: rawRoom.terrain,
    objects: rawRoom.objects
      .filter(isPlannerObject)
      .map((object) => ({
        id: object._id ?? `${rawRoom.room}:${object.type}:${object.x},${object.y}`,
        roomName: object.room ?? rawRoom.room,
        type: object.type,
        x: object.x,
        y: object.y,
        mineralType: object.mineralType,
        depositType: object.depositType
      }))
      .sort(compareObjects)
  };
}

function isPlannerCandidate(rawRoom: RawMapRoom): boolean {
  const counts = countObjects(rawRoom.objects);
  return rawRoom.status === "normal"
    && !isHighwayRoom(rawRoom.room)
    && !isSourceKeeperRoom(rawRoom.room)
    && counts.controller === 1
    && counts.source === 2
    && counts.mineral === 1;
}

function countObjects(objects: RawMapObject[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const object of objects) {
    if (object.type) {
      counts[object.type] = (counts[object.type] ?? 0) + 1;
    }
  }
  return counts;
}

function isPlannerObject(object: RawMapObject): object is RawMapObject & Required<Pick<RawMapObject, "type" | "x" | "y">> {
  return typeof object.type === "string"
    && typeof object.x === "number"
    && typeof object.y === "number";
}

function compareObjects(left: RoomPlanningObject, right: RoomPlanningObject): number {
  if (left.type !== right.type) {
    return left.type.localeCompare(right.type);
  }
  if (left.x !== right.x) {
    return left.x - right.x;
  }
  if (left.y !== right.y) {
    return left.y - right.y;
  }
  return left.id.localeCompare(right.id);
}
