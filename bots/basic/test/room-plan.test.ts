import { describe, expect, it } from "vitest";
import { createDijkstraMap, dijkstraUnreachable } from "../src/planning/dijkstra-map";
import { planRoom, type RoomPlanningRoomData } from "../src/planning/room-plan";
import {
  createStampPlacementDebug,
  getStampPathBlockedTiles,
  type RoomStampAnchor,
  type RoomStampPlan,
  type StampPlacement,
  validateStampPlan
} from "../src/planning/stamp-placement";
import { loadBotarena212RoomPlanningFixture } from "./helpers/room-planning-fixture";

const roomSize = 50;
const roomArea = roomSize * roomSize;
const terrainMaskWall = 1;
const controllerStampReserveRange = 3;
const sourceStampReserveRange = 2;
const edgeStampReserveRange = 2;
const reservedPathUnplannableNormalRooms = new Set(["E14N7", "E15N2", "E2N5"]);

describe("room planning", () => {
  it("identifies the viable botarena-212 planning rooms", () => {
    const fixture = loadBotarena212RoomPlanningFixture();

    expect(fixture.candidateRooms).toHaveLength(144);
  });

  it("plans every reserved-path viable botarena-212 room", () => {
    const fixture = loadBotarena212RoomPlanningFixture();
    const unplannableRooms = new Set<string>();

    for (const roomName of fixture.candidateRooms) {
      try {
        const plan = planRoom({
          roomName,
          policy: "normal",
          map: fixture.map
        });
        const room = fixture.map.getRoom(roomName);
        if (room === null) {
          throw new Error(`Fixture room '${roomName}' not found.`);
        }

        expect(validateStampPlan(room, plan.stampPlan), roomName).toEqual([]);
        expect(getReservedStampTileViolations(room, plan.stampPlan), roomName).toEqual([]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (reservedPathUnplannableNormalRooms.has(roomName) && message.includes("No viable normal stamp layout found")) {
          unplannableRooms.add(roomName);
          continue;
        }
        throw new Error(`Room '${roomName}' failed planning: ${message}`);
      }
    }

    expect([...unplannableRooms].sort()).toEqual([...reservedPathUnplannableNormalRooms].sort());
  }, 120_000);

  it("returns anchor-based opaque stamp placements", () => {
    const fixture = loadBotarena212RoomPlanningFixture();
    const roomName = fixture.candidateRooms[0]!;
    const room = fixture.map.getRoom(roomName);
    if (room === null) {
      throw new Error(`Fixture room '${roomName}' not found.`);
    }

    const plan = planRoom({
      roomName,
      policy: "normal",
      map: fixture.map
    });

    expect(plan.stampPlan.stamps.hub.kind).toBe("hub");
    expect(plan.stampPlan.stamps.hub.anchors.storage).toEqual(plan.stampPlan.stamps.hub.anchor);
    expect(plan.stampPlan.stamps.fastfillers).toHaveLength(2);
    for (const pod of plan.stampPlan.stamps.fastfillers) {
      expect(pod.kind).toBe("fastfiller");
      expect(pod.anchors.container).toEqual(pod.anchor);
      expect(pod.blockedTiles).toHaveLength(17);
    }
    const labs = plan.stampPlan.stamps.labs;
    expect(labs?.kind).toBe("labs");
    if (labs === null) {
      throw new Error("Expected normal room plan to include labs.");
    }
    expect(labs.blockedTiles).toHaveLength(14);
    expect(getStampPathBlockedTiles(labs)).toHaveLength(10);
    expect(labs.roadTiles).toHaveLength(4);
    expect(toLocalOffsetKeys(labs, labs.roadTiles ?? [])).toEqual(["0,0", "1,1", "2,2", "3,3"]);
    expect(validateStampPlan(room, plan.stampPlan)).toEqual([]);
    expect(getReservedStampTileViolations(room, plan.stampPlan)).toEqual([]);
  });

  it("scores final path distances against final stamp and reserved path masks", () => {
    const fixture = loadBotarena212RoomPlanningFixture();
    const roomName = fixture.candidateRooms[0]!;
    const room = fixture.map.getRoom(roomName);
    if (room === null) {
      throw new Error(`Fixture room '${roomName}' not found.`);
    }

    const plan = planRoom({
      roomName,
      policy: "normal",
      map: fixture.map
    });
    const exactMetrics = computeFinalFastfillerMetrics(room, plan.stampPlan);
    const exactLabDistance = computeFinalLabDistance(room, plan.stampPlan);
    const storageScoreIndex = plan.stampPlan.stamps.hub.score.length;

    expect(exactMetrics.storageDistance).not.toBe(dijkstraUnreachable);
    expect(exactMetrics.sourceDetour).not.toBe(dijkstraUnreachable);
    expect(exactLabDistance).not.toBe(dijkstraUnreachable);
    expect(plan.stampPlan.score[storageScoreIndex]).toBe(-exactMetrics.storageDistance);
    expect(plan.stampPlan.score[storageScoreIndex + 1]).toBe(-exactMetrics.sourceDetour);
    expect(plan.stampPlan.score[storageScoreIndex + 2]).toBe(-exactLabDistance);
  });

  it("builds debug phases for visualizing the selected branch", () => {
    const fixture = loadBotarena212RoomPlanningFixture();
    const roomName = fixture.candidateRooms[0]!;
    const room = fixture.map.getRoom(roomName);
    if (room === null) {
      throw new Error(`Fixture room '${roomName}' not found.`);
    }

    const plan = planRoom({
      roomName,
      policy: "normal",
      map: fixture.map
    });
    const debug = createStampPlacementDebug(room, "normal", plan.stampPlan);

    expect(debug.phases.map((phase) => phase.name)).toEqual([
      "hub candidates",
      "pod1 candidates after hub",
      "pod2 candidates after hub + pod1",
      "lab candidates after fastfillers"
    ]);
    for (const phase of debug.phases) {
      expect(phase.candidates.length).toBeGreaterThan(0);
      expect(phase.selectedLabel).not.toBeNull();
      expect(phase.candidates.some((candidate) => candidate.label === phase.selectedLabel)).toBe(true);
    }
  });

  it("supports temple hub placement without a normal lab stamp", () => {
    const fixture = loadBotarena212RoomPlanningFixture();
    const roomName = fixture.candidateRooms[0]!;
    const room = fixture.map.getRoom(roomName);
    if (room === null) {
      throw new Error(`Fixture room '${roomName}' not found.`);
    }

    const plan = planRoom({
      roomName,
      policy: "temple",
      map: fixture.map
    });

    expect(plan.stampPlan.stamps.hub.kind).toBe("hub");
    expect(plan.stampPlan.stamps.labs).toBeNull();
    expect(validateStampPlan(room, plan.stampPlan)).toEqual([]);
  });
});

function computeFinalFastfillerMetrics(room: RoomPlanningRoomData, plan: RoomStampPlan): { storageDistance: number; sourceDetour: number } {
  const blocked = createFinalPathBlocked(room, plan);
  const controller = getRoomObject(room, "controller");
  const sources = getRoomSources(room);
  const reservedPathMasks = createReservedPathMasks(controller, sources);
  const storage = plan.stamps.hub.anchors.storage ?? plan.stamps.hub.anchor;
  const storageGoals = getPathGoals(room.terrain, blocked, reservedPathMasks.default, storage);
  if (storageGoals.length === 0) {
    return { storageDistance: dijkstraUnreachable, sourceDetour: dijkstraUnreachable };
  }

  const storageDistanceMap = createDijkstraMap(room.terrain, storageGoals, {
    costMatrix: createCostMatrix(blocked, reservedPathMasks.default)
  });

  let storageDistance = 0;
  for (const pod of plan.stamps.fastfillers) {
    const distance = storageDistanceMap.get(pod.anchor.x, pod.anchor.y);
    if (distance === dijkstraUnreachable) {
      return { storageDistance: dijkstraUnreachable, sourceDetour: dijkstraUnreachable };
    }
    storageDistance += distance;
  }

  const sourceDistanceMaps = sources.map((source, index) => {
    const sourceGoals = getPathGoals(room.terrain, blocked, reservedPathMasks.sourceOrigins[index]!, source);
    return sourceGoals.length === 0
      ? null
      : createDijkstraMap(room.terrain, sourceGoals, {
        costMatrix: createCostMatrix(blocked, reservedPathMasks.sourceOrigins[index]!)
      });
  });
  const storageToSourceDistances = sourceDistanceMaps.map((map) => (
    map === null ? dijkstraUnreachable : minDistance(map, storageGoals)
  ));
  const sourceDetours = plan.stamps.fastfillers.map((pod) => sourceDistanceMaps.map((map, index) => {
    const storageToSourceDistance = storageToSourceDistances[index]!;
    if (map === null || storageToSourceDistance === dijkstraUnreachable) {
      return dijkstraUnreachable;
    }

    const podStorageDistance = storageDistanceMap.get(pod.anchor.x, pod.anchor.y);
    const podSourceDistance = map.get(pod.anchor.x, pod.anchor.y);
    if (podStorageDistance === dijkstraUnreachable || podSourceDistance === dijkstraUnreachable) {
      return dijkstraUnreachable;
    }

    return podStorageDistance + podSourceDistance - storageToSourceDistance;
  })) as [[number, number], [number, number]];
  const sourceDetour = Math.min(
    sourceDetours[0][0] + sourceDetours[1][1],
    sourceDetours[0][1] + sourceDetours[1][0]
  );

  return { storageDistance, sourceDetour };
}

function computeFinalLabDistance(room: RoomPlanningRoomData, plan: RoomStampPlan): number {
  if (plan.stamps.labs === null) {
    return 0;
  }

  const blocked = createFinalPathBlocked(room, plan);
  const controller = getRoomObject(room, "controller");
  const sources = getRoomSources(room);
  const reservedPathMasks = createReservedPathMasks(controller, sources);
  const storage = plan.stamps.hub.anchors.storage ?? plan.stamps.hub.anchor;
  const terminal = plan.stamps.hub.anchors.terminal;
  const entrance = plan.stamps.labs.anchors.entrance ?? plan.stamps.labs.anchor;
  if (terminal === undefined) {
    return dijkstraUnreachable;
  }

  const storageGoals = getPathGoals(room.terrain, blocked, reservedPathMasks.default, storage);
  const terminalGoals = getPathGoals(room.terrain, blocked, reservedPathMasks.default, terminal);
  const labGoals = getDirectPathGoals(room.terrain, blocked, reservedPathMasks.default, entrance);
  if (storageGoals.length === 0 || terminalGoals.length === 0 || labGoals.length === 0) {
    return dijkstraUnreachable;
  }

  const storageDistanceMap = createDijkstraMap(room.terrain, storageGoals, {
    costMatrix: createCostMatrix(blocked, reservedPathMasks.default)
  });
  const terminalDistanceMap = createDijkstraMap(room.terrain, terminalGoals, {
    costMatrix: createCostMatrix(blocked, reservedPathMasks.default)
  });
  const storageDistance = minDistance(storageDistanceMap, labGoals);
  const terminalDistance = minDistance(terminalDistanceMap, labGoals);
  return storageDistance === dijkstraUnreachable || terminalDistance === dijkstraUnreachable
    ? dijkstraUnreachable
    : storageDistance + terminalDistance;
}

function createFinalPathBlocked(room: RoomPlanningRoomData, plan: RoomStampPlan): Uint8Array {
  const blocked = new Uint8Array(roomArea);
  for (const object of room.objects) {
    if (isNaturalBlocker(object.type)) {
      blocked[toIndex(object.x, object.y)] = 1;
    }
  }

  const stamps = [plan.stamps.hub, ...plan.stamps.fastfillers, ...(plan.stamps.labs ? [plan.stamps.labs] : [])];
  for (const stamp of stamps) {
    for (const tile of getStampPathBlockedTiles(stamp)) {
      blocked[tile] = 1;
    }
  }

  for (const pod of plan.stamps.fastfillers) {
    blocked[toIndex(pod.anchor.x, pod.anchor.y)] = 0;
  }
  if (plan.stamps.labs !== null) {
    const entrance = plan.stamps.labs.anchors.entrance ?? plan.stamps.labs.anchor;
    blocked[toIndex(entrance.x, entrance.y)] = 0;
    for (const tile of plan.stamps.labs.roadTiles ?? []) {
      blocked[tile] = 0;
    }
  }

  return blocked;
}

function getReservedStampTileViolations(room: RoomPlanningRoomData, plan: RoomStampPlan): string[] {
  const stamps = [plan.stamps.hub, ...plan.stamps.fastfillers, ...(plan.stamps.labs ? [plan.stamps.labs] : [])];
  const violations: string[] = [];

  for (const stamp of stamps) {
    for (const tile of stamp.blockedTiles) {
      const coord = fromIndex(tile);
      if (isReservedStampTile(room, coord)) {
        violations.push(`${stamp.label} ${coord.x},${coord.y}`);
      }
    }
  }

  return violations;
}

function isReservedStampTile(room: RoomPlanningRoomData, coord: RoomStampAnchor): boolean {
  if (!isInRoom(coord.x, coord.y)) {
    return false;
  }
  if (isReservedEdgeTile(coord)) {
    return true;
  }

  return room.objects.some((object) => (
    (object.type === "controller" && range(coord, object) <= controllerStampReserveRange)
    || (object.type === "source" && range(coord, object) <= sourceStampReserveRange)
  ));
}

function getRoomObject(room: RoomPlanningRoomData, type: string): RoomPlanningRoomData["objects"][number] {
  const object = room.objects.find((candidate) => candidate.type === type);
  if (object === undefined) {
    throw new Error(`Room '${room.roomName}' is missing ${type}.`);
  }
  return object;
}

function getRoomSources(room: RoomPlanningRoomData): [RoomPlanningRoomData["objects"][number], RoomPlanningRoomData["objects"][number]] {
  const sources = room.objects.filter((object) => object.type === "source").sort(compareObjects);
  if (sources.length !== 2) {
    throw new Error(`Room '${room.roomName}' must have exactly two sources.`);
  }
  return [sources[0]!, sources[1]!];
}

function createReservedPathMasks(
  controller: RoomPlanningRoomData["objects"][number],
  sources: [RoomPlanningRoomData["objects"][number], RoomPlanningRoomData["objects"][number]]
): { default: Uint8Array; sourceOrigins: [Uint8Array, Uint8Array] } {
  return {
    default: createReservedPathMask(controller, sources, null),
    sourceOrigins: [
      createReservedPathMask(controller, sources, 0),
      createReservedPathMask(controller, sources, 1)
    ]
  };
}

function createReservedPathMask(
  controller: RoomPlanningRoomData["objects"][number],
  sources: [RoomPlanningRoomData["objects"][number], RoomPlanningRoomData["objects"][number]],
  sourceExemptionIndex: number | null
): Uint8Array {
  const mask = new Uint8Array(roomArea);
  for (let y = 0; y < roomSize; y += 1) {
    for (let x = 0; x < roomSize; x += 1) {
      const coord = { x, y };
      if (isReservedPathTile(controller, sources, coord, sourceExemptionIndex)) {
        mask[toIndex(x, y)] = 1;
      }
    }
  }
  return mask;
}

function isReservedPathTile(
  controller: RoomPlanningRoomData["objects"][number],
  sources: [RoomPlanningRoomData["objects"][number], RoomPlanningRoomData["objects"][number]],
  coord: RoomStampAnchor,
  sourceExemptionIndex: number | null
): boolean {
  if (sourceExemptionIndex !== null && range(coord, sources[sourceExemptionIndex]!) <= sourceStampReserveRange) {
    return false;
  }

  return isReservedEdgeTile(coord)
    || range(coord, controller) <= controllerStampReserveRange
    || sources.some((source, index) => (
      range(coord, source) <= sourceStampReserveRange && sourceExemptionIndex !== index
    ));
}

function getPathGoals(terrain: string, blocked: Uint8Array, reservedPathMask: Uint8Array, target: RoomStampAnchor): RoomStampAnchor[] {
  return neighbors(target).filter((coord) => (
    isWalkableTerrain(terrain, coord.x, coord.y)
    && blocked[toIndex(coord.x, coord.y)] === 0
    && reservedPathMask[toIndex(coord.x, coord.y)] === 0
  ));
}

function getDirectPathGoals(terrain: string, blocked: Uint8Array, reservedPathMask: Uint8Array, target: RoomStampAnchor): RoomStampAnchor[] {
  if (
    isWalkableTerrain(terrain, target.x, target.y)
    && blocked[toIndex(target.x, target.y)] === 0
    && reservedPathMask[toIndex(target.x, target.y)] === 0
  ) {
    return [target];
  }
  return getPathGoals(terrain, blocked, reservedPathMask, target);
}

function createCostMatrix(blocked: Uint8Array, reservedPathMask: Uint8Array): Pick<PathFinder["CostMatrix"], "get"> {
  return {
    get(x: number, y: number): number {
      const index = toIndex(x, y);
      return blocked[index] === 0 && reservedPathMask[index] === 0 ? 0 : 255;
    }
  };
}

function minDistance(map: ReturnType<typeof createDijkstraMap>, goals: RoomStampAnchor[]): number {
  let best = dijkstraUnreachable;
  for (const goal of goals) {
    const distance = map.get(goal.x, goal.y);
    if (distance < best) {
      best = distance;
    }
  }
  return best;
}

function neighbors(coord: RoomStampAnchor): RoomStampAnchor[] {
  const result: RoomStampAnchor[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const x = coord.x + dx;
      const y = coord.y + dy;
      if (x >= 0 && x < roomSize && y >= 0 && y < roomSize) {
        result.push({ x, y });
      }
    }
  }
  return result;
}

