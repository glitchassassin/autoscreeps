import type { ConstructionPlan, ConstructionSiteRequestPlan, WorldSnapshot } from "../core/types";
import { roomPlannerVersion } from "./room-planning-runtime";

const activeConstructionSiteTarget = 1;

type PlannedStructureMemory = NonNullable<RoomPlanningMemoryState["structures"]>[number];

export function createConstructionPlan(world: WorldSnapshot): ConstructionPlan {
  const roomName = world.primaryRoomName;
  const controllerLevel = world.primaryController?.level ?? 0;
  const activeSiteCount = world.primaryConstructionSiteCount;
  if (roomName === null || controllerLevel <= 0) {
    return createEmptyConstructionPlan(roomName, activeSiteCount);
  }

  const candidates = collectPlaceableConstructionSites(world, roomName, controllerLevel);
  return {
    roomName,
    activeSiteCount,
    placeableSiteCount: candidates.length,
    backlogCount: activeSiteCount + candidates.length,
    request: activeSiteCount >= activeConstructionSiteTarget ? null : candidates[0] ?? null
  };
}

function createEmptyConstructionPlan(roomName: string | null, activeSiteCount: number): ConstructionPlan {
  return {
    roomName,
    activeSiteCount,
    placeableSiteCount: 0,
    backlogCount: activeSiteCount,
    request: null
  };
}

function collectPlaceableConstructionSites(
  world: WorldSnapshot,
  roomName: string,
  controllerLevel: number
): ConstructionSiteRequestPlan[] {
  const plannedStructures = getCompletePlannedStructures(roomName);
  if (plannedStructures.length === 0) {
    return [];
  }

  const builtStructureKeys = new Set(world.primaryStructures.map((structure) => structureKey(structure.structureType, structure.x, structure.y)));
  const activeSiteTiles = new Set(world.primaryConstructionSites.map((site) => tileKey(site.x, site.y)));
  const activeSiteKeys = new Set(world.primaryConstructionSites.map((site) => structureKey(site.structureType, site.x, site.y)));

  return plannedStructures
    .filter((structure) => isBuildableStructureType(structure.type))
    .filter((structure) => isStructureUnlocked(structure, controllerLevel))
    .filter((structure) => !builtStructureKeys.has(structureKey(structure.type, structure.x, structure.y)))
    .filter((structure) => !activeSiteKeys.has(structureKey(structure.type, structure.x, structure.y)) && !activeSiteTiles.has(tileKey(structure.x, structure.y)))
    .map((structure): ConstructionSiteRequestPlan => ({
      roomName,
      x: structure.x,
      y: structure.y,
      structureType: structure.type as BuildableStructureConstant,
      rcl: structure.rcl,
      label: structure.label
    }))
    .sort(compareConstructionRequests);
}

function getCompletePlannedStructures(roomName: string): PlannedStructureMemory[] {
  const planning = Memory.rooms?.[roomName]?.planning;
  if (planning?.version !== roomPlannerVersion || planning.status !== "complete" || !planning.structures) {
    return [];
  }

  return planning.structures;
}

function isStructureUnlocked(structure: PlannedStructureMemory, controllerLevel: number): boolean {
  return structure.rcl <= controllerLevel && (structure.removeAtRcl === undefined || controllerLevel < structure.removeAtRcl);
}

function compareConstructionRequests(left: ConstructionSiteRequestPlan, right: ConstructionSiteRequestPlan): number {
  const leftPriority = getStructurePriority(left.structureType);
  const rightPriority = getStructurePriority(right.structureType);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  if (left.rcl !== right.rcl) {
    return left.rcl - right.rcl;
  }
  if (left.structureType !== right.structureType) {
    return left.structureType.localeCompare(right.structureType);
  }
  if (left.y !== right.y) {
    return left.y - right.y;
  }
  if (left.x !== right.x) {
    return left.x - right.x;
  }
  return left.label.localeCompare(right.label);
}

function getStructurePriority(structureType: BuildableStructureConstant): number {
  if (structureType === STRUCTURE_EXTENSION) {
    return 0;
  }
  if (structureType === STRUCTURE_ROAD) {
    return 2;
  }
  if (structureType === STRUCTURE_RAMPART) {
    return 3;
  }
  return 1;
}

function isBuildableStructureType(type: string): type is BuildableStructureConstant {
  return type === STRUCTURE_EXTENSION
    || type === STRUCTURE_RAMPART
    || type === STRUCTURE_ROAD
    || type === STRUCTURE_SPAWN
    || type === STRUCTURE_LINK
    || type === STRUCTURE_WALL
    || type === STRUCTURE_STORAGE
    || type === STRUCTURE_TOWER
    || type === STRUCTURE_OBSERVER
    || type === STRUCTURE_POWER_SPAWN
    || type === STRUCTURE_EXTRACTOR
    || type === STRUCTURE_LAB
    || type === STRUCTURE_TERMINAL
    || type === STRUCTURE_CONTAINER
    || type === STRUCTURE_NUKER
    || type === STRUCTURE_FACTORY;
}

function structureKey(type: string, x: number, y: number): string {
  return `${type}:${tileKey(x, y)}`;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}
