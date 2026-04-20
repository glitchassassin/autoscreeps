import { readFileSync } from "node:fs";
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

type RoomPlanningFixture = {
  map: RoomPlanningMap;
  candidateRooms: string[];
};

let cachedFixture: RoomPlanningFixture | null = null;

export function loadBotarena212RoomPlanningFixture(): RoomPlanningFixture {
  if (cachedFixture !== null) {
    return cachedFixture;
  }

  const rawMap = parseRawMap(readFileSync(new URL("../fixtures/maps/map-botarena-212.json", import.meta.url), "utf8"));
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
    map: {
      getRoom(roomName: string): RoomPlanningRoomData | null {
        return rooms.get(roomName) ?? null;
      }
    },
    candidateRooms
  };
  return cachedFixture;
}

function parseRawMap(input: string): RawMapFile {
  const parsed = JSON.parse(input) as unknown;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { rooms?: unknown }).rooms)) {
    throw new Error("Room planning fixture must contain a top-level rooms array.");
  }

  return parsed as RawMapFile;
}

function normalizeRoom(rawRoom: RawMapRoom): RoomPlanningRoomData {
  return {
    roomName: rawRoom.room,
    terrain: rawRoom.terrain,
    objects: rawRoom.objects
      .filter(isPlannerObject)
      .map((object) => ({
        id: object._id,
        roomName: object.room,
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
    && counts.source === 2;
}

function countObjects(objects: RawMapObject[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const object of objects) {
    if (!object.type) {
      continue;
    }

    counts[object.type] = (counts[object.type] ?? 0) + 1;
  }

  return counts;
}

function isPlannerObject(object: RawMapObject): object is RawMapObject & Required<Pick<RawMapObject, "_id" | "room" | "type" | "x" | "y">> {
  return typeof object._id === "string"
    && typeof object.room === "string"
    && typeof object.type === "string"
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