function isNaturalBlocker(type: string): boolean {
  return type === "controller" || type === "source" || type === "mineral" || type === "deposit";
}

function isReservedEdgeTile(coord: RoomStampAnchor): boolean {
  return coord.x <= edgeStampReserveRange || coord.y <= edgeStampReserveRange
    || coord.x >= roomSize - 1 - edgeStampReserveRange || coord.y >= roomSize - 1 - edgeStampReserveRange;
}

function toLocalOffsetKeys(stamp: StampPlacement, tiles: number[]): string[] {
  return tiles
    .map(fromIndex)
    .map((coord) => inverseRotateOffset({
      x: coord.x - stamp.anchor.x,
      y: coord.y - stamp.anchor.y
    }, stamp.rotation))
    .map((coord) => `${coord.x},${coord.y}`)
    .sort();
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

function isWalkableTerrain(terrain: string, x: number, y: number): boolean {
  return (terrain.charCodeAt(toIndex(x, y)) - 48 & terrainMaskWall) === 0;
}

function isInRoom(x: number, y: number): boolean {
  return x >= 0 && x < roomSize && y >= 0 && y < roomSize;
}

function range(left: RoomStampAnchor, right: RoomStampAnchor): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function compareObjects(left: RoomStampAnchor & { id: string }, right: RoomStampAnchor & { id: string }): number {
  if (left.x !== right.x) {
    return left.x - right.x;
  }
  if (left.y !== right.y) {
    return left.y - right.y;
  }
  return left.id.localeCompare(right.id);
}

function toIndex(x: number, y: number): number {
  return y * roomSize + x;
}

function fromIndex(index: number): RoomStampAnchor {
  return {
    x: index % roomSize,
    y: Math.floor(index / roomSize)
  };
}
