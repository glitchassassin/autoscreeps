import { describe, expect, it } from "vitest";
import { buildMirroredMap } from "../src/lib/map-generator.ts";

describe("buildMirroredMap", () => {
  it("defaults to the two-source controller room with the most plains", () => {
    const sourceRooms = [
      makeRoom("W0N0", "out of borders", [], plainTerrain(0)),
      makeRoom("E0S0", "normal", [{ type: "controller" }, { type: "source" }, { type: "source" }], plainTerrain(10)),
      makeRoom("E1S0", "normal", [{ type: "controller" }, { type: "source" }, { type: "source" }], plainTerrain(25)),
      makeRoom("E2S0", "normal", [{ type: "controller" }, { type: "source" }], plainTerrain(50)),
      makeRoom("W0S0", "out of borders", [], plainTerrain(0)),
      makeRoom("E0N0", "out of borders", [], plainTerrain(0)),
      makeRoom("E1N0", "out of borders", [], plainTerrain(0)),
      makeRoom("E2N0", "out of borders", [], plainTerrain(0)),
      makeRoom("E3S0", "out of borders", [], plainTerrain(0))
    ];

    const result = buildMirroredMap(sourceRooms);

    expect(result.startRooms.baseline).toBe("W1S0");
    expect(result.startRooms.candidate).toBe("E1S0");
  });

  it("can use the center-most controller strategy when requested", () => {
    const sourceRooms = [
      makeRoom("W0N0", "out of borders", [], plainTerrain(0)),
      makeRoom("E0S0", "normal", [{ type: "controller" }, { type: "source" }, { type: "source" }], plainTerrain(5)),
      makeRoom("E1S0", "normal", [{ type: "controller" }, { type: "source" }, { type: "source" }], plainTerrain(1)),
      makeRoom("E2S0", "normal", [{ type: "controller" }, { type: "source" }, { type: "source" }], plainTerrain(100)),
      makeRoom("W0S0", "out of borders", [], plainTerrain(0)),
      makeRoom("E0N0", "out of borders", [], plainTerrain(0)),
      makeRoom("E1N0", "out of borders", [], plainTerrain(0)),
      makeRoom("E2N0", "out of borders", [], plainTerrain(0)),
      makeRoom("E3S0", "out of borders", [], plainTerrain(0))
    ];

    const result = buildMirroredMap(sourceRooms, { type: "center-most-controller" });

    expect(result.startRooms.baseline).toBe("W1S0");
    expect(result.startRooms.candidate).toBe("E1S0");
  });

  it("duplicates all rooms into a second section and picks matching start rooms", () => {
    const sourceRooms = [
      makeRoom("W0N0", "out of borders", [], plainTerrain(0)),
      makeRoom("E0S0", "normal", [{ type: "controller" }, { type: "source" }, { type: "source" }], plainTerrain(20)),
      makeRoom("E1S0", "normal", [{ type: "source" }], plainTerrain(0)),
      makeRoom("W0S0", "out of borders", [], plainTerrain(0)),
      makeRoom("E0N0", "out of borders", [], plainTerrain(0)),
      makeRoom("E1N0", "out of borders", [], plainTerrain(0)),
      makeRoom("E2S0", "out of borders", [], plainTerrain(0)),
      makeRoom("E2N0", "out of borders", [], plainTerrain(0)),
      makeRoom("W0S1", "out of borders", [], plainTerrain(0)),
      makeRoom("E0S1", "normal", [{ type: "controller" }, { type: "source" }, { type: "source" }], plainTerrain(5)),
      makeRoom("E1S1", "normal", [{ type: "source" }], plainTerrain(0)),
      makeRoom("E2S1", "out of borders", [], plainTerrain(0))
    ];

    const result = buildMirroredMap(sourceRooms);

    expect(result.rooms).toHaveLength(18);
    expect(result.startRooms.baseline).toBe("W1S0");
    expect(result.startRooms.candidate).toBe("E0S0");
    expect(result.rooms.some((room) => room.room === "W1S0")).toBe(true);
    expect(result.rooms.some((room) => room.room === "W0S1")).toBe(true);
    expect(result.rooms.some((room) => room.room === "E1S1")).toBe(true);

    const leftJoinRoom = result.rooms.find((room) => room.room === "W0S0");
    const rightJoinRoom = result.rooms.find((room) => room.room === "E0S0");

    expect(Number(leftJoinRoom?.terrain[49] ?? "0") & 1).toBe(1);
    expect(Number(rightJoinRoom?.terrain[0] ?? "0") & 1).toBe(1);
  });
});

function makeRoom(room: string, status: string, objects: Array<{ type: string }>, terrain: string) {
  return {
    room,
    status,
    terrain,
    objects: objects.map((object) => ({ ...object, room }))
  };
}

function plainTerrain(plainTiles: number): string {
  return `${"0".repeat(plainTiles)}${"2".repeat(2500 - plainTiles)}`;
}
