import type { RoomPositionSnapshot } from "../core/types";
import { getSourceHarvestSlots } from "../world/source-slots";

const spawnDeliveryPadCount = 2;

type PositionReservationContext = {
  reservedPositions: Record<string, true>;
};

const adjacentOffsets: Array<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [-1, -1],
  [-1, 0],
  [0, 1],
  [1, 1],
  [-1, 1]
];

export function moveToWorkTarget(creep: Creep, target: RoomObject, range: number, stroke: string): ReturnType<Creep["moveTo"]> {
  return creep.moveTo(target, {
    range,
    costCallback: createReservedPadCostCallback(creep.room),
    visualizePathStyle: { stroke }
  });
}

export function moveToWithdrawTarget(creep: Creep, target: StructureSpawn, stroke: string): ReturnType<Creep["moveTo"]> {
  return creep.moveTo(target, {
    costCallback: createReservedPadCostCallback(creep.room),
    visualizePathStyle: { stroke }
  });
}

export function moveToRunnerDeliveryTarget(creep: Creep, target: RoomObject, stroke: string): ReturnType<Creep["moveTo"]> {
  const deliveryPad = getOpenRunnerDeliveryPad(creep, target);
  if (deliveryPad) {
    return creep.moveTo(deliveryPad, {
      range: 0,
      visualizePathStyle: { stroke }
    });
  }

  return creep.moveTo(target, { visualizePathStyle: { stroke } });
}

export function moveToRunnerPickupTarget(
  creep: Creep,
  target: Resource<ResourceConstant>,
  stroke: string,
  positionContext?: PositionReservationContext
): ReturnType<Creep["moveTo"]> {
  const pickupPad = getOpenRunnerPickupPad(creep, target, positionContext);
  if (pickupPad) {
    const result = creep.moveTo(pickupPad, {
      range: 0,
      visualizePathStyle: { stroke }
    });
    if (result === OK) {
      reservePosition(positionContext, pickupPad);
    }
    return result;
  }

  return creep.moveTo(target, {
    costCallback: createSourceHarvestSlotCostCallback(creep.room),
    visualizePathStyle: { stroke }
  });
}

export function moveAwayFromSpawnAccess(creep: Creep, spawn: StructureSpawn, stroke: string): ReturnType<Creep["moveTo"]> | null {
  if (!creep.pos.isNearTo(spawn)) {
    return null;
  }

  const destination = findReliefPosition(creep, spawn);
  if (!destination) {
    return null;
  }

  return creep.moveTo(destination, {
    range: 0,
    visualizePathStyle: { stroke }
  });
}

function getOpenRunnerDeliveryPad(creep: Creep, target: RoomObject): RoomPosition | null {
  if (!isSpawn(target)) {
    return null;
  }

  const openPads = getSpawnDeliveryPads(target).filter((position) => position.isEqualTo(creep.pos) || !hasCreep(position));
  if (openPads.length === 0) {
    return null;
  }

  return creep.pos.findClosestByPath(openPads) ?? openPads[0] ?? null;
}

function getOpenRunnerPickupPad(
  creep: Creep,
  target: Resource<ResourceConstant>,
  positionContext: PositionReservationContext | undefined
): RoomPosition | null {
  const reservedSourceSlotKeys = new Set(getReservedSourceHarvestSlotsForRoom(creep.room).map(getPositionSnapshotKey));
  const candidates = [
    createRoomPosition(target.pos.x, target.pos.y, target.pos.roomName),
    ...adjacentOffsets.map(([dx, dy]) => createRoomPosition(target.pos.x + dx, target.pos.y + dy, target.pos.roomName))
  ]
    .filter((position) =>
      isRoomInterior(position)
      && isWalkable(creep.room, position)
      && !reservedSourceSlotKeys.has(getPositionKey(position))
      && (position.isEqualTo(creep.pos) || (!isPositionReserved(positionContext, position) && !hasCreep(position)))
    );

  if (candidates.length === 0) {
    return null;
  }

  return creep.pos.findClosestByPath(candidates) ?? candidates.toSorted(comparePositions)[0] ?? null;
}

function findReliefPosition(creep: Creep, spawn: StructureSpawn): RoomPosition | null {
  const reservedPadKeys = new Set(getReservedDeliveryPadsForRoom(creep.room).map(getPositionKey));
  const candidates = adjacentOffsets
    .map(([dx, dy]) => createRoomPosition(creep.pos.x + dx, creep.pos.y + dy, creep.pos.roomName))
    .filter((position) =>
      isRoomInterior(position)
      && isWalkable(creep.room, position)
      && position.getRangeTo(spawn) > 1
      && !reservedPadKeys.has(getPositionKey(position))
      && !hasCreep(position)
    )
    .sort((left, right) => {
      const rangeComparison = right.getRangeTo(spawn) - left.getRangeTo(spawn);
      return rangeComparison !== 0 ? rangeComparison : comparePositions(left, right);
    });

  return candidates[0] ?? null;
}

