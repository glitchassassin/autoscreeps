import { describe, expect, it } from "vitest";
import { createDijkstraMap, dijkstraUnreachable } from "../src/planning/dijkstra-map";
import {
  blockRepairableDijkstraMap,
  blockRepairableDijkstraMapReadOnly,
  createRepairableDijkstraMap,
  getRepairedDijkstraDistance
} from "../src/planning/repairable-dijkstra-map";
import { loadBotarena212NormalStampPlanFixture } from "./helpers/stamp-plan-fixture";

describe("repairable dijkstra map", () => {
  it("matches a full rebuild after blocking one tile", () => {
    const terrain = createTerrain([
      { x: 24, y: 25, code: 2 },
      { x: 25, y: 24, code: 1 }
    ]);
    const goals = [{ x: 25, y: 25 }];
    const blockedTiles = [toIndex(26, 25)];

    const repaired = blockRepairableDijkstraMap(createRepairableDijkstraMap(terrain, goals), blockedTiles);
    const expected = createDijkstraMap(terrain, goals, {
      costMatrix: new BlockedCostMatrix(blockedTiles)
    });

    expect(Array.from(repaired.map.distances)).toEqual(Array.from(expected.distances));
    expect(Array.from(repaired.map.movementCosts)).toEqual(Array.from(expected.movementCosts));
    expect(repaired.stats.blockedTiles).toBe(1);
    expect(repaired.stats.invalidatedTiles).toBeGreaterThan(0);
  });

  it("read-only repairs match a full rebuild after blocking one tile", () => {
    const terrain = createTerrain([
      { x: 24, y: 25, code: 2 },
      { x: 25, y: 24, code: 1 }
    ]);
    const goals = [{ x: 25, y: 25 }];
    const blockedTiles = [toIndex(26, 25)];

    const repaired = blockRepairableDijkstraMapReadOnly(createRepairableDijkstraMap(terrain, goals), blockedTiles);
    const expected = createDijkstraMap(terrain, goals, {
      costMatrix: new BlockedCostMatrix(blockedTiles)
    });

    expect(Array.from(repaired.map.distances)).toEqual(Array.from(expected.distances));
    expect(Array.from(repaired.map.movementCosts)).toEqual(Array.from(expected.movementCosts));
    expect(repaired.stats.blockedTiles).toBe(1);
    expect(repaired.stats.invalidatedTiles).toBeGreaterThan(0);
  });

  it("read-only repairs preserve existing CostMatrix blockers", () => {
    const terrain = createTerrain([
      { x: 24, y: 25, code: 2 },
      { x: 23, y: 25, code: 1 }
    ]);
    const goals = [{ x: 25, y: 25 }];
    const baseBlocked = [toIndex(25, 24)];
    const repairedBlocked = [toIndex(24, 25), toIndex(26, 25)];

    const base = createRepairableDijkstraMap(terrain, goals, {
      costMatrix: new BlockedCostMatrix(baseBlocked)
    });
    const repaired = blockRepairableDijkstraMapReadOnly(base, repairedBlocked).map;
    const expected = createDijkstraMap(terrain, goals, {
      costMatrix: new BlockedCostMatrix([...baseBlocked, ...repairedBlocked])
    });

    expect(Array.from(repaired.distances)).toEqual(Array.from(expected.distances));
    expect(Array.from(repaired.movementCosts)).toEqual(Array.from(expected.movementCosts));
    expect(repaired.get(25, 24)).toBe(dijkstraUnreachable);
  });

  it("targeted repairs match full rebuild distances", () => {
    const terrain = createTerrain([
      { x: 24, y: 25, code: 2 },
      { x: 26, y: 24, code: 2 },
      { x: 23, y: 24, code: 1 }
    ]);
    const goals = [{ x: 25, y: 25 }];
    const blockedTiles = [toIndex(26, 25), toIndex(26, 26)];
    const target = toIndex(27, 27);

    const repaired = getRepairedDijkstraDistance(createRepairableDijkstraMap(terrain, goals), blockedTiles, [target]);
    const expected = createDijkstraMap(terrain, goals, {
      costMatrix: new BlockedCostMatrix(blockedTiles)
    });

    expect(repaired.distance).toBe(expected.get(27, 27));
    expect(repaired.stats.blockedTiles).toBe(2);
    expect(repaired.stats.invalidatedTiles).toBeGreaterThan(0);
  });

  it("targeted repairs return unreachable for blocked targets", () => {
    const terrain = createTerrain([]);
    const goals = [{ x: 25, y: 25 }];
    const target = toIndex(26, 25);

    const repaired = getRepairedDijkstraDistance(createRepairableDijkstraMap(terrain, goals), [target], [target]);

    expect(repaired.distance).toBe(dijkstraUnreachable);
  });

  it("matches a full rebuild after sequential repairs", () => {
    const terrain = createTerrain([
      { x: 24, y: 25, code: 2 },
      { x: 26, y: 24, code: 2 },
      { x: 23, y: 24, code: 1 }
    ]);
    const goals = [{ x: 25, y: 25 }];
    const firstBlocked = [toIndex(26, 25), toIndex(26, 26)];
    const secondBlocked = [toIndex(24, 25), toIndex(25, 26)];

    const firstRepair = blockRepairableDijkstraMap(createRepairableDijkstraMap(terrain, goals), firstBlocked).map;
    const secondRepair = blockRepairableDijkstraMap(firstRepair, secondBlocked).map;
    const expected = createDijkstraMap(terrain, goals, {
      costMatrix: new BlockedCostMatrix([...firstBlocked, ...secondBlocked])
    });

    expect(Array.from(secondRepair.distances)).toEqual(Array.from(expected.distances));
    expect(Array.from(secondRepair.movementCosts)).toEqual(Array.from(expected.movementCosts));
  });

  it("preserves existing CostMatrix blockers while applying repaired blockers", () => {
    const terrain = createTerrain([
      { x: 24, y: 25, code: 2 },
      { x: 23, y: 25, code: 1 }
    ]);
    const goals = [{ x: 25, y: 25 }];
    const baseBlocked = [toIndex(25, 24)];
    const repairedBlocked = [toIndex(24, 25), toIndex(26, 25)];

    const base = createRepairableDijkstraMap(terrain, goals, {
      costMatrix: new BlockedCostMatrix(baseBlocked)
    });
    const repaired = blockRepairableDijkstraMap(base, repairedBlocked).map;
    const expected = createDijkstraMap(terrain, goals, {
      costMatrix: new BlockedCostMatrix([...baseBlocked, ...repairedBlocked])
    });

    expect(Array.from(repaired.distances)).toEqual(Array.from(expected.distances));
    expect(Array.from(repaired.movementCosts)).toEqual(Array.from(expected.movementCosts));
    expect(repaired.get(25, 24)).toBe(dijkstraUnreachable);
  });

  it("matches full rebuilds for botarena cached stamp blockers", () => {
    const fixture = loadBotarena212NormalStampPlanFixture();

    for (const testCase of fixture.cases) {
      const hub = testCase.plan.stamps.hub;
      const pod = testCase.plan.stamps.fastfillers[0];
      const goals = getOpenNeighbors(testCase.room.terrain, hub.anchors.storage ?? hub.anchor, hub.blockedTiles);
      if (goals.length === 0) {
        continue;
      }

      const base = createRepairableDijkstraMap(testCase.room.terrain, goals, {
        costMatrix: new BlockedCostMatrix(hub.blockedTiles)
      });
      const repaired = blockRepairableDijkstraMap(base, pod.blockedTiles).map;
      const expectedGoals = getOpenNeighbors(testCase.room.terrain, hub.anchors.storage ?? hub.anchor, [...hub.blockedTiles, ...pod.blockedTiles]);
      if (expectedGoals.length === 0) {
        continue;
      }
      const expected = createDijkstraMap(testCase.room.terrain, expectedGoals, {
        costMatrix: new BlockedCostMatrix([...hub.blockedTiles, ...pod.blockedTiles])
      });

      expect(Array.from(repaired.distances), testCase.roomName).toEqual(Array.from(expected.distances));
      expect(Array.from(repaired.movementCosts), testCase.roomName).toEqual(Array.from(expected.movementCosts));

      const readOnlyRepaired = blockRepairableDijkstraMapReadOnly(base, pod.blockedTiles).map;
      expect(Array.from(readOnlyRepaired.distances), testCase.roomName).toEqual(Array.from(expected.distances));
      expect(Array.from(readOnlyRepaired.movementCosts), testCase.roomName).toEqual(Array.from(expected.movementCosts));

      const target = toIndex(pod.anchor.x, pod.anchor.y);
      const targetedRepair = getRepairedDijkstraDistance(base, pod.blockedTiles, [target]);
      expect(targetedRepair.distance, testCase.roomName).toBe(expected.distances[target]);
    }
  });
});

