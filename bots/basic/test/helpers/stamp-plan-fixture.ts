import { readFileSync } from "node:fs";
import type { RoomPlanningRoomData } from "../../src/planning/room-plan.ts";
import type { RoomStampPlan } from "../../src/planning/stamp-placement.ts";
import { loadBotarena212RoomPlanningFixture } from "./room-planning-fixture.ts";

export type CachedStampPlanCase = {
  roomName: string;
  room: RoomPlanningRoomData;
  plan: RoomStampPlan;
};

export type CachedStampPlanFixture = {
  mapFixture: string;
  policy: RoomStampPlan["policy"];
  cases: CachedStampPlanCase[];
  skippedRooms: string[];
  terrainByRoom: Map<string, string>;
};

export const botarena212RoadUnplannableNormalRooms = [] as const;

type RawStampPlanFixture = {
  schemaVersion: number;
  mapFixture: string;
  policy: RoomStampPlan["policy"];
  rooms: Array<{
    roomName: string;
    plan: RoomStampPlan;
  }>;
  skippedRooms?: string[];
};

let cachedFixture: CachedStampPlanFixture | null = null;

export function loadBotarena212NormalStampPlanFixture(): CachedStampPlanFixture {
  if (cachedFixture !== null) {
    return cachedFixture;
  }

  const raw = parseFixture(readFileSync(
    new URL("../fixtures/room-planning/botarena-212-normal-stamp-plans.json", import.meta.url),
    "utf8"
  ));
  const roomFixture = loadBotarena212RoomPlanningFixture();
  const terrainByRoom = new Map<string, string>();
  const cases = raw.rooms.map((entry) => {
    const room = roomFixture.map.getRoom(entry.roomName);
    if (room === null) {
      throw new Error(`Cached stamp plan references unknown room '${entry.roomName}'.`);
    }
    terrainByRoom.set(entry.roomName, room.terrain);
    return {
      roomName: entry.roomName,
      room,
      plan: entry.plan
    };
  });

  cachedFixture = {
    mapFixture: raw.mapFixture,
    policy: raw.policy,
    cases,
    skippedRooms: raw.skippedRooms ?? [],
    terrainByRoom
  };
  return cachedFixture;
}

export function loadBotarena212RoadPlanningFixture(): CachedStampPlanFixture {
  const fixture = loadBotarena212NormalStampPlanFixture();
  const unplannable = new Set<string>(botarena212RoadUnplannableNormalRooms);

  return {
    ...fixture,
    cases: fixture.cases.filter((testCase) => !unplannable.has(testCase.roomName))
  };
}

function parseFixture(input: string): RawStampPlanFixture {
  const parsed = JSON.parse(input) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Cached stamp plan fixture must be an object.");
  }

  const fixture = parsed as Partial<RawStampPlanFixture>;
  if (fixture.schemaVersion !== 1) {
    throw new Error(`Unsupported stamp plan fixture schema version '${String(fixture.schemaVersion)}'.`);
  }
  if (fixture.policy !== "normal") {
    throw new Error(`Expected normal stamp plan fixture, received '${String(fixture.policy)}'.`);
  }
  if (!Array.isArray(fixture.rooms)) {
    throw new Error("Cached stamp plan fixture must contain a rooms array.");
  }

  return fixture as RawStampPlanFixture;
}
