import { describe, expect, it } from "vitest";
import { createFloodFill } from "../src/planning/flood-fill";

describe("flood fill", () => {
  it("fills all connected tiles reachable from the seeds", () => {
    const mask = createMask([
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 12, y: 10 },
      { x: 11, y: 11 }
    ]);

    const fill = createFloodFill(mask, [{ x: 10, y: 10 }]);

    expect(fill.visitedCount).toBe(4);
    expect(fill.contains(10, 10)).toBe(true);
    expect(fill.contains(11, 10)).toBe(true);
    expect(fill.contains(12, 10)).toBe(true);
    expect(fill.contains(11, 11)).toBe(true);
    expect(fill.contains(9, 10)).toBe(false);
  });

  it("does not cross gaps in the mask", () => {
    const mask = createMask([
      { x: 20, y: 20 },
      { x: 21, y: 20 },
      { x: 23, y: 20 },
      { x: 24, y: 20 }
    ]);

    const fill = createFloodFill(mask, [{ x: 20, y: 20 }]);

    expect(fill.visitedCount).toBe(2);
    expect(fill.contains(20, 20)).toBe(true);
    expect(fill.contains(21, 20)).toBe(true);
    expect(fill.contains(23, 20)).toBe(false);
    expect(fill.contains(24, 20)).toBe(false);
  });

  it("treats diagonal contact as connected", () => {
    const mask = createMask([
      { x: 30, y: 30 },
      { x: 31, y: 31 },
      { x: 32, y: 32 }
    ]);

    const fill = createFloodFill(mask, [{ x: 30, y: 30 }]);

    expect(fill.visitedCount).toBe(3);
    expect(fill.contains(32, 32)).toBe(true);
  });

  it("ignores blocked and duplicate seeds", () => {
    const mask = createMask([
      { x: 5, y: 5 },
      { x: 6, y: 5 }
    ]);

    const fill = createFloodFill(mask, [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 10, y: 10 }
    ]);

    expect(fill.visitedCount).toBe(2);
    expect(fill.contains(5, 5)).toBe(true);
    expect(fill.contains(6, 5)).toBe(true);
    expect(fill.contains(10, 10)).toBe(false);
  });

  it("rejects empty seed lists and invalid mask lengths", () => {
    expect(() => createFloodFill(new Uint8Array(2500), [])).toThrow("Flood fill requires at least one seed tile.");
    expect(() => createFloodFill(new Uint8Array(10), [{ x: 0, y: 0 }])).toThrow("Expected flood-fill mask length 2500, received 10.");
  });
});

function createMask(tiles: Array<{ x: number; y: number }>): Uint8Array {
  const mask = new Uint8Array(2500);

  for (const tile of tiles) {
    mask[tile.y * 50 + tile.x] = 1;
  }

  return mask;
}