function createTerrain(overrides: Array<{ x: number; y: number; code: 0 | 1 | 2 | 3 }>): string {
  const cells = Array.from({ length: 2500 }, () => "0");

  for (const override of overrides) {
    cells[toIndex(override.x, override.y)] = String(override.code);
  }

  return cells.join("");
}

class BlockedCostMatrix implements Pick<PathFinder["CostMatrix"], "get"> {
  private readonly blocked = new Uint8Array(2500);

  constructor(blockedTiles: readonly number[]) {
    for (const tile of blockedTiles) {
      if (tile >= 0 && tile < 2500) {
        this.blocked[tile] = 1;
      }
    }
  }

  get(x: number, y: number): number {
    return this.blocked[toIndex(x, y)] === 0 ? 0 : 255;
  }
}

function getOpenNeighbors(terrain: string, target: { x: number; y: number }, blockedTiles: readonly number[]): Array<{ x: number; y: number }> {
  const blocked = new Set(blockedTiles);
  const goals: Array<{ x: number; y: number }> = [];

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const x = target.x + dx;
      const y = target.y + dy;
      if (x < 0 || x >= 50 || y < 0 || y >= 50) {
        continue;
      }
      const tile = toIndex(x, y);
      if (blocked.has(tile) || ((terrain.charCodeAt(tile) - 48) & 1) !== 0) {
        continue;
      }
      goals.push({ x, y });
    }
  }

  return goals;
}

function toIndex(x: number, y: number): number {
  return y * 50 + x;
}
