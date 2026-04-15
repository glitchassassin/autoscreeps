type EnergyDeliveryTarget = StructureSpawn | Creep;
type EnergyPickupTarget = Resource<ResourceConstant>;
type EnergyWithdrawTarget = StructureSpawn;

export function findDeliveryTarget(creep: Creep): EnergyDeliveryTarget | null {
  const spawnTargets = Object.values(Game.spawns).filter(
    (spawn) => spawn.room.name === creep.room.name && getFreeEnergyCapacity(spawn) > 0
  );
  const nearestSpawn = findClosestByPath(creep, spawnTargets);
  if (nearestSpawn) {
    return nearestSpawn;
  }

  const upgraderTargets = Object.values(Game.creeps).filter(
    (other) => other.memory.role === "upgrader"
      && other.room.name === creep.room.name
      && other.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  );
  return findClosestByPath(creep, upgraderTargets);
}

export function findPickupTarget(creep: Creep): EnergyPickupTarget | null {
  const dropped = creep.room.find(FIND_DROPPED_RESOURCES).filter(
    (resource) => resource.resourceType === RESOURCE_ENERGY && resource.amount > 0
  );
  return findClosestByPath(creep, dropped);
}

export function findWithdrawTarget(creep: Creep): EnergyWithdrawTarget | null {
  const spawns = Object.values(Game.spawns).filter(
    (spawn) => spawn.room.name === creep.room.name && getStoredEnergy(spawn) > 0
  );
  return findClosestByPath(creep, spawns);
}

export function getStoredEnergy(target: { store?: StoreDefinition; energy?: number }): number {
  return target.store?.[RESOURCE_ENERGY] ?? target.energy ?? 0;
}

function getFreeEnergyCapacity(target: { store?: StoreDefinition; storeCapacityResource?: StoreDefinition; energy?: number; energyCapacity?: number }): number {
  if (typeof target.store?.getFreeCapacity === "function") {
    return target.store.getFreeCapacity(RESOURCE_ENERGY);
  }

  const capacity = target.storeCapacityResource?.[RESOURCE_ENERGY] ?? target.energyCapacity ?? 0;
  return capacity - getStoredEnergy(target);
}

function findClosestByPath<T extends RoomObject>(creep: Creep, targets: T[]): T | null {
  if (targets.length === 0) {
    return null;
  }

  return creep.pos.findClosestByPath(targets) ?? targets[0] ?? null;
}
