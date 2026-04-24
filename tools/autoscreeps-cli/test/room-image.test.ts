import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderRoomImagePng, renderRoomImageRaster, writeRoomImageArtifact } from "../src/lib/room-image.ts";
import type { RoomObjectsResponse } from "../src/lib/screeps-api.ts";

describe("room image rendering", () => {
  it("uses the private server terrain palette as the base layer", () => {
    const terrain = makeTerrain([
      { x: 2, y: 2, value: "1" },
      { x: 3, y: 2, value: "2" }
    ]);
    const raster = renderRoomImageRaster({
      terrain,
      roomObjects: emptyRoomObjects(),
      scale: 3
    });

    expect(getPixel(raster, 0, 0)).toEqual([50, 50, 50, 255]);
    expect(getPixel(raster, 4, 4)).toEqual([43, 43, 43, 255]);
    expect(getPixel(raster, 7, 7)).toEqual([0, 0, 0, 255]);
    expect(getPixel(raster, 10, 7)).toEqual([35, 37, 19, 255]);
  });

  it("overlays room objects deterministically without visuals", () => {
    const raster = renderRoomImageRaster({
      terrain: makeTerrain(),
      roomObjects: {
        objects: [
          { _id: "road", type: "road", x: 10, y: 10 },
          { _id: "spawn", type: "spawn", x: 10, y: 10, user: "u1" },
          { _id: "source", type: "source", x: 12, y: 10 },
          { _id: "visual-like", type: "unknown", x: 14, y: 10 }
        ],
        users: {
          u1: { username: "baseline" }
        }
      },
      scale: 12
    });

    expect(getPixel(raster, 10 * 12 + 6, 10 * 12 + 6)).toEqual([109, 216, 87, 255]);
    expect(getPixel(raster, 12 * 12 + 6, 10 * 12 + 6)).toEqual([255, 223, 80, 255]);
    expect(getPixel(raster, 14 * 12 + 6, 10 * 12 + 6)).toEqual([210, 210, 210, 255]);
  });

  it("encodes a valid PNG and writes the expected artifact path", async () => {
    const png = renderRoomImagePng({
      terrain: makeTerrain(),
      roomObjects: emptyRoomObjects(),
      scale: 4
    });
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBe(200);
    expect(png.readUInt32BE(20)).toBe(200);

    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-room-image-"));
    const artifact = await writeRoomImageArtifact({
      runDir,
      role: "baseline",
      gameTime: 123,
      room: "W1N1",
      terrain: makeTerrain(),
      roomObjects: emptyRoomObjects()
    });

    expect(artifact.path).toBe("room-images/baseline/0000000123-W1N1.png");
    expect(artifact.width).toBe(600);
    expect(artifact.height).toBe(600);
    expect((await fs.stat(path.join(runDir, artifact.path))).isFile()).toBe(true);
  });
});

function makeTerrain(overrides: Array<{ x: number; y: number; value: string }> = []): string {
  const terrain = Array.from({ length: 2500 }, () => "0");
  for (const override of overrides) {
    terrain[override.y * 50 + override.x] = override.value;
  }
  return terrain.join("");
}

function emptyRoomObjects(): RoomObjectsResponse {
  return {
    objects: [],
    users: {}
  };
}

function getPixel(
  raster: ReturnType<typeof renderRoomImageRaster>,
  x: number,
  y: number
): [number, number, number, number] {
  const index = (y * raster.width + x) * 4;
  return [
    raster.rgba[index]!,
    raster.rgba[index + 1]!,
    raster.rgba[index + 2]!,
    raster.rgba[index + 3]!
  ];
}
