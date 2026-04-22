import { beforeEach, describe, expect, it } from "vitest";
import { planRamparts, validateRampartPlan } from "../src/planning/rampart-plan";
import { planRoads, type RoadPlan, type RoadPlanPathKind } from "../src/planning/road-plan";
import type { RoomPlanningRoomData } from "../src/planning/room-plan";
import type { RoomStampAnchor, RoomStampPlan, StampKind, StampPlacement } from "../src/planning/stamp-placement";
import { installScreepsGlobals } from "./helpers/install-globals";
import { loadBotarena212NormalStampPlanFixture, loadBotarena212RoadPlanningFixture } from "./helpers/stamp-plan-fixture";
import { installTestPathFinder } from "./helpers/test-pathfinder";

const roomSize = 50;
const roomArea = roomSize * roomSize;

describe("rampart planning", () => {
  beforeEach(() => {
    installScreepsGlobals();
    installTestPathFinder(loadBotarena212NormalStampPlanFixture().terrainByRoom);
  });

  it("separates exits from the mandatory defended footprint for a cached room", () => {
    const testCase = loadBotarena212RoadPlanningFixture().cases[0]!;
    const roadPlan = planRoads(testCase.room, testCase.plan);
    const rampartPlan = planRamparts(testCase.room, testCase.plan, roadPlan);

    expect(validateRampartPlan(testCase.room, testCase.plan, roadPlan, rampartPlan)).toEqual([]);
    expect(rampartPlan.rampartTiles.length).toBeGreaterThan(0);
    expect(rampartPlan.ramparts).toHaveLength(rampartPlan.rampartTiles.length);
    expect(rampartPlan.optionalRegions.map((region) => region.key)).toEqual(["source1", "source2", "controller"]);
    expect(rampartPlan.score.rampartCount).toBe(rampartPlan.rampartTiles.length);
    expect(rampartPlan.score.totalCost).toBeGreaterThanOrEqual(rampartPlan.score.rampartBaseCost);
    expect(rampartPlan.preRampartStructures.extraStructures).toHaveLength(42);
    expect(rampartPlan.extensions).toHaveLength(36);
    expect(rampartPlan.towers).toHaveLength(6);
    expect(rampartPlan.extensionTiles).toEqual([...rampartPlan.extensionTiles].sort((left, right) => left - right));
    expect(rampartPlan.towerTiles).toEqual([...rampartPlan.towerTiles].sort((left, right) => left - right));
    for (const tile of rampartPlan.preRampartStructures.accessRoadTiles) {
      expect(rampartPlan.defendedTiles).toContain(tile);
    }
    for (const tile of rampartPlan.preRampartStructures.structureTiles) {
      expect(rampartPlan.defendedTiles).toContain(tile);
    }
  }, 20_000);

  it("is deterministic for the same room, stamp, and road inputs", () => {
    const testCase = loadBotarena212RoadPlanningFixture().cases[0]!;
    const roadPlan = planRoads(testCase.room, testCase.plan);

    expect(planRamparts(testCase.room, testCase.plan, roadPlan)).toEqual(planRamparts(testCase.room, testCase.plan, roadPlan));
  }, 20_000);

  it("protects controller access while treating the controller road as an optional region", () => {
    const testCase = loadBotarena212RoadPlanningFixture().cases.find((candidate) => candidate.roomName === "E11N4")!;
    const roadPlan = planRoads(testCase.room, testCase.plan);
    const rampartPlan = planRamparts(testCase.room, testCase.plan, roadPlan);
    const controllerPath = roadPlan.paths.find((path) => path.kind === "storage-to-controller")!;
    const controller = testCase.room.objects.find((object) => object.type === "controller")!;
    const controllerAccessTiles = collectWalkableRangeTiles(testCase.room, controller, 1);

    expect(validateRampartPlan(testCase.room, testCase.plan, roadPlan, rampartPlan)).toEqual([]);
    expect(rampartPlan.rampartTiles.some((tile) => controllerPath.roadTiles.includes(tile))).toBe(true);
    expect(rampartPlan.optionalRegions.find((region) => region.key === "controller")?.tiles)
      .toEqual([...controllerPath.roadTiles].sort((left, right) => left - right));
    for (const tile of controllerAccessTiles) {
      expect(rampartPlan.outsideTiles).not.toContain(tile);
    }
  }, 20_000);

  it("uses independent source penalties to decide whether an optional region is inside", () => {
    const room = createCorridorRoom();
    const stampPlan = createCorridorStampPlan();
    const roadPlan = createCorridorRoadPlan();
    const protectedSourceEndpoint = 25 * roomSize + 15;
    const noExtraStructures = { extensionCount: 0, towerCount: 0 };

    const withoutPenalty = planRamparts(room, stampPlan, roadPlan, { sourceRegionPenaltyRamparts: [0, 0], preRampartStructureOptions: noExtraStructures });
    const withPenalty = planRamparts(room, stampPlan, roadPlan, { sourceRegionPenaltyRamparts: [0, 1], preRampartStructureOptions: noExtraStructures });

    expect(validateRampartPlan(room, stampPlan, roadPlan, withoutPenalty, { sourceRegionPenaltyRamparts: [0, 0], preRampartStructureOptions: noExtraStructures })).toEqual([]);
    expect(validateRampartPlan(room, stampPlan, roadPlan, withPenalty, { sourceRegionPenaltyRamparts: [0, 1], preRampartStructureOptions: noExtraStructures })).toEqual([]);
    expect(withoutPenalty.optionalRegions[1].protected).toBe(false);
    expect(withPenalty.optionalRegions[1].protected).toBe(true);
    expect(withoutPenalty.outsideTiles).toContain(protectedSourceEndpoint);
    expect(withPenalty.outsideTiles).not.toContain(protectedSourceEndpoint);
  });
});

