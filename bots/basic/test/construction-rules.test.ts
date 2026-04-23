import { describe, expect, it } from "vitest";
import { isConstructionSiteTerrainAllowed, isRoadPlanningTerrain } from "../src/planning/construction-rules";

const roomSize = 50;

describe("construction rules", () => {
  it("rejects all construction sites on the room edge", () => {
    const terrain = createTerrain();

    expect(isConstructionSiteTerrainAllowed(terrain, "road", 0, 10)).toBe(false);
    expect(isConstructionSiteTerrainAllowed(terrain, "container", 49, 10)).toBe(false);
    expect(isConstructionSiteTerrainAllowed(terrain, "extension", 10, 0)).toBe(false);
    expect(isConstructionSiteTerrainAllowed(terrain, "rampart", 10, 49)).toBe(false);
  });

  it("allows roads and containers one tile from open exits", () => {
    const terrain = createTerrain();

    expect(isConstructionSiteTerrainAllowed(terrain, "road", 1, 10)).toBe(true);
    expect(isConstructionSiteTerrainAllowed(terrain, "container", 1, 10)).toBe(true);
  });

  it("requires non-road non-container structures near edges to face walled border tiles", () => {
    const openExitTerrain = createTerrain();
    const walledBorderTerrain = createTerrain([
      { x: 0, y: 8 },
      { x: 0, y: 9 },
      { x: 0, y: 10 },
      { x: 0, y: 11 },
      { x: 0, y: 12 }
    ]);

    expect(isConstructionSiteTerrainAllowed(openExitTerrain, "extension", 1, 10)).toBe(false);
    expect(isConstructionSiteTerrainAllowed(openExitTerrain, "rampart", 1, 10)).toBe(false);
    expect(isConstructionSiteTerrainAllowed(walledBorderTerrain, "extension", 1, 10)).toBe(true);
    expect(isConstructionSiteTerrainAllowed(walledBorderTerrain, "rampart", 1, 10)).toBe(true);
  });

  it("reserves range two from open exits for base structures while allowing cut structures", () => {
    const terrain = createTerrain();

    expect(isConstructionSiteTerrainAllowed(terrain, "extension", 10, 2)).toBe(false);
    expect(isConstructionSiteTerrainAllowed(terrain, "rampart", 10, 2)).toBe(true);
    expect(isConstructionSiteTerrainAllowed(terrain, "road", 10, 2)).toBe(true);
    expect(isConstructionSiteTerrainAllowed(terrain, "container", 10, 2)).toBe(true);
  });

  it("allows range two near walled room edges", () => {
    const terrain = createTerrain([
      { x: 8, y: 0 },
      { x: 9, y: 0 },
      { x: 10, y: 0 },
      { x: 11, y: 0 },
      { x: 12, y: 0 }
    ]);

    expect(isConstructionSiteTerrainAllowed(terrain, "extension", 10, 2)).toBe(true);
    expect(isConstructionSiteTerrainAllowed(terrain, "rampart", 10, 2)).toBe(true);
  });

  it("keeps road planning passable even though Screeps can construct roads on walls", () => {
    const terrain = createTerrain([{ x: 10, y: 10 }]);

    expect(isConstructionSiteTerrainAllowed(terrain, "road", 10, 10)).toBe(true);
    expect(isRoadPlanningTerrain(terrain, 10, 10)).toBe(false);
  });
});

function createTerrain(walls: Array<{ x: number; y: number }> = []): string {
  const tiles = Array<string>(roomSize * roomSize).fill("0");
  for (const wall of walls) {
    tiles[wall.y * roomSize + wall.x] = "1";
  }
  return tiles.join("");
}
