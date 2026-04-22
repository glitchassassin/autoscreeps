import { beforeEach, describe, expect, it } from "vitest";
import { planRoads, validateRoadPlan } from "../src/planning/road-plan";
import type { RoomPlanningRoomData } from "../src/planning/room-plan";
import type { RoomStampAnchor, RoomStampPlan, StampKind, StampPlacement } from "../src/planning/stamp-placement";
import { installScreepsGlobals } from "./helpers/install-globals";
import { botarena212RoadUnplannableNormalRooms, loadBotarena212NormalStampPlanFixture, loadBotarena212RoadPlanningFixture } from "./helpers/stamp-plan-fixture";
import { installTestPathFinder } from "./helpers/test-pathfinder";

const roomArea = 2500;

describe("road planning", () => {
  beforeEach(() => {
    installScreepsGlobals();
    installTestPathFinder(loadBotarena212NormalStampPlanFixture().terrainByRoom);
  });

  it("plans the required normal-room road paths for a cached stamp plan", () => {
    const testCase = loadBotarena212RoadPlanningFixture().cases[0]!;
    const plan = planRoads(testCase.room, testCase.plan);

    expect(validateRoadPlan(testCase.room, testCase.plan, plan)).toEqual([]);
    expect(new Set(plan.paths.map((path) => path.kind))).toEqual(new Set([
      "storage-to-pod1",
      "storage-to-pod2",
      "terminal-to-labs",
      "terminal-to-mineral",
      "storage-to-source1",
      "storage-to-source2",
      "storage-to-controller"
    ]));
    expect(plan.roadTiles.length).toBeGreaterThan(0);
    expect(plan.roads).toHaveLength(plan.roadTiles.length);
  });

  it("is deterministic for the same cached room and stamp inputs", () => {
    const testCase = loadBotarena212RoadPlanningFixture().cases[0]!;

    expect(planRoads(testCase.room, testCase.plan)).toEqual(planRoads(testCase.room, testCase.plan));
  });

  it("plans every road-plannable cached botarena-212 normal stamp layout", () => {
    const fixture = loadBotarena212RoadPlanningFixture();

    expect(fixture.cases.length).toBeGreaterThan(100);

    for (const testCase of fixture.cases) {
      const plan = planRoads(testCase.room, testCase.plan);
      const errors = validateRoadPlan(testCase.room, testCase.plan, plan);
      expect(errors, testCase.roomName).toEqual([]);
    }
  }, 60_000);

  it("keeps the cached corpus split explicit", () => {
    const allStampCases = loadBotarena212NormalStampPlanFixture();
    const roadCases = loadBotarena212RoadPlanningFixture();

    expect(allStampCases.skippedRooms).toEqual(["E14N7", "E15N2", "E2N5"]);
    expect(allStampCases.cases.length - roadCases.cases.length).toBe(botarena212RoadUnplannableNormalRooms.length);
  });

  it("documents cached stamp layouts that are not road-plannable", () => {
    const allStampCases = loadBotarena212NormalStampPlanFixture();
    const byName = new Map(allStampCases.cases.map((testCase) => [testCase.roomName, testCase]));

    for (const roomName of botarena212RoadUnplannableNormalRooms) {
      const testCase = byName.get(roomName);
      expect(testCase, roomName).toBeDefined();
      expect(() => planRoads(testCase!.room, testCase!.plan), roomName).toThrow();
    }
  });

  it("promotes reuse by making existing planned roads cheaper than new plain tiles", () => {
    const room = createSyntheticRoom();
    const stampPlan = createSyntheticStampPlan();
    installTestPathFinder({ [room.roomName]: room.terrain });

    const plan = planRoads(room, stampPlan);
    const summedPathTiles = plan.paths.reduce((total, path) => total + path.roadTiles.length, 0);

    expect(validateRoadPlan(room, stampPlan, plan)).toEqual([]);
    expect(summedPathTiles).toBeGreaterThan(plan.roadTiles.length);
  });
});

function createSyntheticRoom(): RoomPlanningRoomData {
  return {
    roomName: "W0N0",
    terrain: "0".repeat(roomArea),
    objects: [
      { id: "controller", roomName: "W0N0", type: "controller", x: 38, y: 16 },
      { id: "mineral", roomName: "W0N0", type: "mineral", x: 38, y: 14, mineralType: "H" },
      { id: "source-1", roomName: "W0N0", type: "source", x: 38, y: 10 },
      { id: "source-2", roomName: "W0N0", type: "source", x: 38, y: 12 }
    ]
  };
}

function createSyntheticStampPlan(): RoomStampPlan {
  const hub = createPlacement("hub", "hub", { x: 5, y: 10 }, {
    storage: { x: 5, y: 10 },
    terminal: { x: 5, y: 12 },
    hubCenter: { x: 6, y: 11 }
  });
  const pod1 = createPlacement("fastfiller", "pod1", { x: 20, y: 10 }, {
    container: { x: 20, y: 10 }
  });
  const pod2 = createPlacement("fastfiller", "pod2", { x: 20, y: 12 }, {
    container: { x: 20, y: 12 }
  });
  const labs = createPlacement("labs", "labs", { x: 22, y: 14 }, {
    entrance: { x: 22, y: 14 }
  });

  return {
    roomName: "W0N0",
    policy: "normal",
    topK: 1,
    score: [],
    stamps: {
      hub,
      fastfillers: [pod1, pod2],
      labs
    }
  };
}

function createPlacement(
  kind: StampKind,
  label: string,
  anchor: RoomStampAnchor,
  anchors: Record<string, RoomStampAnchor>
): StampPlacement {
  return {
    kind,
    label,
    rotation: 0,
    anchor,
    anchors,
    blockedTiles: Object.values(anchors).map((coord) => coord.y * 50 + coord.x),
    score: []
  };
}
