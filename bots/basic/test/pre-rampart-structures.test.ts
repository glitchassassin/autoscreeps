import { beforeEach, describe, expect, it } from "vitest";
import { planPreRampartStructures, validatePreRampartStructurePlan } from "../src/planning/pre-rampart-structures";
import { planRoads, type RoadPlan, type RoadPlanPathKind } from "../src/planning/road-plan";
import type { RoomPlanningRoomData } from "../src/planning/room-plan";
import { planSourceSinkStructures } from "../src/planning/source-sink-structure-plan";
import type { RoomStampAnchor, RoomStampPlan, StampKind, StampPlacement } from "../src/planning/stamp-placement";
import { installScreepsGlobals } from "./helpers/install-globals";
import { loadBotarena212NormalStampPlanFixture, loadBotarena212RoadPlanningFixture } from "./helpers/stamp-plan-fixture";
import { installTestPathFinder } from "./helpers/test-pathfinder";

const roomSize = 50;
const roomArea = roomSize * roomSize;

describe("pre-rampart structure planning", () => {
  beforeEach(() => {
    installScreepsGlobals();
    installTestPathFinder(loadBotarena212NormalStampPlanFixture().terrainByRoom);
  });

  it("reserves extra-structure slots adjacent to the cached road network", () => {
    const testCase = loadBotarena212RoadPlanningFixture().cases[0]!;
    const roadPlan = planRoads(testCase.room, testCase.plan);
    const sourceSinkPlan = planSourceSinkStructures(testCase.room, testCase.plan, roadPlan);
    const plan = planPreRampartStructures(testCase.room, testCase.plan, roadPlan, sourceSinkPlan);

    expect(validatePreRampartStructurePlan(testCase.room, testCase.plan, roadPlan, sourceSinkPlan, plan)).toEqual([]);
    expect(plan.extensionCount).toBe(36);
    expect(plan.towerCount).toBe(6);
    expect(plan.nukerCount).toBe(1);
    expect(plan.observerCount).toBe(1);
    expect(plan.extraStructures).toHaveLength(44);
    expect(plan.structureTiles).toEqual([...plan.structureTiles].sort((left, right) => left - right));
  });

  it("ranks candidates by planned-road distance from storage within a road group", () => {
    const room = createRoadDistanceRoom();
    const stampPlan = createRoadDistanceStampPlan();
    const roadPlan = createRoadDistanceRoadPlan();
    const plan = planPreRampartStructures(room, stampPlan, roadPlan, null, {
      extensionCount: 1,
      towerCount: 0,
      nukerCount: 0,
      observerCount: 0,
      growAccessRoads: false
    });

    expect(validatePreRampartStructurePlan(room, stampPlan, roadPlan, null, plan)).toEqual([]);
    expect(plan.extraStructures).toHaveLength(1);
    expect(plan.extraStructures[0]).toMatchObject({ x: 15, y: 9 });
  });
});

function createRoadDistanceRoom(): RoomPlanningRoomData {
  const terrain = Array.from({ length: roomArea }, () => "1");
  for (const coord of [
    { x: 10, y: 10 },
    { x: 15, y: 9 },
    { x: 9, y: 13 },
    { x: 35, y: 35 },
    { x: 40, y: 40 },
    { x: 42, y: 40 },
    ...createRoadDistanceRoadCoords()
  ]) {
    terrain[coord.y * roomSize + coord.x] = "0";
  }

  return {
    roomName: "W0N0",
    terrain: terrain.join(""),
    objects: [
      { id: "controller", roomName: "W0N0", type: "controller", x: 35, y: 35 },
      { id: "source-1", roomName: "W0N0", type: "source", x: 40, y: 40 },
      { id: "source-2", roomName: "W0N0", type: "source", x: 42, y: 40 }
    ]
  };
}

function createRoadDistanceStampPlan(): RoomStampPlan {
  return {
    roomName: "W0N0",
    policy: "normal",
    topK: 1,
    score: [],
    stamps: {
      hub: createPlacement("hub", "hub", { x: 10, y: 10 }, {
        storage: { x: 10, y: 10 },
        hubCenter: { x: 10, y: 10 }
      }),
      fastfillers: [
        createPlacement("fastfiller", "pod1", { x: 40, y: 40 }, { container: { x: 40, y: 40 } }),
        createPlacement("fastfiller", "pod2", { x: 42, y: 40 }, { container: { x: 42, y: 40 } })
      ],
      labs: null
    }
  };
}

function createRoadDistanceRoadPlan(): RoadPlan {
  const roadTiles = createRoadDistanceRoadCoords().map((coord) => coord.y * roomSize + coord.x);
  return {
    roomName: "W0N0",
    policy: "normal",
    roadTiles: [...roadTiles].sort((left, right) => left - right),
    roads: roadTiles.map(fromIndex),
    paths: [
      createPath("storage-to-controller", "W0N0", { x: 10, y: 10 }, { x: 35, y: 35 }, createRoadDistanceRoadCoords())
    ]
  };
}

function createRoadDistanceRoadCoords(): RoomStampAnchor[] {
  return [
    { x: 11, y: 10 },
    { x: 12, y: 10 },
    { x: 13, y: 10 },
    { x: 14, y: 10 },
    { x: 15, y: 10 },
    { x: 16, y: 11 },
    { x: 17, y: 12 },
    { x: 18, y: 13 },
    { x: 18, y: 14 },
    { x: 17, y: 15 },
    { x: 16, y: 16 },
    { x: 15, y: 16 },
    { x: 14, y: 16 },
    { x: 13, y: 16 },
    { x: 12, y: 16 },
    { x: 11, y: 15 },
    { x: 10, y: 14 },
    { x: 10, y: 13 }
  ];
}

function createPath(
  kind: RoadPlanPathKind,
  roomName: string,
  origin: RoomStampAnchor,
  target: RoomStampAnchor,
  tiles: RoomStampAnchor[]
): RoadPlan["paths"][number] {
  const roadTiles = tiles.map((tile) => tile.y * roomSize + tile.x);
  return {
    kind,
    origin: {
      ...origin,
      label: "origin",
      range: 0
    },
    target: {
      ...target,
      label: "target",
      range: 1
    },
    tiles,
    roadTiles,
    cost: roadTiles.length,
    ops: roadTiles.length,
    incomplete: false
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
    blockedTiles: [...new Set([anchor, ...Object.values(anchors)].map((coord) => coord.y * roomSize + coord.x))],
    score: []
  };
}

function fromIndex(index: number): RoomStampAnchor {
  return {
    x: index % roomSize,
    y: Math.floor(index / roomSize)
  };
}
