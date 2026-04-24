import { isConstructionSiteTerrainAllowed, isRoadPlanningTerrain } from "./construction-rules.ts";
import type { RampartPlan } from "./rampart-plan.ts";
import type { RoadPlan } from "./road-plan.ts";
import type { RoomPlanningRoomData } from "./room-plan.ts";
import {
  createStampStructurePlacements,
  type PlannedStructurePlacement,
  type PlannedStructureType
} from "./structure-layout.ts";
import type { SourceSinkStructurePlan } from "./source-sink-structure-plan.ts";
import type { RoomStampAnchor, RoomStampPlan } from "./stamp-placement.ts";

const roomSize = 50;
const roomArea = roomSize * roomSize;

export type RoomStructurePlan = {
  roomName: string;
  policy: RoomStampPlan["policy"];
  structures: PlannedStructurePlacement[];
  structureTiles: number[];
};

export function planRoomStructures(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  sourceSinkPlan: SourceSinkStructurePlan,
  rampartPlan: RampartPlan
): RoomStructurePlan {
  validateInputs(room, stampPlan, roadPlan, sourceSinkPlan, rampartPlan);
  const stampStructures = createStampStructurePlacements(stampPlan);
  const extensionRcls = assignExtensionRcls(stampPlan, stampStructures, rampartPlan);
  const structures = sortPlacements(dedupePlacements([
    ...applyExtensionRcls(stampStructures, extensionRcls),
    ...sourceSinkPlan.structures,
    ...createRoadPlacements(roadPlan, rampartPlan),
    ...createRampartPlacements(rampartPlan),
    ...rampartPlan.towers.map((tower, index) => createPlacement("tower", tower, 3, `tower-${index + 1}`)),
    ...(rampartPlan.nuker ? [createPlacement("nuker", rampartPlan.nuker, 8, "nuker")] : []),
    ...rampartPlan.extensions.map((extension, index) => createPlacement("extension", extension, extensionRcls.get(extension.tile) ?? 8, `extension-${index + 1}`)),
    ...(rampartPlan.observer ? [createPlacement("observer", rampartPlan.observer, 8, "observer")] : [])
  ]));

  return {
    roomName: room.roomName,
    policy: stampPlan.policy,
    structures,
    structureTiles: [...new Set(structures.map((structure) => structure.tile))].sort(compareNumbers)
  };
}

export function validateRoomStructurePlan(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  sourceSinkPlan: SourceSinkStructurePlan,
  rampartPlan: RampartPlan,
  structurePlan: RoomStructurePlan
): string[] {
  const errors: string[] = [];
  if (structurePlan.roomName !== room.roomName) {
    errors.push(`Structure plan room '${structurePlan.roomName}' does not match room '${room.roomName}'.`);
  }
  if (structurePlan.policy !== stampPlan.policy) {
    errors.push(`Structure plan policy '${structurePlan.policy}' does not match stamp policy '${stampPlan.policy}'.`);
  }

  const seenTypeTiles = new Set<string>();
  const occupiedBlockingTiles = new Map<number, PlannedStructurePlacement>();
  for (const structure of structurePlan.structures) {
    if (structure.tile !== toIndex(structure.x, structure.y)) {
      errors.push(`${structure.type} at ${structure.x},${structure.y} has mismatched tile index ${structure.tile}.`);
    }
    if (!isValidIndex(structure.tile)) {
      errors.push(`${structure.type} tile ${structure.tile} is outside the room.`);
      continue;
    }

    const key = `${structure.type}:${structure.tile}`;
    if (seenTypeTiles.has(key)) {
      errors.push(`Duplicate ${structure.type} at ${structure.x},${structure.y}.`);
    }
    seenTypeTiles.add(key);

    if (!isPlannedStructureTerrainAllowed(room.terrain, structure)) {
      errors.push(`${structure.type} at ${structure.x},${structure.y} is not buildable terrain.`);
    }

    if (isBlockingStructure(structure.type)) {
      const existing = occupiedBlockingTiles.get(structure.tile);
      if (existing) {
        errors.push(`${structure.type} at ${structure.x},${structure.y} overlaps ${existing.type}.`);
      } else {
        occupiedBlockingTiles.set(structure.tile, structure);
      }
    }
  }

  const expected = planRoomStructures(room, stampPlan, roadPlan, sourceSinkPlan, rampartPlan);
  const expectedKeys = expected.structures.map(structureKey);
  const actualKeys = [...structurePlan.structures].sort(comparePlacements).map(structureKey);
  if (actualKeys.join("|") !== expectedKeys.join("|")) {
    errors.push("Structure plan does not match deterministic final structure resolution.");
  }

  const expectedTiles = [...new Set(structurePlan.structures.map((structure) => structure.tile))].sort(compareNumbers);
  if (structurePlan.structureTiles.join(",") !== expectedTiles.join(",")) {
    errors.push("Structure tiles must match sorted occupied structure coordinates.");
  }

  const counts = countByType(structurePlan.structures);
  const expectedLabCount = stampPlan.policy === "temple" ? 3 : 10;
  if ((counts.get("extension") ?? 0) !== 60) {
    errors.push(`Expected 60 extensions, found ${counts.get("extension") ?? 0}.`);
  }
  if ((counts.get("spawn") ?? 0) !== 3) {
    errors.push(`Expected 3 spawns, found ${counts.get("spawn") ?? 0}.`);
  }
  if ((counts.get("lab") ?? 0) !== expectedLabCount) {
    errors.push(`Expected ${expectedLabCount} labs, found ${counts.get("lab") ?? 0}.`);
  }
  if ((counts.get("tower") ?? 0) !== rampartPlan.towers.length) {
    errors.push("Tower structure count does not match rampart tower placements.");
  }
  if ((counts.get("nuker") ?? 0) !== (rampartPlan.nuker ? 1 : 0)) {
    errors.push("Nuker structure count does not match rampart nuker placement.");
  }
  if ((counts.get("observer") ?? 0) !== (rampartPlan.observer ? 1 : 0)) {
    errors.push("Observer structure count does not match rampart observer placement.");
  }

  return errors;
}

