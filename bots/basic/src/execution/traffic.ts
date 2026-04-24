const spawnDeliveryPadCount = 2;

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

function comparePositions(left: RoomPosition, right: RoomPosition): number {
  return left.y - right.y || left.x - right.x;
}
