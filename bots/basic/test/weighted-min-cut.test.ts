import { describe, expect, it } from "vitest";
import { solveWeightedMinCut } from "../src/planning/weighted-min-cut";

describe("weighted min-cut", () => {
  it("returns the minimum separating edge set", () => {
    const result = solveWeightedMinCut({
      nodeCount: 4,
      source: 0,
      sink: 3,
      edges: [
        { from: 0, to: 1, capacity: 5 },
        { from: 1, to: 3, capacity: 2 },
        { from: 0, to: 2, capacity: 3 },
        { from: 2, to: 3, capacity: 4 }
      ]
    });

    expect(result.maxFlow).toBe(5);
    expect(result.cutCapacity).toBe(5);
    expect(result.cutEdgeIndexes).toEqual([1, 2]);
    expect(result.sourceSide[0]).toBe(1);
    expect(result.sourceSide[3]).toBe(0);
  });

  it("supports zero-capacity optional edges", () => {
    const result = solveWeightedMinCut({
      nodeCount: 3,
      source: 0,
      sink: 2,
      edges: [
        { from: 0, to: 1, capacity: 10 },
        { from: 1, to: 2, capacity: 0 }
      ]
    });

    expect(result.maxFlow).toBe(0);
    expect(result.cutCapacity).toBe(0);
    expect(result.cutEdgeIndexes).toEqual([]);
  });
});