function createRoadPlacements(roadPlan: RoadPlan, rampartPlan: RampartPlan): PlannedStructurePlacement[] {
  const roadTiles = [
    ...new Set([
      ...roadPlan.roadTiles,
      ...rampartPlan.expansionPlan.accessRoadTiles,
      ...rampartPlan.postRampartRoadTiles
    ])
  ].sort(compareNumbers);

  return roadTiles.map((tile) => createPlacement("road", fromIndex(tile), 2, "road"));
}

function createRampartPlacements(rampartPlan: RampartPlan): PlannedStructurePlacement[] {
  return rampartPlan.rampartTiles.map((tile) => createPlacement("rampart", fromIndex(tile), 2, "rampart"));
}

function assignExtensionRcls(
  stampPlan: RoomStampPlan,
  stampStructures: PlannedStructurePlacement[],
  rampartPlan: RampartPlan
): Map<number, number> {
  const podA = collectFastfillerExtensions(stampStructures, "pod1-", stampPlan.stamps.fastfillers[0]);
  const podB = collectFastfillerExtensions(stampStructures, "pod2-", stampPlan.stamps.fastfillers[1]);
  const spare = [...rampartPlan.extensions].sort(compareSpareExtensions);
  const orderedExtensions = [
    ...podA,
    ...podB,
    ...spare.map((extension) => ({ tile: extension.tile }))
  ];
  const rcls = new Map<number, number>();

  orderedExtensions.forEach((extension, index) => {
    rcls.set(extension.tile, getExtensionRcl(index + 1));
  });

  return rcls;
}

function applyExtensionRcls(
  placements: PlannedStructurePlacement[],
  extensionRcls: Map<number, number>
): PlannedStructurePlacement[] {
  return placements.map((placement) => {
    if (placement.type !== "extension") {
      return placement;
    }

    return {
      ...placement,
      rcl: extensionRcls.get(placement.tile) ?? placement.rcl
    };
  });
}

function collectFastfillerExtensions(
  placements: PlannedStructurePlacement[],
  labelPrefix: string,
  pod: RoomStampPlan["stamps"]["fastfillers"][number]
): PlannedStructurePlacement[] {
  const container = pod.anchors.container ?? pod.anchor;
  return placements
    .filter((placement) => placement.type === "extension" && placement.label.startsWith(labelPrefix))
    .sort((left, right) => compareFastfillerExtensions(left, right, container));
}

