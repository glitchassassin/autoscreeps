import { describe, expect, it } from "vitest";
import { planRoom } from "../src/planning/room-plan";
import { loadBotarena212RoomPlanningFixture } from "./helpers/room-planning-fixture";

describe("room planning", () => {
  it("identifies the viable botarena-212 planning rooms", () => {
    const fixture = loadBotarena212RoomPlanningFixture();

    expect(fixture.candidateRooms).toHaveLength(144);
  });

  it("plans every viable botarena-212 room", () => {
    const fixture = loadBotarena212RoomPlanningFixture();

    for (const roomName of fixture.candidateRooms) {
      try {
        planRoom({
          roomName,
          policy: "normal",
          map: fixture.map
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Room '${roomName}' failed planning: ${message}`);
      }
    }
  });
});
