import { describe, expect, it } from "vitest";
import { createRoomPlanningVisualization } from "../src/planning/room-planning-visualization";
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
    expect(layerIds(visualization, "labs")).toContain("labs-committed-roads");
    expect(layerIds(visualization, "roads")).not.toContain("roads-all");
    expect(layerIds(visualization, "roads")).toContain("labs-committed-roads");
    expect(layerIds(visualization, "roads")).toContain("road-storage-to-pod1");
    expect(layerTitles(visualization, "roads")).toContain("Road: Storage -> Fastfiller pod A");
    expect(layerIds(visualization, "sources-sinks")).toEqual(expect.arrayContaining(["hub-committed", "fastfiller-a-committed", "fastfiller-b-committed", "labs-committed", "road-storage-to-pod1"]));
    expect(layerIds(visualization, "spare-extensions")).toEqual(expect.arrayContaining(["source-sink-structures", "pre-rampart-access-roads", "pre-rampart-structures"]));
    expect(layerIds(visualization, "towers")).toEqual(expect.arrayContaining(["hub-committed", "road-storage-to-pod1", "pre-rampart-structures", "cut-ramparts", "towers"]));
    expect(layerTiles(visualization, "roads", "labs-committed-roads")).toEqual(visualization.plan.stampPlan.stamps.labs?.roadTiles ?? []);
    expect(visualization.steps.find((step) => step.id === "roads")?.layers.some((layer) => layer.tiles.length > 0)).toBe(true);
    expect(visualization.steps.find((step) => step.id === "ramparts")?.metrics.some((metric) => metric.label === "rampart tiles")).toBe(true);
    expect(visualization.plan.structurePlan.structures.filter((structure) => structure.type === "extension")).toHaveLength(60);
    expect(visualization.plan.structurePlan.structures.filter((structure) => structure.type === "tower")).toHaveLength(6);
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
    expect(visualization.plan.structurePlan.structures.filter((structure) => structure.type === "lab")).toHaveLength(3);
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
