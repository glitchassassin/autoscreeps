import { describe, expect, it } from "vitest";
import { createRoomPlanningVisualization } from "../src/planning/room-planning-visualization";
import type { StampPlacement } from "../src/planning/stamp-placement";
import { loadBotarena212RoomPlanningFixture } from "./helpers/room-planning-fixture";

const expectedStepIds = [
  "hub",
  "fastfiller-a",
  "fastfiller-b",
  "labs",
  "roads",
  "sources-sinks",
  "spare-extensions",
  "ramparts",
  "towers",
  "remaining-structures"
];

describe("room planning visualization", () => {
  it("creates a selected trace for a normal room", () => {
    const fixture = loadBotarena212RoomPlanningFixture();
    const room = fixture.map.getRoom(fixture.candidateRooms[0]!);
    if (room === null) {
      throw new Error("Expected fixture room.");
    }

    const visualization = createRoomPlanningVisualization(room, "normal");

    expect(visualization.roomName).toBe(room.roomName);
    expect(visualization.policy).toBe("normal");
    expect(visualization.validations).toEqual([]);
    expect(visualization.steps.map((step) => step.id)).toEqual(expectedStepIds);
    expect(visualization.steps.find((step) => step.id === "hub")?.candidates.length).toBeGreaterThan(0);
    expect(visualization.steps.find((step) => step.id === "hub")?.metrics.some((metric) => metric.label === "objective")).toBe(true);
    expect(visualization.steps.find((step) => step.id === "hub")?.metrics.some((metric) => metric.label === "tie-break")).toBe(true);
    expect(visualization.steps.find((step) => step.id === "hub")?.candidates[0]?.metrics.some((metric) => metric.label === "raw tuple")).toBe(true);
    expect(layerIds(visualization, "fastfiller-b")).toContain("fastfiller-a-committed");
    expect(layerTitles(visualization, "fastfiller-b")).toContain("Fastfiller pod A");
    expect(layerTitles(visualization, "fastfiller-b")).toContain("Fastfiller pod B");
    expect(layerIds(visualization, "hub")).toContain("hub-committed-creeps");
    expect(layerIds(visualization, "fastfiller-b")).toEqual(expect.arrayContaining([
      "fastfiller-a-committed-creeps",
      "fastfiller-b-committed-creeps"
    ]));
    expect(layerIds(visualization, "labs")).toContain("labs-committed-roads");
    expect(layerIds(visualization, "roads")).not.toContain("roads-all");
    expect(layerIds(visualization, "roads")).toContain("labs-committed-roads");
    expect(layerIds(visualization, "roads")).toContain("road-hub-spawn-to-storage");
    expect(layerIds(visualization, "roads")).toContain("road-storage-to-pod1");
    expect(layerTitles(visualization, "roads")).toContain("Road: Hub spawn -> Storage");
    expect(layerTitles(visualization, "roads")).toContain("Road: Storage -> Fastfiller pod A");
    expect(layerIds(visualization, "sources-sinks")).toEqual(expect.arrayContaining(["hub-committed", "fastfiller-a-committed", "fastfiller-b-committed", "labs-committed", "road-storage-to-pod1"]));
    expect(layerIds(visualization, "spare-extensions")).toEqual(expect.arrayContaining(["source-sink-structures", "pre-rampart-access-roads", "pre-rampart-structures"]));
    expect(layerIds(visualization, "towers")).toEqual(expect.arrayContaining(["hub-committed", "road-storage-to-pod1", "pre-rampart-structures", "cut-ramparts", "towers"]));
    expect(layerTiles(visualization, "roads", "labs-committed-roads")).toEqual(visualization.plan.stampPlan.stamps.labs?.roadTiles ?? []);
    expect(layerTiles(visualization, "hub", "hub-committed-creeps")).toEqual(expectedHubCreepTiles(visualization));
    expect(layerTiles(visualization, "fastfiller-b", "fastfiller-a-committed-creeps")).toEqual(expectedFastfillerCreepTiles(
      visualization.plan.stampPlan.stamps.fastfillers[0]
    ));
    expect(layerTiles(visualization, "fastfiller-b", "fastfiller-b-committed-creeps")).toEqual(expectedFastfillerCreepTiles(
      visualization.plan.stampPlan.stamps.fastfillers[1]
    ));
    expect(visualization.steps.find((step) => step.id === "roads")?.layers.some((layer) => layer.tiles.length > 0)).toBe(true);
    expect(visualization.steps.find((step) => step.id === "ramparts")?.metrics.some((metric) => metric.label === "rampart tiles")).toBe(true);
    expect(visualization.plan.structurePlan?.structures.filter((structure) => structure.type === "extension")).toHaveLength(60);
    expect(visualization.plan.structurePlan?.structures.filter((structure) => structure.type === "tower")).toHaveLength(6);
  }, 20_000);

  it("creates a selected trace for a temple room", () => {
    const fixture = loadBotarena212RoomPlanningFixture();
    const room = fixture.map.getRoom(fixture.candidateRooms[0]!);
    if (room === null) {
      throw new Error("Expected fixture room.");
    }

    const visualization = createRoomPlanningVisualization(room, "temple");
    const labsStep = visualization.steps.find((step) => step.id === "labs");

    expect(visualization.policy).toBe("temple");
    expect(visualization.validations).toEqual([]);
    expect(visualization.steps.map((step) => step.id)).toEqual(expectedStepIds);
    expect(labsStep?.status).toBe("skipped");
    expect(visualization.plan.stampPlan.stamps.labs).toBeNull();
    expect(layerTiles(visualization, "hub", "hub-committed-creeps")).toEqual(expectedHubCreepTiles(visualization));
    expect(visualization.plan.structurePlan?.structures.filter((structure) => structure.type === "lab")).toHaveLength(3);
  }, 20_000);

  it("plans E11N9 with automatic stamp search", () => {
    const fixture = loadBotarena212RoomPlanningFixture();
    const room = fixture.map.getRoom("E11N9");
    if (room === null) {
      throw new Error("Expected fixture room.");
    }

    const visualization = createRoomPlanningVisualization(room, "normal");

    expect(visualization.validations).toEqual([]);
    expect([3, 5, 8]).toContain(visualization.plan.stampPlan.topK);
  }, 20_000);

  it("returns completed stages when rampart planning fails", () => {
    const fixture = loadBotarena212RoomPlanningFixture();
    const room = fixture.map.getRoom("E18N6");
    if (room === null) {
      throw new Error("Expected fixture room.");
    }

    const visualization = createRoomPlanningVisualization(room, "normal");

    expect(visualization.plan.roadPlan).toBeDefined();
    expect(visualization.plan.sourceSinkPlan).toBeDefined();
    expect(visualization.plan.rampartPlan).toBeUndefined();
    expect(visualization.plan.structurePlan).toBeUndefined();
    expect(visualization.steps.find((step) => step.id === "ramparts")?.status).toBe("error");
    expect(visualization.steps.find((step) => step.id === "towers")?.status).toBe("skipped");
    expect(visualization.validations.some((message) => message.includes("No finite rampart cut found"))).toBe(true);
  }, 20_000);
});

