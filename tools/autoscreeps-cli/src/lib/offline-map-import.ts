import fs from "node:fs/promises";
import net from "node:net";
import zlib from "node:zlib";
import { MongoClient } from "mongodb";

export type OfflineMapImportResult = {
  roomCount: number;
  accessibleRoomCount: number;
  mapUrl: string;
};

type GeneratedMapFile = {
  rooms: GeneratedMapRoom[];
};

type GeneratedMapRoom = {
  room: string;
  terrain: string;
  objects: Array<Record<string, unknown>>;
  status?: string;
  bus?: boolean;
  openTime?: number;
  sourceKeepers?: boolean;
  novice?: boolean | number;
  respawnArea?: boolean | number;
  depositType?: string;
};

export type RoomDoc = {
  _id: string;
  name: string;
  status: string;
  bus?: boolean;
  openTime?: number;
  sourceKeepers?: boolean;
  novice?: boolean | number;
  respawnArea?: boolean | number;
  depositType?: string;
};

type TerrainDoc = {
  room: string;
  terrain: string;
};

type RoomStatusData = {
  novice: Record<string, number>;
  respawn: Record<string, number>;
  closed: Record<string, number | null>;
};

type PendingRedisReply = {
  resolve: (value: string | null) => void;
  reject: (error: Error) => void;
};

const databaseVersion = "9";
const mongoUri = process.env.AUTO_MONGO_URI ?? "mongodb://127.0.0.1:27017/screeps";
const redisHost = process.env.AUTO_REDIS_HOST ?? "127.0.0.1";
const redisPort = Number(process.env.AUTO_REDIS_PORT ?? "6379");
const systemUsers: Array<Record<string, unknown>> = [
  { _id: "2", username: "Invader", usernameLower: "invader", cpu: 100, cpuAvailable: 10000, gcl: 13966610.2, active: 0 },
  { _id: "3", username: "Source Keeper", usernameLower: "source keeper", cpu: 100, cpuAvailable: 10000, gcl: 13966610.2, active: 0 },
  {
    username: "Screeps",
    usernameLower: "screeps",
    gcl: 0,
    cpi: 0,
    active: false,
    cpuAvailable: 0,
    badge: { type: 12, color1: "#999999", color2: "#999999", color3: "#999999", flip: false, param: 26 }
  }
];

export async function importMapFileOffline(hostFilePath: string, mapUrl: string): Promise<OfflineMapImportResult> {
  const map = parseGeneratedMap(await fs.readFile(hostFilePath, "utf8"));
  const roomDocs = map.rooms.map(toRoomDoc);
  const terrainDocs = map.rooms.map((room) => ({ room: room.room, terrain: room.terrain }));
  const objectDocs = map.rooms.flatMap((room) => room.objects.map((object) => ({ ...object, room: room.room })));
  const accessibleRooms = roomDocs
    .filter((room) => room.status === "normal" && (!room.openTime || room.openTime < Date.now()))
    .map((room) => room._id);
  const roomStatusData = buildRoomStatusData(roomDocs);
  const compressedTerrainData = zlib.deflateSync(JSON.stringify(buildTerrainData(roomDocs, terrainDocs))).toString("base64");

  const mongoClient = new MongoClient(mongoUri, { ignoreUndefined: true });
  const redis = await connectRedis();

  try {
    await mongoClient.connect();
    const db = mongoClient.db();
    const collections = await db.collections();
    await Promise.all(collections.map(async (collection) => {
      await collection.deleteMany({});
    }));

    if (roomDocs.length > 0) {
      await db.collection<RoomDoc>("rooms").insertMany(roomDocs);
      await db.collection<TerrainDoc>("rooms.terrain").insertMany(terrainDocs);
    }
    if (objectDocs.length > 0) {
      await db.collection<Record<string, unknown>>("rooms.objects").insertMany(objectDocs);
    }
    await db.collection<Record<string, unknown>>("users").insertMany(systemUsers);

    await redis.command(["FLUSHALL"]);
    await redis.command(["SET", "mainLoopPaused", "1"]);
    await redis.command(["SET", "gameTime", "1"]);
    await redis.command(["SET", "accessibleRooms", JSON.stringify(accessibleRooms)]);
    await redis.command(["SET", "roomStatusData", JSON.stringify(roomStatusData)]);
    await redis.command(["SET", "mapUrl", mapUrl]);
    await redis.command(["SET", "terrainData", compressedTerrainData]);
    await redis.command(["SET", "databaseVersion", databaseVersion]);

    return {
      roomCount: roomDocs.length,
      accessibleRoomCount: accessibleRooms.length,
      mapUrl
    };
  } finally {
    await Promise.allSettled([
      mongoClient.close(),
      redis.close()
    ]);
  }
}

export function buildRoomStatusData(roomDocs: RoomDoc[], now = Date.now()): RoomStatusData {
  const statusData: RoomStatusData = {
    novice: {},
    respawn: {},
    closed: {}
  };

  for (const room of roomDocs) {
    const noviceUntil = getFutureTimestamp(room.novice, now);
    if (noviceUntil !== null) {
      statusData.novice[room._id] = noviceUntil;
      continue;
    }

    const respawnUntil = getFutureTimestamp(room.respawnArea, now);
    if (respawnUntil !== null) {
      statusData.respawn[room._id] = respawnUntil;
      continue;
    }

    if (room.openTime && room.openTime > now) {
      statusData.closed[room._id] = room.openTime;
      continue;
    }

    if (room.status === "out of borders") {
      statusData.closed[room._id] = null;
    }
  }

  return statusData;
}

