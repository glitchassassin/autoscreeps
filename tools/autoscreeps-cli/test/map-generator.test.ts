import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMirroredMap, generateExperimentMap } from "../src/lib/map-generator.ts";

const tempPaths: string[] = [];

describe("generateExperimentMap", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempPaths.map((tempPath) => fs.rm(tempPath, { recursive: true, force: true })));
    tempPaths.length = 0;
  });

  it("uses the configured sourceMapId instead of picking randomly", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-map-generator-"));
    tempPaths.push(tempDir);

    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => {
        if (url.endsWith("map-fixed-map.json")) {
          return { rooms: mirroredSourceRooms() };
        }

        throw new Error(`Unexpected url ${url}`);
      }
    }));

    vi.stubGlobal("fetch", fetchMock);
    const randomSpy = vi.spyOn(Math, "random");

    const result = await generateExperimentMap({ type: "mirrored-random-1x1", sourceMapId: "fixed-map" }, tempDir);

    expect(randomSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://maps.screepspl.us/maps/map-fixed-map.json");
    expect(result.label).toBe("generated:mirrored-random-1x1:fixed-map");
    expect(result.rooms).toEqual({ baseline: "W1S0", candidate: "E0S0" });

    const generatedMapPath = path.join(tempDir, "generated-map.json");
    await expect(fs.readFile(generatedMapPath, "utf8")).resolves.toContain('"rooms"');
  });

  it("preserves random source map selection when sourceMapId is absent", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-map-generator-"));
    tempPaths.push(tempDir);

    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => {
        if (url.endsWith("index.json")) {
          return [
            { id: "alpha", width: 1, height: 1 },
            { id: "beta", width: 1, height: 1 }
          ];
        }

        if (url.endsWith("map-beta.json")) {
          return { rooms: mirroredSourceRooms() };
        }

        throw new Error(`Unexpected url ${url}`);
      }
    }));

    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Math, "random").mockReturnValue(0.99);

    const result = await generateExperimentMap({ type: "mirrored-random-1x1" }, tempDir);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://maps.screepspl.us/maps/index.json");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://maps.screepspl.us/maps/map-beta.json");
    expect(result.label).toBe("generated:mirrored-random-1x1:beta");
  });
});

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

function mirroredSourceRooms() {
  return [
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
}

function plainTerrain(plainTiles: number): string {
  return `${"0".repeat(plainTiles)}${"2".repeat(2500 - plainTiles)}`;
}
