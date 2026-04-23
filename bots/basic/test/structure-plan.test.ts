import { beforeEach, describe, expect, it } from "vitest";
import { planRamparts } from "../src/planning/rampart-plan";
import { planRoads, type RoadPlan, type RoadPlanPathKind } from "../src/planning/road-plan";
import { planCompleteRoom } from "../src/planning/room-plan";
import type { RoomPlanningRoomData } from "../src/planning/room-plan";
import { planSourceSinkStructures } from "../src/planning/source-sink-structure-plan";
import { planRoomStructures, validateRoomStructurePlan, type RoomStructurePlan } from "../src/planning/structure-plan";
import type { RoomStampAnchor, RoomStampPlan, StampKind, StampPlacement } from "../src/planning/stamp-placement";
import { installScreepsGlobals } from "./helpers/install-globals";
import { loadBotarena212NormalStampPlanFixture, loadBotarena212RoadPlanningFixture } from "./helpers/stamp-plan-fixture";
import { installTestPathFinder } from "./helpers/test-pathfinder";

const roomSize = 50;
const roomArea = roomSize * roomSize;

describe("structure planning", () => {
  beforeEach(() => {
    installScreepsGlobals();
    installTestPathFinder(loadBotarena212NormalStampPlanFixture().terrainByRoom);
  });

  it("resolves final structures from stamps, roads, and ramparts", () => {
    const testCase = loadBotarena212RoadPlanningFixture().cases[0]!;
    const roadPlan = planRoads(testCase.room, testCase.plan);
    const sourceSinkPlan = planSourceSinkStructures(testCase.room, testCase.plan, roadPlan);
    const rampartPlan = planRamparts(testCase.room, testCase.plan, roadPlan, sourceSinkPlan);
    const structurePlan = planRoomStructures(testCase.room, testCase.plan, roadPlan, sourceSinkPlan, rampartPlan);
    const counts = countByType(structurePlan);

    expect(validateRoomStructurePlan(testCase.room, testCase.plan, roadPlan, sourceSinkPlan, rampartPlan, structurePlan)).toEqual([]);
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
      ...rampartPlan.expansionPlan.accessRoadTiles,
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
    expect(structurePlan.structures.find((structure) => structure.tile === 23 + 19 * 50 && structure.type === "road")).toBeUndefined();
    expect(structurePlan.structures.find((structure) => structure.tile === 24 + 19 * 50 && structure.type === "road")).toBeUndefined();
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
    expect(plan.sourceSinkPlan.structureTiles.length).toBeGreaterThan(0);
    expect(plan.rampartPlan.rampartTiles.length).toBeGreaterThan(0);
    expect(validateRoomStructurePlan(testCase.room, plan.stampPlan, plan.roadPlan, plan.sourceSinkPlan, plan.rampartPlan, plan.structurePlan)).toEqual([]);
  }, 20_000);

  it("rejects controller link placement on already planned road tiles", () => {
    const room = createControllerLinkRoadRoom();
    const stampPlan = createControllerLinkRoadStampPlan();
    const roadPlan = createControllerLinkRoadPlan();

    expect(() => planSourceSinkStructures(room, stampPlan, roadPlan)).toThrow("No controller link tile found");
  });
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

function createControllerLinkRoadRoom(): RoomPlanningRoomData {
  const terrain = Array.from({ length: roomArea }, () => "0");
  terrain[toIndex(6, 9)] = "1";
  terrain[toIndex(6, 11)] = "1";

  return {
    roomName: "W0N0",
    terrain: terrain.join(""),
    objects: [
      { id: "controller", roomName: "W0N0", type: "controller", x: 10, y: 10 },
      { id: "source-1", roomName: "W0N0", type: "source", x: 40, y: 10 },
      { id: "source-2", roomName: "W0N0", type: "source", x: 40, y: 20 },
      { id: "mineral", roomName: "W0N0", type: "mineral", x: 35, y: 35, mineralType: "H" }
    ]
  };
}

function createControllerLinkRoadStampPlan(): RoomStampPlan {
  return {
    roomName: "W0N0",
    policy: "normal",
    topK: 1,
    score: [],
    stamps: {
      hub: createPlacement("hub", "hub", { x: 2, y: 10 }, {
        storage: { x: 2, y: 10 },
        terminal: { x: 2, y: 12 },
        hubCenter: { x: 3, y: 11 }
      }),
      fastfillers: [
        createPlacement("fastfiller", "pod1", { x: 20, y: 10 }, {
          container: { x: 20, y: 10 }
        }),
        createPlacement("fastfiller", "pod2", { x: 20, y: 20 }, {
          container: { x: 20, y: 20 }
        })
      ],
      labs: null
    }
  };
}

function createControllerLinkRoadPlan(): RoadPlan {
  const paths = [
    createPath("storage-to-source1", { x: 2, y: 10 }, { x: 40, y: 10 }, horizontalTiles(3, 39, 10)),
    createPath("storage-to-source2", { x: 2, y: 10 }, { x: 40, y: 20 }, [
      ...horizontalTiles(3, 20, 10),
      ...verticalTiles(20, 11, 20),
      ...horizontalTiles(21, 39, 20)
    ]),
    createPath("terminal-to-mineral", { x: 2, y: 12 }, { x: 35, y: 35 }, [
      ...horizontalTiles(3, 34, 12),
      ...verticalTiles(34, 13, 35)
    ]),
    createPath("storage-to-controller", { x: 2, y: 10 }, { x: 10, y: 10 }, horizontalTiles(3, 7, 10))
  ];

  return {
    roomName: "W0N0",
    policy: "normal",
    roadTiles: [...new Set(paths.flatMap((path) => path.roadTiles))].sort((left, right) => left - right),
    roads: [],
    paths
  };
}

function createPath(kind: RoadPlanPathKind, origin: RoomStampAnchor, target: RoomStampAnchor, tiles: RoomStampAnchor[]): RoadPlan["paths"][number] {
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
      range: kind === "storage-to-controller" ? 3 : 1
    },
    tiles,
    roadTiles: tiles.map((tile) => toIndex(tile.x, tile.y)),
    cost: tiles.length,
    ops: tiles.length,
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
    blockedTiles: [...new Set([anchor, ...Object.values(anchors)].map((coord) => toIndex(coord.x, coord.y)))],
    score: []
  };
}

function horizontalTiles(startX: number, endX: number, y: number): RoomStampAnchor[] {
  const tiles: RoomStampAnchor[] = [];
  for (let x = startX; x <= endX; x += 1) {
    tiles.push({ x, y });
  }
  return tiles;
}

function verticalTiles(x: number, startY: number, endY: number): RoomStampAnchor[] {
  const tiles: RoomStampAnchor[] = [];
  for (let y = startY; y <= endY; y += 1) {
    tiles.push({ x, y });
  }
  return tiles;
}

function toIndex(x: number, y: number): number {
  return y * roomSize + x;
}