function getReservedDeliveryPadsForRoom(room: Room): RoomPosition[] {
  return Object.values(Game.spawns)
    .filter((spawn) => spawn.room.name === room.name)
    .flatMap((spawn) => getSpawnDeliveryPads(spawn));
}

function getReservedSourceHarvestSlotsForRoom(room: Room): RoomPositionSnapshot[] {
  return room.find(FIND_SOURCES).flatMap((source) => getSourceHarvestSlots(source));
}

function getSpawnDeliveryPads(spawn: StructureSpawn): RoomPosition[] {
  const sources = spawn.room.find(FIND_SOURCES);
  const controller = spawn.room.controller;
  return adjacentOffsets
    .map(([dx, dy], index) => ({
      index,
      position: createRoomPosition(spawn.pos.x + dx, spawn.pos.y + dy, spawn.pos.roomName)
    }))
    .filter(({ position }) => isRoomInterior(position) && isWalkable(spawn.room, position))
    .sort((left, right) => {
      const sourceComparison = getClosestRange(left.position, sources) - getClosestRange(right.position, sources);
      if (sourceComparison !== 0) {
        return sourceComparison;
      }

      const controllerComparison = (controller ? right.position.getRangeTo(controller) : 0) - (controller ? left.position.getRangeTo(controller) : 0);
      if (controllerComparison !== 0) {
        return controllerComparison;
      }

      return left.index - right.index;
    })
    .slice(0, spawnDeliveryPadCount)
    .map(({ position }) => position);
}

function createReservedPadCostCallback(room: Room): MoveToOpts["costCallback"] | undefined {
  const reservedPads = getReservedDeliveryPadsForRoom(room);
  if (reservedPads.length === 0) {
    return undefined;
  }

  return (roomName, costMatrix) => {
    if (roomName !== room.name) {
      return costMatrix;
    }

    for (const position of reservedPads) {
      costMatrix.set(position.x, position.y, 255);
    }
    return costMatrix;
  };
}

function createSourceHarvestSlotCostCallback(room: Room): MoveToOpts["costCallback"] | undefined {
  const reservedSlots = getReservedSourceHarvestSlotsForRoom(room);
  if (reservedSlots.length === 0) {
    return undefined;
  }

  return (roomName, costMatrix) => {
    if (roomName !== room.name) {
      return costMatrix;
    }

    for (const position of reservedSlots) {
      costMatrix.set(position.x, position.y, 255);
    }
    return costMatrix;
  };
}

function getClosestRange(position: RoomPosition, targets: RoomObject[]): number {
  if (targets.length === 0) {
    return 0;
  }

  return Math.min(...targets.map((target) => position.getRangeTo(target)));
}

function isSpawn(target: RoomObject): target is StructureSpawn {
  return "structureType" in target && target.structureType === STRUCTURE_SPAWN;
}

function createRoomPosition(x: number, y: number, roomName: string): RoomPosition {
  return new RoomPosition(x, y, roomName);
}

function isRoomInterior(position: RoomPosition): boolean {
  return position.x > 0 && position.x < 49 && position.y > 0 && position.y < 49;
}

function isWalkable(room: Room, position: RoomPosition): boolean {
  return room.getTerrain().get(position.x, position.y) !== TERRAIN_MASK_WALL;
}

function hasCreep(position: RoomPosition): boolean {
  return position.lookFor(LOOK_CREEPS).length > 0;
}

function getPositionKey(position: RoomPosition): string {
  return `${position.roomName}:${position.x}:${position.y}`;
}

function getPositionSnapshotKey(position: RoomPositionSnapshot): string {
  return `${position.roomName}:${position.x}:${position.y}`;
}

function comparePositions(left: RoomPosition, right: RoomPosition): number {
  return left.y - right.y || left.x - right.x;
}

function isPositionReserved(context: PositionReservationContext | undefined, position: RoomPosition): boolean {
  return Boolean(context?.reservedPositions[getPositionKey(position)]);
}

function reservePosition(context: PositionReservationContext | undefined, position: RoomPosition): void {
  if (!context) {
    return;
  }

  context.reservedPositions[getPositionKey(position)] = true;
}
