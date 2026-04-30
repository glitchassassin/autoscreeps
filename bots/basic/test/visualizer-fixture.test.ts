import { describe, expect, it } from "vitest";
import {
  defaultBrowserPlanningFixtureId,
  getBrowserPlanningFixtureOptions,
  loadBrowserPlanningFixture
} from "../visualizer/src/fixture.ts";

describe("visualizer fixtures", () => {
  it("lists bundled room planning fixtures", () => {
    const options = getBrowserPlanningFixtureOptions();

    expect(options.map((option) => option.id)).toEqual([
      "botarena-212",
      "mmo-shard1-planner-sample"
    ]);
    expect(defaultBrowserPlanningFixtureId).toBe("botarena-212");
  });

  it("loads the default botarena fixture", async () => {
    const fixture = await loadBrowserPlanningFixture();

    expect(fixture.id).toBe("botarena-212");
    expect(fixture.candidateRooms).toHaveLength(144);
    expect(fixture.map.getRoom(fixture.candidateRooms[0]!)).not.toBeNull();
  });

  it("loads the bundled shard1 planner sample", async () => {
    const fixture = await loadBrowserPlanningFixture("mmo-shard1-planner-sample");

    expect(fixture.id).toBe("mmo-shard1-planner-sample");
    expect(fixture.candidateRooms).toHaveLength(129);
    expect(fixture.candidateRooms).toContain("E55S18");
    expect(fixture.map.getRoom(fixture.candidateRooms[0]!)).not.toBeNull();
  });

  it("rejects unknown fixture ids", async () => {
    await expect(loadBrowserPlanningFixture("missing-fixture")).rejects.toThrow("Unknown room planning fixture");
  });
});