function layerIds(visualization: ReturnType<typeof createRoomPlanningVisualization>, stepId: string): string[] {
  return visualization.steps.find((step) => step.id === stepId)?.layers.map((layer) => layer.id) ?? [];
}

function layerTitles(visualization: ReturnType<typeof createRoomPlanningVisualization>, stepId: string): string[] {
  return visualization.steps.find((step) => step.id === stepId)?.layers.map((layer) => layer.title) ?? [];
}

function layerTiles(
  visualization: ReturnType<typeof createRoomPlanningVisualization>,
  stepId: string,
  layerId: string
): number[] {
  return visualization.steps.find((step) => step.id === stepId)?.layers.find((layer) => layer.id === layerId)?.tiles ?? [];
}

function expectedHubCreepTiles(visualization: ReturnType<typeof createRoomPlanningVisualization>): number[] {
  const hub = visualization.plan.stampPlan.stamps.hub;
  const offsets = visualization.policy === "temple"
    ? [{ x: 1, y: 1 }, { x: 2, y: 1 }]
    : [{ x: 1, y: 1 }];
  return offsets.map((offset) => projectStampOffset(hub, offset)).sort((left, right) => left - right);
}

function expectedFastfillerCreepTiles(stamp: StampPlacement): number[] {
  return [
    projectStampOffset(stamp, { x: -1, y: 1 }),
    projectStampOffset(stamp, { x: 1, y: -1 })
  ].sort((left, right) => left - right);
}

function projectStampOffset(stamp: StampPlacement, offset: { x: number; y: number }): number {
  const rotated = rotateOffset(offset, stamp.rotation);
  return (stamp.anchor.y + rotated.y) * 50 + stamp.anchor.x + rotated.x;
}

function rotateOffset(offset: { x: number; y: number }, rotation: StampPlacement["rotation"]): { x: number; y: number } {
  switch (rotation) {
    case 0:
      return offset;
    case 90:
      return { x: -offset.y, y: offset.x };
    case 180:
      return { x: -offset.x, y: -offset.y };
    case 270:
      return { x: offset.y, y: -offset.x };
  }
}