function compareFastfillerExtensions(
  left: PlannedStructurePlacement,
  right: PlannedStructurePlacement,
  container: RoomStampAnchor
): number {
  const leftRange = range(left, container);
  const rightRange = range(right, container);
  if (leftRange !== rightRange) {
    return leftRange - rightRange;
  }

  return compareCoordinates(left, right);
}

function compareSpareExtensions(
  left: RampartPlan["extensions"][number],
  right: RampartPlan["extensions"][number]
): number {
  const leftDistance = left.score[1] ?? Number.MAX_SAFE_INTEGER;
  const rightDistance = right.score[1] ?? Number.MAX_SAFE_INTEGER;
  if (leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }

  return compareCoordinates(left, right);
}

function getExtensionRcl(rank: number): number {
  if (rank <= 5) return 2;
  if (rank <= 10) return 3;
  if (rank <= 20) return 4;
  if (rank <= 30) return 5;
  if (rank <= 40) return 6;
  if (rank <= 50) return 7;
  return 8;
}

function createPlacement(type: PlannedStructureType, coord: RoomStampAnchor, rcl: number, label: string): PlannedStructurePlacement {
  return {
    type,
    x: coord.x,
    y: coord.y,
    tile: toIndex(coord.x, coord.y),
    label,
    rcl
  };
}

function validateInputs(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan,
  sourceSinkPlan: SourceSinkStructurePlan,
  rampartPlan: RampartPlan
): void {
  if (room.roomName !== stampPlan.roomName) {
    throw new Error(`Structure planning room mismatch: room '${room.roomName}' received stamp plan for '${stampPlan.roomName}'.`);
  }
  if (room.roomName !== roadPlan.roomName) {
    throw new Error(`Structure planning room mismatch: room '${room.roomName}' received road plan for '${roadPlan.roomName}'.`);
  }
  if (room.roomName !== sourceSinkPlan.roomName) {
    throw new Error(`Structure planning room mismatch: room '${room.roomName}' received source/sink plan for '${sourceSinkPlan.roomName}'.`);
  }
  if (room.roomName !== rampartPlan.roomName) {
    throw new Error(`Structure planning room mismatch: room '${room.roomName}' received rampart plan for '${rampartPlan.roomName}'.`);
  }
  if (stampPlan.policy !== roadPlan.policy || stampPlan.policy !== sourceSinkPlan.policy || stampPlan.policy !== rampartPlan.policy) {
    throw new Error("Structure planning policy mismatch between stamp, road, source/sink, and rampart plans.");
  }
}

function dedupePlacements(placements: PlannedStructurePlacement[]): PlannedStructurePlacement[] {
  const byKey = new Map<string, PlannedStructurePlacement>();
  for (const placement of placements) {
    const key = structureKey(placement);
    if (!byKey.has(key)) {
      byKey.set(key, placement);
    }
  }
  return [...byKey.values()];
}

function sortPlacements(placements: PlannedStructurePlacement[]): PlannedStructurePlacement[] {
  return [...placements].sort(comparePlacements);
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

function countByType(placements: PlannedStructurePlacement[]): Map<PlannedStructureType, number> {
  const counts = new Map<PlannedStructureType, number>();
  for (const placement of placements) {
    counts.set(placement.type, (counts.get(placement.type) ?? 0) + 1);
  }
  return counts;
}

function isBlockingStructure(type: PlannedStructureType): boolean {
  return type !== "road" && type !== "rampart" && type !== "container" && type !== "extractor";
}

function isPlannedStructureTerrainAllowed(terrain: string, structure: PlannedStructurePlacement): boolean {
  if (structure.type === "road") {
    return isRoadPlanningTerrain(terrain, structure.x, structure.y);
  }
  return isConstructionSiteTerrainAllowed(terrain, structure.type, structure.x, structure.y);
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function compareCoordinates(left: RoomStampAnchor, right: RoomStampAnchor): number {
  if (left.y !== right.y) {
    return left.y - right.y;
  }
  if (left.x !== right.x) {
    return left.x - right.x;
  }
  return toIndex(left.x, left.y) - toIndex(right.x, right.y);
}

function range(left: RoomStampAnchor, right: RoomStampAnchor): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
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

function fromIndex(index: number): RoomStampAnchor {
  return {
    x: index % roomSize,
    y: Math.floor(index / roomSize)
  };
}
