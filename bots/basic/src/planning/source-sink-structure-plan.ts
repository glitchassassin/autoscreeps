import type { RoadPlan } from "./road-plan.ts";
import type { RoomPlanningRoomData } from "./room-plan.ts";
import {
  createSourceSinkStructurePlacements,
  createStampStructurePlacements,
  type PlannedStructurePlacement,
  type PlannedStructureType
} from "./structure-layout.ts";
import type { RoomStampPlan } from "./stamp-placement.ts";

const roomSize = 50;
const roomArea = roomSize * roomSize;
const terrainMaskWall = 1;

export type SourceSinkStructurePlan = {
  roomName: string;
  policy: RoomStampPlan["policy"];
  structures: PlannedStructurePlacement[];
  structureTiles: number[];
};

export function planSourceSinkStructures(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan
): SourceSinkStructurePlan {
  validateInputs(room, stampPlan, roadPlan);
  const stampStructures = createStampStructurePlacements(stampPlan);
  const structures = createSourceSinkStructurePlacements(room, stampPlan, roadPlan, {
    blockedTiles: stampStructures.map((placement) => placement.tile)
  });

  return {
    roomName: room.roomName,
    policy: stampPlan.policy,
    structures,
    structureTiles: [...new Set(structures.map((structure) => structure.tile))].sort(compareNumbers)
  };
}

export function validateSourceSinkStructurePlan(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  sourceSinkPlan: SourceSinkStructurePlan
): string[] {
  const errors: string[] = [];
  if (sourceSinkPlan.roomName !== room.roomName) {
    errors.push(`Source/sink plan room '${sourceSinkPlan.roomName}' does not match room '${room.roomName}'.`);
  }
  if (sourceSinkPlan.policy !== stampPlan.policy) {
    errors.push(`Source/sink plan policy '${sourceSinkPlan.policy}' does not match stamp policy '${stampPlan.policy}'.`);
  }

  const seenTypeTiles = new Set<string>();
  for (const structure of sourceSinkPlan.structures) {
    if (structure.tile !== toIndex(structure.x, structure.y)) {
      errors.push(`${structure.label} has mismatched tile index ${structure.tile}.`);
    }
    if (!isValidIndex(structure.tile)) {
      errors.push(`${structure.label} tile ${structure.tile} is outside the room.`);
      continue;
    }

    if (structure.type !== "container" && structure.type !== "link" && structure.type !== "extractor") {
      errors.push(`Unexpected source/sink structure type '${structure.type}' at ${structure.x},${structure.y}.`);
    }

    const key = `${structure.type}:${structure.tile}`;
    if (seenTypeTiles.has(key)) {
      errors.push(`Duplicate ${structure.type} at ${structure.x},${structure.y}.`);
    }
    seenTypeTiles.add(key);

    if (structure.type !== "extractor" && !isWalkableTerrain(room.terrain, structure.x, structure.y)) {
      errors.push(`${structure.type} at ${structure.x},${structure.y} is on unwalkable terrain.`);
    }
  }

  const expected = planSourceSinkStructures(room, stampPlan, roadPlan);
  const expectedKeys = expected.structures.map(structureKey);
  const actualKeys = [...sourceSinkPlan.structures].sort(comparePlacements).map(structureKey);
  if (actualKeys.join("|") !== expectedKeys.join("|")) {
    errors.push("Source/sink structure plan does not match deterministic structure resolution.");
  }

  const expectedTiles = [...new Set(sourceSinkPlan.structures.map((structure) => structure.tile))].sort(compareNumbers);
  if (sourceSinkPlan.structureTiles.join(",") !== expectedTiles.join(",")) {
    errors.push("Source/sink structure tiles must match sorted occupied structure coordinates.");
  }

  const counts = countByType(sourceSinkPlan.structures);
  const expectedContainerCount = stampPlan.policy === "temple" ? 3 : 4;
  const expectedLinkCount = stampPlan.policy === "temple" ? 2 : 3;
  if ((counts.get("container") ?? 0) !== expectedContainerCount) {
    errors.push(`Expected ${expectedContainerCount} source/sink containers, found ${counts.get("container") ?? 0}.`);
  }
  if ((counts.get("link") ?? 0) !== expectedLinkCount) {
    errors.push(`Expected ${expectedLinkCount} source/sink links, found ${counts.get("link") ?? 0}.`);
  }
  if ((counts.get("extractor") ?? 0) !== 1) {
    errors.push(`Expected 1 source/sink extractor, found ${counts.get("extractor") ?? 0}.`);
  }

  return errors;
}

function validateInputs(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan
): void {
  if (room.roomName !== stampPlan.roomName) {
    throw new Error(`Source/sink structure planning room mismatch: room '${room.roomName}' received stamp plan for '${stampPlan.roomName}'.`);
  }
  if (room.roomName !== roadPlan.roomName) {
    throw new Error(`Source/sink structure planning room mismatch: room '${room.roomName}' received road plan for '${roadPlan.roomName}'.`);
  }
  if (stampPlan.policy !== roadPlan.policy) {
    throw new Error(`Source/sink structure planning policy mismatch: stamp plan '${stampPlan.policy}' received road plan '${roadPlan.policy}'.`);
  }
}

function countByType(placements: PlannedStructurePlacement[]): Map<PlannedStructureType, number> {
  const counts = new Map<PlannedStructureType, number>();
  for (const placement of placements) {
    counts.set(placement.type, (counts.get(placement.type) ?? 0) + 1);
  }
  return counts;
}

function comparePlacements(left: PlannedStructurePlacement, right: PlannedStructurePlacement): number {
  if (left.tile !== right.tile) {
    return left.tile - right.tile;
  }
  return left.type.localeCompare(right.type);
}

function structureKey(placement: PlannedStructurePlacement): string {
  return `${placement.type}:${placement.tile}:${placement.rcl}:${placement.removeAtRcl ?? ""}`;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function isWalkableTerrain(terrain: string, x: number, y: number): boolean {
  return isInRoom(x, y) && (terrain.charCodeAt(toIndex(x, y)) - 48 & terrainMaskWall) === 0;
}

function isValidIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < roomArea;
}

function isInRoom(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < roomSize && y >= 0 && y < roomSize;
}

function toIndex(x: number, y: number): number {
  return y * roomSize + x;
}
