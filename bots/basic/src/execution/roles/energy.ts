export type EnergyDeliveryTarget = StructureSpawn | StructureExtension;
export type EnergyPickupTarget = Resource<ResourceConstant>;
type EnergyWithdrawTarget = StructureSpawn;

export function findDeliveryTarget(creep: Creep): EnergyDeliveryTarget | null {
  const spawnTargets: EnergyDeliveryTarget[] = Object.values(Game.spawns).filter(
    (spawn) => spawn.room.name === creep.room.name && getFreeEnergyCapacity(spawn) > 0
  );
  const extensionTargets = creep.room.find(FIND_MY_STRUCTURES).filter(
    (structure): structure is StructureExtension =>
      structure.structureType === STRUCTURE_EXTENSION && getFreeEnergyCapacity(structure) > 0
  );
  return findClosestByPath(creep, [...spawnTargets, ...extensionTargets]);
}

export function findPickupTarget(creep: Creep): EnergyPickupTarget | null {
  return findClosestByPath(creep, findPickupTargets(creep));
}

export function findPickupTargets(creep: Creep): EnergyPickupTarget[] {
  return creep.room.find(FIND_DROPPED_RESOURCES).filter(
    (resource) => resource.resourceType === RESOURCE_ENERGY && resource.amount > 0
  );
}

export function findWithdrawTarget(creep: Creep): EnergyWithdrawTarget | null {
  const spawns = Object.values(Game.spawns).filter((spawn) => spawn.room.name === creep.room.name);
  return findClosestByPath(creep, spawns);
}

export function canWithdrawEnergy(target: EnergyWithdrawTarget): boolean {
  return getStoredEnergy(target) > 0 && getFreeEnergyCapacity(target) === 0;
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
