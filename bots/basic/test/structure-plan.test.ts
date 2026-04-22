import { beforeEach, describe, expect, it } from "vitest";
import { planRamparts } from "../src/planning/rampart-plan";
import { planRoads } from "../src/planning/road-plan";
import { planCompleteRoom } from "../src/planning/room-plan";
import { planRoomStructures, validateRoomStructurePlan, type RoomStructurePlan } from "../src/planning/structure-plan";
import type { RoomStampAnchor, RoomStampPlan, StampPlacement } from "../src/planning/stamp-placement";
import { installScreepsGlobals } from "./helpers/install-globals";
import { loadBotarena212NormalStampPlanFixture, loadBotarena212RoadPlanningFixture } from "./helpers/stamp-plan-fixture";
import { installTestPathFinder } from "./helpers/test-pathfinder";

describe("structure planning", () => {
  beforeEach(() => {
    installScreepsGlobals();
    installTestPathFinder(loadBotarena212NormalStampPlanFixture().terrainByRoom);
  });

  it("resolves final structures from stamps, roads, and ramparts", () => {
    const testCase = loadBotarena212RoadPlanningFixture().cases[0]!;
    const roadPlan = planRoads(testCase.room, testCase.plan);
    const rampartPlan = planRamparts(testCase.room, testCase.plan, roadPlan);
    const structurePlan = planRoomStructures(testCase.room, testCase.plan, roadPlan, rampartPlan);
    const counts = countByType(structurePlan);

    expect(validateRoomStructurePlan(testCase.room, testCase.plan, roadPlan, rampartPlan, structurePlan)).toEqual([]);
    expect(counts.get("extension")).toBe(60);
    expect(counts.get("tower")).toBe(6);
    expect(counts.get("spawn")).toBe(3);
    expect(counts.get("lab")).toBe(10);
    expect(counts.get("link")).toBe(6);
    expect(counts.get("container")).toBe(6);
    expect(counts.get("storage")).toBe(1);
    expect(counts.get("terminal")).toBe(1);
    expect(counts.get("factory")).toBe(1);
    expect(counts.get("powerSpawn")).toBe(1);
    expect(counts.get("extractor")).toBe(1);
    expect(counts.get("nuker")).toBe(1);
    expect(counts.get("observer")).toBe(1);
    expect(counts.get("rampart")).toBe(rampartPlan.rampartTiles.length);
    expect(counts.get("road")).toBe(new Set([
      ...roadPlan.roadTiles,
      ...rampartPlan.preRampartStructures.accessRoadTiles,
      ...rampartPlan.postRampartRoadTiles,
      ...getLabRoadTiles(testCase.plan)
    ]).size);
    expect(getLabStructurePattern(structurePlan, testCase.plan)).toEqual([
      "lab:0,1",
      "lab:0,2",
      "lab:1,0",
      "lab:1,2",
      "lab:1,3",
      "lab:2,0",
      "lab:2,1",
      "lab:2,3",
      "lab:3,1",
      "lab:3,2",
      "road:0,0",
      "road:1,1",
      "road:2,2",
      "road:3,3"
    ]);
    expect(structurePlan.structures.find((structure) => structure.label === "controller-container")?.removeAtRcl).toBe(7);
  }, 20_000);

  it("exposes a complete room plan entry point", () => {
    const fixture = loadBotarena212NormalStampPlanFixture();
    const testCase = loadBotarena212RoadPlanningFixture().cases[0]!;
    const plan = planCompleteRoom({
      roomName: testCase.roomName,
      policy: "normal",
      map: {
        getRoom: (roomName) => fixture.cases.find((candidate) => candidate.roomName === roomName)?.room ?? null
      }
    });

    expect(plan.roadPlan.roadTiles.length).toBeGreaterThan(0);
    expect(plan.rampartPlan.rampartTiles.length).toBeGreaterThan(0);
    expect(validateRoomStructurePlan(testCase.room, plan.stampPlan, plan.roadPlan, plan.rampartPlan, plan.structurePlan)).toEqual([]);
  }, 20_000);
});

function countByType(plan: RoomStructurePlan): Map<string, number> {
  const counts = new Map<string, number>();
  for (const structure of plan.structures) {
    counts.set(structure.type, (counts.get(structure.type) ?? 0) + 1);
  }
  return counts;
}

function getLabRoadTiles(plan: RoomStampPlan): number[] {
  if (plan.stamps.labs === null) {
    return [];
  }

  return labRoadOffsets().map((offset) => {
    const coord = applyStampOffset(plan.stamps.labs!, offset);
    return coord.y * 50 + coord.x;
  });
}

function getLabStructurePattern(structurePlan: RoomStructurePlan, plan: RoomStampPlan): string[] {
  if (plan.stamps.labs === null) {
    return [];
  }

  return structurePlan.structures
    .filter((structure) => structure.type === "lab" || structure.label.startsWith("lab-road-"))
    .map((structure) => `${structure.type}:${toLocalOffsetKey(plan.stamps.labs!, structure)}`)
    .sort();
}

function labRoadOffsets(): RoomStampAnchor[] {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 3 }
  ];
}

function applyStampOffset(stamp: StampPlacement, offset: RoomStampAnchor): RoomStampAnchor {
  const rotated = rotateOffset(offset, stamp.rotation);
  return {
    x: stamp.anchor.x + rotated.x,
    y: stamp.anchor.y + rotated.y
  };
}

function toLocalOffsetKey(stamp: StampPlacement, coord: RoomStampAnchor): string {
  const offset = inverseRotateOffset({
    x: coord.x - stamp.anchor.x,
    y: coord.y - stamp.anchor.y
  }, stamp.rotation);
  return `${offset.x},${offset.y}`;
}

function rotateOffset(offset: RoomStampAnchor, rotation: StampPlacement["rotation"]): RoomStampAnchor {
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

function inverseRotateOffset(offset: RoomStampAnchor, rotation: StampPlacement["rotation"]): RoomStampAnchor {
  switch (rotation) {
    case 0:
      return offset;
    case 90:
      return { x: offset.y, y: -offset.x };
    case 180:
      return { x: -offset.x, y: -offset.y };
    case 270:
      return { x: -offset.y, y: offset.x };
  }
}
