import { describe, expect, it, vi } from "vitest";
import { evaluateTerminalConditions, waitForSimulation, waitForTargetGameTime } from "../src/lib/runner.ts";

describe("waitForTargetGameTime", () => {
  it("returns once the target tick is reached", async () => {
    const cli = {
      getGameTime: vi.fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3)
    };

    await expect(waitForTargetGameTime({
      cli,
      targetGameTime: 3,
      pollIntervalMs: 1,
      maxWallClockMs: 100,
      maxStalledPolls: 3
    })).resolves.toBeUndefined();
  });

  it("fails if game time stalls for too many polls", async () => {
    const cli = {
      getGameTime: vi.fn().mockResolvedValue(5)
    };

    await expect(waitForTargetGameTime({
      cli,
      targetGameTime: 10,
      pollIntervalMs: 1,
      maxWallClockMs: 100,
      maxStalledPolls: 3
    })).rejects.toThrow("Game time stalled at 5");
  });

  it("reports progress while waiting", async () => {
    const cli = {
      getGameTime: vi.fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
    };
    const onProgress = vi.fn();

    await expect(waitForTargetGameTime({
      cli,
      targetGameTime: 2,
      pollIntervalMs: 1,
      maxWallClockMs: 100,
      maxStalledPolls: 3,
      onProgress
    })).resolves.toBeUndefined();

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith({ gameTime: 1 });
  });
});

describe("waitForSimulation", () => {
  it("can stop early once all bots are terminal", async () => {
    const cli = {
      getGameTime: vi.fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3)
    };
    const terminalByTick = new Set<number>();

    const result = await waitForSimulation({
      cli,
      targetGameTime: 10,
      pollIntervalMs: 1,
      maxWallClockMs: 100,
      maxStalledPolls: 3,
      onSample: ({ gameTime }) => {
        if (gameTime === 3) {
          terminalByTick.add(gameTime);
        }
      },
      isComplete: ({ gameTime }) => terminalByTick.has(gameTime)
    });

    expect(result).toEqual({ gameTime: 3, reason: "all-bots-terminal" });
    expect(cli.getGameTime).toHaveBeenCalledTimes(3);
  });

  it("supports explicit failure completion reasons", async () => {
    const cli = {
      getGameTime: vi.fn()
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(11)
    };

    const result = await waitForSimulation({
      cli,
      targetGameTime: 100,
      pollIntervalMs: 1,
      maxWallClockMs: 100,
      maxStalledPolls: 3,
      isComplete: ({ gameTime }) => gameTime >= 11 ? "participant-failed" : null
    });

    expect(result).toEqual({ gameTime: 11, reason: "participant-failed" });
  });
});

describe("evaluateTerminalConditions", () => {
  it("treats a matching controller level as a pass", () => {
    expect(evaluateTerminalConditions({
      win: [{ type: "any-owned-controller-level-at-least", level: 2 }],
      fail: [{ type: "no-owned-controllers" }]
    }, {
      ownedControllers: 1,
      combinedRCL: 2,
      maxOwnedControllerLevel: 2,
      rcl: { "1": 0, "2": 1 },
      ownedStructureCounts: {}
    })).toEqual({
      status: "passed",
      reason: "win",
      condition: { type: "any-owned-controller-level-at-least", level: 2 }
    });
  });

  it("gives fail conditions precedence when both sides match", () => {
    expect(evaluateTerminalConditions({
      win: [{ type: "any-owned-controller-level-at-least", level: 1 }],
      fail: [{ type: "no-owned-controllers" }]
    }, {
      ownedControllers: 0,
      combinedRCL: 0,
      maxOwnedControllerLevel: 1,
      rcl: { "1": 0 },
      ownedStructureCounts: {}
    })).toEqual({
      status: "failed",
      reason: "fail",
      condition: { type: "no-owned-controllers" }
    });
  });

  it("supports structure-count terminal conditions", () => {
    expect(evaluateTerminalConditions({
      win: [{ type: "owned-structure-count-at-least", structureType: "storage", count: 1 }],
      fail: []
    }, {
      ownedControllers: 1,
      combinedRCL: 4,
      maxOwnedControllerLevel: 4,
      rcl: { "1": 0, "2": 0, "3": 0, "4": 1 },
      ownedStructureCounts: { storage: 1 }
    })).toEqual({
      status: "passed",
      reason: "win",
      condition: { type: "owned-structure-count-at-least", structureType: "storage", count: 1 }
    });
  });
});
