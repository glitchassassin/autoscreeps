import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planRoomStamps, validateStampPlan, type RoomStampPlan } from "../src/planning/stamp-placement.ts";
import { loadBotarena212RoomPlanningFixture } from "../test/helpers/room-planning-fixture.ts";

type StampPlanFixtureFile = {
  schemaVersion: 1;
  generatedBy: string;
  mapFixture: string;
  policy: "normal";
  rooms: Array<{
    roomName: string;
    plan: RoomStampPlan;
  }>;
  skippedRooms: string[];
};

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const fixture = loadBotarena212RoomPlanningFixture();
  const rooms: StampPlanFixtureFile["rooms"] = [];
  const skippedRooms: string[] = [];

  for (const roomName of fixture.candidateRooms) {
    const room = fixture.map.getRoom(roomName);
    if (room === null) {
      throw new Error(`Fixture room '${roomName}' not found.`);
    }

    try {
      const plan = planRoomStamps(room, "normal");
      const validationErrors = validateStampPlan(room, plan);
      if (validationErrors.length > 0) {
        throw new Error(validationErrors.join("; "));
      }

      rooms.push({ roomName, plan });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("No viable normal stamp layout found")) {
        throw new Error(`Room '${roomName}' failed stamp fixture generation: ${message}`);
      }
      skippedRooms.push(roomName);
    }
  }

  const output: StampPlanFixtureFile = {
    schemaVersion: 1,
    generatedBy: "scripts/generate-road-planning-fixtures.ts",
    mapFixture: "test/fixtures/maps/map-botarena-212.json",
    policy: "normal",
    rooms,
    skippedRooms
  };
  const outputDirectory = path.join(scriptDirectory, "..", "test", "fixtures", "room-planning");
  const outputPath = path.join(outputDirectory, "botarena-212-normal-stamp-plans.json");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  process.stdout.write(`Wrote ${rooms.length} normal stamp plans to ${outputPath}\n`);
  if (skippedRooms.length > 0) {
    process.stdout.write(`Skipped ${skippedRooms.length} unplannable rooms: ${skippedRooms.join(", ")}\n`);
  }
}