function createCorridorRoom(): RoomPlanningRoomData {
  const terrain = Array.from({ length: roomArea }, () => "1");
  for (let x = 0; x <= 35; x += 1) {
    terrain[25 * roomSize + x] = "0";
  }

  return {
    roomName: "W0N0",
    terrain: terrain.join(""),
    objects: [
      { id: "controller", roomName: "W0N0", type: "controller", x: 34, y: 24 },
      { id: "mineral", roomName: "W0N0", type: "mineral", x: 20, y: 24, mineralType: "H" },
      { id: "source-1", roomName: "W0N0", type: "source", x: 15, y: 24 },
      { id: "source-2", roomName: "W0N0", type: "source", x: 5, y: 24 }
    ]
  };
}

function createCorridorStampPlan(): RoomStampPlan {
  const hub = createPlacement("hub", "hub", { x: 30, y: 25 }, {
    storage: { x: 30, y: 25 },
    terminal: { x: 30, y: 25 },
    hubCenter: { x: 30, y: 25 }
  });
  const pod1 = createPlacement("fastfiller", "pod1", { x: 31, y: 25 }, {
    container: { x: 31, y: 25 }
  });
  const pod2 = createPlacement("fastfiller", "pod2", { x: 32, y: 25 }, {
    container: { x: 32, y: 25 }
  });
  const labs = createPlacement("labs", "labs", { x: 33, y: 25 }, {
    entrance: { x: 33, y: 25 }
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

function createCorridorRoadPlan(): RoadPlan {
  const roomName = "W0N0";
  const paths = [
    createPath("storage-to-pod1", roomName, { x: 30, y: 25 }, { x: 31, y: 25 }, [{ x: 31, y: 25 }]),
    createPath("storage-to-pod2", roomName, { x: 30, y: 25 }, { x: 32, y: 25 }, [{ x: 32, y: 25 }]),
    createPath("terminal-to-labs", roomName, { x: 30, y: 25 }, { x: 33, y: 25 }, [{ x: 33, y: 25 }]),
    createPath("storage-to-labs", roomName, { x: 30, y: 25 }, { x: 33, y: 25 }, [{ x: 33, y: 25 }]),
    createPath("terminal-to-mineral", roomName, { x: 30, y: 25 }, { x: 20, y: 24 }, [{ x: 20, y: 25 }]),
    createPath("storage-to-source1", roomName, { x: 30, y: 25 }, { x: 5, y: 24 }, [{ x: 5, y: 25 }]),
    createPath("storage-to-source2", roomName, { x: 30, y: 25 }, { x: 15, y: 24 }, [{ x: 15, y: 25 }]),
    createPath("storage-to-controller", roomName, { x: 30, y: 25 }, { x: 34, y: 24 }, [{ x: 34, y: 25 }])
  ];
  const roadTiles = [...new Set(paths.flatMap((path) => path.roadTiles))].sort((left, right) => left - right);

  return {
    roomName,
    policy: "normal",
    roadTiles,
    roads: roadTiles.map(fromIndex),
    paths
  };
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
    blockedTiles: [...new Set(Object.values(anchors).map((coord) => coord.y * roomSize + coord.x))],
    score: []
  };
}

function fromIndex(index: number): RoomStampAnchor {
  return {
    x: index % roomSize,
    y: Math.floor(index / roomSize)
  };
}

function collectWalkableRangeTiles(
  room: RoomPlanningRoomData,
  center: RoomStampAnchor,
  rangeLimit: number
): number[] {
  const tiles: number[] = [];
  const blockers = new Set(room.objects
    .filter((object) => object.type === "controller" || object.type === "source" || object.type === "mineral" || object.type === "deposit")
    .map((object) => object.y * roomSize + object.x));

  for (let y = Math.max(0, center.y - rangeLimit); y <= Math.min(roomSize - 1, center.y + rangeLimit); y += 1) {
    for (let x = Math.max(0, center.x - rangeLimit); x <= Math.min(roomSize - 1, center.x + rangeLimit); x += 1) {
      const tile = y * roomSize + x;
      if (Math.max(Math.abs(center.x - x), Math.abs(center.y - y)) <= rangeLimit
        && (room.terrain.charCodeAt(tile) - 48 & 1) === 0
        && !blockers.has(tile)) {
        tiles.push(tile);
      }
    }
  }

  return tiles;
}
