import { describe, expect, it } from "vitest";
import { createDijkstraMap, dijkstraUnreachable, type DijkstraMap } from "../src/planning/dijkstra-map";
import { loadBotarena212RoomPlanningFixture } from "./helpers/room-planning-fixture";

describe("dijkstra map", () => {
  it("uses weighted terrain costs and routes around expensive swamp tiles", () => {
    const terrain = createTerrain([
      { x: 26, y: 25, code: 2 },
      { x: 25, y: 26, code: 1 }
    ]);

    const map = createDijkstraMap(terrain, [{ x: 25, y: 25 }]);

    expect(map.get(25, 25)).toBe(0);
    expect(map.get(24, 25)).toBe(2);
    expect(map.get(26, 25)).toBe(10);
    expect(map.get(26, 26)).toBe(2);
    expect(map.get(27, 25)).toBe(4);
    expect(map.get(25, 26)).toBe(dijkstraUnreachable);
  });

  it("supports finite wall costs and CostMatrix overrides", () => {
    const terrain = createTerrain([
      { x: 26, y: 25, code: 1 },
      { x: 24, y: 25, code: 2 }
    ]);
    const costMatrix = new TestCostMatrix();
    costMatrix.set(24, 25, 7);
    costMatrix.set(25, 24, 255);

    const map = createDijkstraMap(terrain, [{ x: 25, y: 25 }], {
      wallCost: 20,
      costMatrix
    });

    expect(map.get(26, 25)).toBe(20);
    expect(map.get(24, 25)).toBe(7);
    expect(map.get(25, 24)).toBe(dijkstraUnreachable);
  });

  it("matches default results across queue strategies and thresholds", () => {
    const terrain = createTerrain([
      { x: 26, y: 25, code: 1 },
      { x: 24, y: 25, code: 2 },
      { x: 24, y: 24, code: 1 },
      { x: 27, y: 25, code: 2 }
    ]);
    const goals = [{ x: 25, y: 25 }, { x: 28, y: 25 }];
    const costMatrix = new TestCostMatrix();
    costMatrix.set(24, 25, 7);
    costMatrix.set(25, 24, 255);
    costMatrix.set(28, 24, 13);

    const baseline = createDijkstraMap(terrain, goals, {
      wallCost: 5000,
      costMatrix
    });

    const variants = [
      createDijkstraMap(terrain, goals, {
        wallCost: 5000,
        costMatrix,
        queueStrategy: "heap"
      }),
      createDijkstraMap(terrain, goals, {
        wallCost: 5000,
        costMatrix,
        queueStrategy: "radix"
      }),
      createDijkstraMap(terrain, goals, {
        wallCost: 5000,
        costMatrix,
        fallbackQueue: "radix"
      }),
      createDijkstraMap(terrain, goals, {
        wallCost: 5000,
        costMatrix,
        bucketThreshold: 8192
      })
    ];

    for (const variant of variants) {
      expect(Array.from(variant.distances)).toEqual(Array.from(baseline.distances));
      expect(Array.from(variant.movementCosts)).toEqual(Array.from(baseline.movementCosts));
    }
  });

  it("matches botarena-212 controller distance snapshots", () => {
    const fixture = loadBotarena212RoomPlanningFixture();
    const renderedByRoom = Object.fromEntries(fixture.candidateRooms.map((roomName) => {
      const room = fixture.map.getRoom(roomName);
      if (room === null) {
        throw new Error(`Fixture room '${roomName}' not found.`);
      }

      const controller = room.objects.find((object) => object.type === "controller");
      if (!controller) {
        throw new Error(`Fixture room '${roomName}' is missing a controller.`);
      }

      const map = createDijkstraMap(room.terrain, [{ x: controller.x, y: controller.y }]);
      return [roomName, renderDijkstraMap(map)] as const;
    }));

    expect(renderedByRoom).toMatchSnapshot();
  });
});

function createTerrain(overrides: Array<{ x: number; y: number; code: 0 | 1 | 2 | 3 }>): string {
  const cells = Array.from({ length: 2500 }, () => "0");

  for (const override of overrides) {
    cells[override.y * 50 + override.x] = String(override.code);
  }

  return cells.join("");
}

class TestCostMatrix implements Pick<PathFinder["CostMatrix"], "get" | "set"> {
  private readonly values = new Uint8Array(2500);

  get(x: number, y: number): number {
    return this.values[y * 50 + x] ?? 0;
  }

  set(x: number, y: number, value: number): undefined {
    this.values[y * 50 + x] = value;
    return undefined;
  }
}

function renderDijkstraMap(map: DijkstraMap): string {
  const maxDistance = findMaxFiniteDistance(map.distances);
  const width = Math.max(2, Math.ceil(Math.log(Math.max(1, maxDistance + 1)) / Math.log(36)));
  const rows: string[] = [];

  for (let y = 0; y < 50; y += 1) {
    let row = "";

    for (let x = 0; x < 50; x += 1) {
      const index = y * 50 + x;
      const cost = map.distances[index];
      if (cost !== dijkstraUnreachable) {
        row += cost.toString(36).padStart(width, "0");
        continue;
      }

      if (map.movementCosts[index] === dijkstraUnreachable) {
        row += "#".repeat(width);
        continue;
      }

      row += ".".repeat(width);
    }

    rows.push(row);
  }

  return rows.join("\n");
}

function findMaxFiniteDistance(distances: Uint32Array): number {
  let maxDistance = 0;

  for (const distance of distances) {
    if (distance !== dijkstraUnreachable && distance > maxDistance) {
      maxDistance = distance;
    }
  }

  return maxDistance;
}
