import { describe, expect, it, vi } from "vitest";
import { waitForTargetGameTime } from "../src/lib/runner.ts";

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
});
