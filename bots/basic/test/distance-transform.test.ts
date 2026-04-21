import { describe, expect, it } from "vitest";
import { createTerrainDistanceTransform, type TerrainDistanceTransform } from "../src/planning/distance-transform";
import { loadBotarena212RoomPlanningFixture } from "./helpers/room-planning-fixture";

const roomSize = 50;
const roomArea = roomSize * roomSize;
const terrainMaskWall = 1;

describe("terrain distance transform", () => {
  it("computes Chebyshev clearance from room bounds", () => {
    const transform = createTerrainDistanceTransform(createTerrain([]));

    expect(transform.get(0, 0)).toBe(1);
    expect(transform.get(1, 1)).toBe(2);
    expect(transform.get(24, 24)).toBe(25);
    expect(transform.get(25, 25)).toBe(25);
    expect(transform.maxDistance).toBe(25);
  });

  it("computes Chebyshev clearance from terrain walls", () => {
    const transform = createTerrainDistanceTransform(createTerrain([
      { x: 25, y: 25, code: 1 }
    ]));

    expect(transform.get(25, 25)).toBe(0);
    expect(transform.isBlocked(25, 25)).toBe(true);
    expect(transform.get(24, 25)).toBe(1);
    expect(transform.get(24, 24)).toBe(1);
    expect(transform.get(23, 25)).toBe(2);
    expect(transform.get(23, 23)).toBe(2);
  });

  it("treats swamp as walkable and any wall-bit terrain as blocked", () => {
    const transform = createTerrainDistanceTransform(createTerrain([
      { x: 20, y: 20, code: 2 },
      { x: 21, y: 20, code: 3 }
    ]));

    expect(transform.get(20, 20)).toBeGreaterThan(0);
    expect(transform.isBlocked(20, 20)).toBe(false);
    expect(transform.get(21, 20)).toBe(0);
    expect(transform.isBlocked(21, 20)).toBe(true);
  });

  it("rejects invalid terrain lengths and coordinates", () => {
    const transform = createTerrainDistanceTransform(createTerrain([]));

    expect(() => createTerrainDistanceTransform("0".repeat(10))).toThrow("Expected terrain string length 2500, received 10.");
    expect(() => transform.get(-1, 0)).toThrow("Invalid room coordinate (-1, 0).");
    expect(() => transform.isBlocked(0, 50)).toThrow("Invalid room coordinate (0, 50).");
  });

  it("runs across every viable botarena-212 planning room", () => {
    const fixture = loadBotarena212RoomPlanningFixture();
    let totalClearance = 0;
    let roomMaxSum = 0;

    for (const roomName of fixture.candidateRooms) {
      const room = fixture.map.getRoom(roomName);
      if (room === null) {
        throw new Error(`Fixture room '${roomName}' not found.`);
      }

      const transform = createTerrainDistanceTransform(room.terrain);
      const summary = validateTransform(room.terrain, transform);
      totalClearance += summary.totalClearance;
      roomMaxSum += transform.maxDistance;
    }

    expect(fixture.candidateRooms).toHaveLength(144);
    expect(totalClearance).toBeGreaterThan(0);
    expect(roomMaxSum).toBeGreaterThan(0);
  });
});

function createTerrain(overrides: Array<{ x: number; y: number; code: 0 | 1 | 2 | 3 }>): string {
  const cells = Array.from({ length: roomArea }, () => "0");

  for (const override of overrides) {
    cells[toIndex(override.x, override.y)] = String(override.code);
  }

  return cells.join("");
}

function validateTransform(terrain: string, transform: TerrainDistanceTransform): {
  totalClearance: number;
} {
  expect(transform.distances).toHaveLength(roomArea);

  let totalClearance = 0;
  let maxDistance = 0;

  for (let y = 0; y < roomSize; y += 1) {
    for (let x = 0; x < roomSize; x += 1) {
      const index = toIndex(x, y);
      const terrainCode = terrain.charCodeAt(index) - 48;
      const distance = transform.distances[index]!;

      if ((terrainCode & terrainMaskWall) !== 0) {
        expect(distance, `wall tile ${x},${y}`).toBe(0);
        continue;
      }

      expect(distance, `walkable tile ${x},${y}`).toBeGreaterThan(0);
      expect(distance, `distance recurrence at ${x},${y}`).toBe(findNeighborMinimum(transform.distances, x, y) + 1);
      totalClearance += distance;
      maxDistance = Math.max(maxDistance, distance);
    }
  }

  expect(transform.maxDistance).toBe(maxDistance);
  return { totalClearance };
}

function findNeighborMinimum(distances: Uint8Array, x: number, y: number): number {
  let minimum = x === 0 || y === 0 || x === roomSize - 1 || y === roomSize - 1 ? 0 : 0xff;

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }

      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextX >= roomSize || nextY < 0 || nextY >= roomSize) {
        minimum = 0;
        continue;
      }

      minimum = Math.min(minimum, distances[toIndex(nextX, nextY)]!);
    }
  }

  return minimum;
}

function toIndex(x: number, y: number): number {
  return y * roomSize + x;
}
