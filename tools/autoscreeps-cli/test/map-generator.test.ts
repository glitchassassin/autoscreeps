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

  it("skips start rooms with a source within range 2 of an edge", () => {
    const sourceRooms = [
      makeRoom("W0N0", "out of borders", [], plainTerrain(0)),
      makeRoom("E0S0", "normal", [
        { type: "controller", x: 25, y: 25 },
        { type: "source", x: 2, y: 43 },
        { type: "source", x: 29, y: 13 }
      ], plainTerrain(100)),
      makeRoom("E1S0", "normal", [
        { type: "controller", x: 25, y: 25 },
        { type: "source", x: 3, y: 43 },
        { type: "source", x: 29, y: 13 }
      ], plainTerrain(25)),
      makeRoom("W0S0", "out of borders", [], plainTerrain(0)),
      makeRoom("E0N0", "out of borders", [], plainTerrain(0)),
      makeRoom("E1N0", "out of borders", [], plainTerrain(0)),
      makeRoom("E2S0", "out of borders", [], plainTerrain(0)),
      makeRoom("E2N0", "out of borders", [], plainTerrain(0))
    ];

    const result = buildMirroredMap(sourceRooms);

    expect(result.startRooms.baseline).toBe("W0S0");
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

  it("can add wraparound highway portals to each mirrored arena", () => {
    const sourceRooms = [
      makeRoom("W0S0", "out of borders", [], plainTerrain(0)),
      makeRoom("E11S0", "out of borders", [], plainTerrain(0)),
      makeRoom("E0S0", "normal", [], plainTerrain(0)),
      makeRoom("E1S0", "normal", [], plainTerrain(0)),
      makeRoom("E10S0", "normal", [], plainTerrain(0)),
      makeRoom("E0S1", "normal", [], plainTerrain(0)),
      makeRoom("E1S1", "normal", [{ type: "controller" }, { type: "source" }, { type: "source" }], plainTerrain(100)),
      makeRoom("E10S1", "normal", [], plainTerrain(0)),
      makeRoom("E0S10", "normal", [], plainTerrain(0)),
      makeRoom("E1S10", "normal", [], plainTerrain(0)),
      makeRoom("E10S10", "normal", [], plainTerrain(0))
    ];

    const result = buildMirroredMap(
      sourceRooms,
      { type: "max-plains-two-sources" },
      { type: "wraparound", forcePlainEndpoints: true, excludeCorners: true }
    );

    const candidateTop = result.rooms.find((room) => room.room === "E1S0");
    const candidateBottom = result.rooms.find((room) => room.room === "E1S10");
    const candidateLeft = result.rooms.find((room) => room.room === "E0S1");
    const candidateRight = result.rooms.find((room) => room.room === "E10S1");
    const baselineTop = result.rooms.find((room) => room.room === "W9S0");
    const baselineBottom = result.rooms.find((room) => room.room === "W9S10");
    const baselineLeft = result.rooms.find((room) => room.room === "W10S1");
    const baselineRight = result.rooms.find((room) => room.room === "W0S1");

    expect(findPortal(candidateTop, 12, 0)?.destination).toEqual({ x: 12, y: 49, room: "E1S10" });
    expect(findPortal(candidateBottom, 12, 49)?.destination).toEqual({ x: 12, y: 0, room: "E1S0" });
    expect(findPortal(candidateLeft, 0, 12)?.destination).toEqual({ x: 49, y: 12, room: "E10S1" });
    expect(findPortal(candidateRight, 49, 12)?.destination).toEqual({ x: 0, y: 12, room: "E0S1" });
    expect(findPortal(baselineLeft, 0, 12)?.destination).toEqual({ x: 49, y: 12, room: "W0S1" });
    expect(findPortal(baselineRight, 49, 12)?.destination).toEqual({ x: 0, y: 12, room: "W10S1" });
    expect(findPortal(candidateTop, 0, 0)).toBeUndefined();
    expect(findPortal(candidateTop, 49, 0)).toBeUndefined();
    expect(findPortal(baselineTop, 12, 0)?.destination).toEqual({ x: 12, y: 49, room: "W9S10" });
    expect(findPortal(baselineBottom, 12, 49)?.destination).toEqual({ x: 12, y: 0, room: "W9S0" });
    expect(candidateTop?.terrain[12]).toBe("0");
    expect(candidateBottom?.terrain[49 * 50 + 12]).toBe("0");
    expect(Number(candidateLeft?.terrain[12 * 50] ?? "0") & 1).toBe(1);
    expect(Number(baselineRight?.terrain[12 * 50 + 49] ?? "0") & 1).toBe(1);
    expect(candidateRight?.terrain[12 * 50 + 49]).toBe("0");
    expect(baselineLeft?.terrain[12 * 50]).toBe("0");
  });

  it("uses highway rows instead of ordinary playable edges", () => {
    const sourceRooms = [
      makeRoom("E0S8", "normal", [], plainTerrain(0)),
      makeRoom("E12S22", "normal", [], plainTerrain(0)),
      makeRoom("E1S9", "normal", [{ type: "controller" }, { type: "source" }, { type: "source" }], plainTerrain(100)),
      makeRoom("E10S8", "normal", [], plainTerrain(0)),
      makeRoom("E10S10", "normal", [], plainTerrain(0)),
      makeRoom("E10S20", "normal", [], plainTerrain(0)),
      makeRoom("E10S22", "normal", [], plainTerrain(0))
    ];

    const result = buildMirroredMap(
      sourceRooms,
      { type: "max-plains-two-sources" },
      { type: "wraparound", forcePlainEndpoints: true, excludeCorners: true }
    );

    const ordinaryTop = result.rooms.find((room) => room.room === "E10S8");
    const topHighway = result.rooms.find((room) => room.room === "E10S10");
    const bottomHighway = result.rooms.find((room) => room.room === "E10S20");
    const ordinaryBottom = result.rooms.find((room) => room.room === "E10S22");

    expect(findPortal(ordinaryTop, 12, 0)).toBeUndefined();
    expect(findPortal(topHighway, 12, 0)?.destination).toEqual({ x: 12, y: 49, room: "E10S20" });
    expect(findPortal(bottomHighway, 12, 49)?.destination).toEqual({ x: 12, y: 0, room: "E10S10" });
    expect(findPortal(ordinaryBottom, 12, 49)).toBeUndefined();
  });
});

function makeRoom(room: string, status: string, objects: Array<{ type: string; x?: number; y?: number; destination?: unknown }>, terrain: string) {
  return {
    room,
    status,
    terrain,
    objects: objects.map((object) => ({ ...object, room }))
  };
}

function findPortal(room: ReturnType<typeof makeRoom> | undefined, x: number, y: number) {
  return room?.objects.find((object) => object.type === "portal" && object.x === x && object.y === y);
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