function getFutureTimestamp(value: boolean | number | undefined, now: number): number | null {
  return typeof value === "number" && value > now ? value : null;
}

function parseGeneratedMap(input: string): GeneratedMapFile {
  const parsed = JSON.parse(input) as unknown;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { rooms?: unknown }).rooms)) {
    throw new Error("Map file must contain a top-level rooms array.");
  }

  for (const room of (parsed as GeneratedMapFile).rooms) {
    if (!room || typeof room.room !== "string" || typeof room.terrain !== "string" || !Array.isArray(room.objects)) {
      throw new Error("Map file contains an invalid room entry.");
    }
  }

  return parsed as GeneratedMapFile;
}

function toRoomDoc(room: GeneratedMapRoom): RoomDoc {
  return {
    _id: room.room,
    name: room.room,
    status: room.status ?? "out of borders",
    bus: room.bus,
    openTime: room.openTime,
    sourceKeepers: room.sourceKeepers,
    novice: room.novice,
    respawnArea: room.respawnArea,
    depositType: room.depositType
  };
}

function buildTerrainData(roomDocs: RoomDoc[], terrainDocs: TerrainDoc[]): TerrainDoc[] {
  const outOfBordersTerrain = "1".repeat(2500);
  const terrainData = terrainDocs.map((doc) => ({ room: doc.room, terrain: doc.terrain }));
  const terrainByRoom = new Map(terrainData.map((doc) => [doc.room, doc] as const));

  for (const room of roomDocs) {
    const terrain = terrainByRoom.get(room._id);
    if (room.status === "out of borders" && terrain) {
      terrain.terrain = outOfBordersTerrain;
    }

    const match = room._id.match(/(W|E)(\d+)(N|S)(\d+)/);
    if (!match) {
      continue;
    }

    const eastNeighbor = `${match[1]}${Number(match[2]) + 1}${match[3]}${match[4]}`;
    const southNeighbor = `${match[1]}${match[2]}${match[3]}${Number(match[4]) + 1}`;
    ensureTerrainEntry(terrainByRoom, terrainData, eastNeighbor, outOfBordersTerrain);
    ensureTerrainEntry(terrainByRoom, terrainData, southNeighbor, outOfBordersTerrain);
  }

  return terrainData;
}

function ensureTerrainEntry(terrainByRoom: Map<string, TerrainDoc>, terrainData: TerrainDoc[], room: string, terrain: string): void {
  if (terrainByRoom.has(room)) {
    return;
  }

  const entry = { room, terrain };
  terrainByRoom.set(room, entry);
  terrainData.push(entry);
}

async function connectRedis(): Promise<{ command(parts: string[]): Promise<string | null>; close(): Promise<void> }> {
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const client = net.createConnection({ host: redisHost, port: redisPort });
    client.once("connect", () => {
      client.off("error", reject);
      resolve(client);
    });
    client.once("error", reject);
  });

  let buffer = "";
  const pending: PendingRedisReply[] = [];

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");

    while (pending.length > 0) {
      const reply = tryParseRedisReply(buffer);
      if (!reply) {
        return;
      }

      buffer = buffer.slice(reply.consumed);
      const waiter = pending.shift();
      if (!waiter) {
        continue;
      }

      if (reply.type === "-") {
        waiter.reject(new Error(reply.value ?? "Redis command failed."));
        continue;
      }

      waiter.resolve(reply.value);
    }
  });

  socket.on("error", (error) => {
    while (pending.length > 0) {
      pending.shift()?.reject(error);
    }
  });

  const command = async (parts: string[]): Promise<string | null> => {
    return await new Promise<string | null>((resolve, reject) => {
      pending.push({ resolve, reject });
      socket.write(encodeRedisCommand(parts), "utf8");
    });
  };

  return {
    command,
    async close(): Promise<void> {
      try {
        await command(["QUIT"]);
      } catch {
      } finally {
        socket.end();
      }
    }
  };
}

function encodeRedisCommand(parts: string[]): string {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part, "utf8")}\r\n${part}\r\n`).join("")}`;
}

function tryParseRedisReply(buffer: string): { consumed: number; type: string; value: string | null } | null {
  const lineEnd = buffer.indexOf("\r\n");
  if (lineEnd === -1) {
    return null;
  }

  const prefix = buffer[0];
  if (!prefix) {
    return null;
  }
  if (prefix === "+" || prefix === "-" || prefix === ":") {
    return {
      consumed: lineEnd + 2,
      type: prefix,
      value: buffer.slice(1, lineEnd)
    };
  }

  if (prefix === "$") {
    const length = Number(buffer.slice(1, lineEnd));
    if (length === -1) {
      return {
        consumed: lineEnd + 2,
        type: prefix,
        value: null
      };
    }

    const totalLength = lineEnd + 2 + length + 2;
    if (buffer.length < totalLength) {
      return null;
    }

    return {
      consumed: totalLength,
      type: prefix,
      value: buffer.slice(lineEnd + 2, lineEnd + 2 + length)
    };
  }

  throw new Error(`Unsupported Redis reply prefix '${prefix}'.`);
}
