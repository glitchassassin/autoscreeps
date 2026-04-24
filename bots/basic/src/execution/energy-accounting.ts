import { countActiveBodyParts } from "../core/body-parts";
import { getStoredEnergy } from "./roles/energy";

const harvestPowerPerWork = 2;
const buildPowerPerWork = 5;
const upgradePowerPerWork = 1;

type TickEnergyReservations = {
  gameTime: number;
  sourceEnergy: Record<string, number>;
  resourceAmount: Record<string, number>;
  storedEnergy: Record<string, number>;
  freeCapacity: Record<string, number>;
  siteProgressRemaining: Record<string, number>;
  controllerProgressRemaining: Record<string, number>;
  reservedPositions: Record<string, true>;
};

export type EnergyAccountingContext = TickEnergyReservations;
type EnergyAmountReservationField = keyof Omit<TickEnergyReservations, "gameTime" | "reservedPositions">;

type ReservationTarget = {
  id?: unknown;
  name?: unknown;
  pos?: RoomPosition;
};

type StoredEnergyTarget = ReservationTarget & {
  store?: StoreDefinition;
  energy?: number;
};

type EnergyCapacityTarget = StoredEnergyTarget & {
  storeCapacityResource?: StoreDefinition;
  energyCapacity?: number;
};

export function createEnergyAccountingContext(gameTime = typeof Game === "undefined" ? -1 : Game.time): EnergyAccountingContext {
  return {
    gameTime,
    sourceEnergy: {},
    resourceAmount: {},
    storedEnergy: {},
    freeCapacity: {},
    siteProgressRemaining: {},
    controllerProgressRemaining: {},
    reservedPositions: {}
  };
}

export function calculateHarvestedEnergy(context: EnergyAccountingContext, creep: Creep, source: Source): number {
  return Math.min(countActiveBodyParts(creep, WORK) * harvestPowerPerWork, getRemaining(context, source, "sourceEnergy", source.energy));
}

export function reserveHarvestedEnergy(context: EnergyAccountingContext, source: Source, amount: number): void {
  reserve(context, source, "sourceEnergy", source.energy, amount);
}

export function calculateDroppedHarvestEnergy(creep: Creep, harvestedEnergy: number): number {
  return Math.max(0, harvestedEnergy - getFreeEnergyCapacity(creep));
}

export function calculatePickupEnergy(context: EnergyAccountingContext, creep: Creep, resource: Resource<ResourceConstant>): number {
  if (resource.resourceType !== RESOURCE_ENERGY) {
    return 0;
  }

  return Math.min(getRemaining(context, resource, "resourceAmount", resource.amount), getFreeEnergyCapacity(creep));
}

export function reservePickupEnergy(context: EnergyAccountingContext, resource: Resource<ResourceConstant>, amount: number): void {
  reserve(context, resource, "resourceAmount", resource.amount, amount);
}

export function calculateWithdrawEnergy(context: EnergyAccountingContext, creep: Creep, target: StoredEnergyTarget): number {
  return Math.min(getRemaining(context, target, "storedEnergy", getStoredEnergy(target)), getFreeEnergyCapacity(creep));
}

export function reserveWithdrawEnergy(context: EnergyAccountingContext, target: StoredEnergyTarget, amount: number): void {
  reserve(context, target, "storedEnergy", getStoredEnergy(target), amount);
}

export function calculateTransferEnergy(
  context: EnergyAccountingContext,
  creep: Creep,
  target: EnergyCapacityTarget
): number {
  return Math.min(getStoredEnergy(creep), getRemaining(context, target, "freeCapacity", getFreeEnergyCapacity(target)));
}

export function reserveTransferEnergy(context: EnergyAccountingContext, target: EnergyCapacityTarget, amount: number): void {
  reserve(context, target, "freeCapacity", getFreeEnergyCapacity(target), amount);
}

export function calculateBuildEnergy(context: EnergyAccountingContext, creep: Creep, site: ConstructionSite): number {
  return Math.min(
    countActiveBodyParts(creep, WORK) * buildPowerPerWork,
    getStoredEnergy(creep),
    getRemaining(context, site, "siteProgressRemaining", getSiteProgressRemaining(site))
  );
}

export function reserveBuildEnergy(context: EnergyAccountingContext, site: ConstructionSite, amount: number): void {
  reserve(context, site, "siteProgressRemaining", getSiteProgressRemaining(site), amount);
}

export function calculateUpgradeEnergy(context: EnergyAccountingContext, creep: Creep, controller: StructureController): number {
  const progressRemaining = typeof controller.progress === "number" && typeof controller.progressTotal === "number"
    ? Math.max(0, controller.progressTotal - controller.progress)
    : Number.POSITIVE_INFINITY;
  const controllerLimit = controller.level >= 8 ? 15 : Number.POSITIVE_INFINITY;
  const controllerProgressAvailable = Math.min(progressRemaining, controllerLimit);

  return Math.min(
    countActiveBodyParts(creep, WORK) * upgradePowerPerWork,
    getStoredEnergy(creep),
    getRemaining(context, controller, "controllerProgressRemaining", controllerProgressAvailable)
  );
}

export function reserveUpgradeEnergy(context: EnergyAccountingContext, controller: StructureController, amount: number): void {
  const progressRemaining = typeof controller.progress === "number" && typeof controller.progressTotal === "number"
    ? Math.max(0, controller.progressTotal - controller.progress)
    : Number.POSITIVE_INFINITY;
  const controllerLimit = controller.level >= 8 ? 15 : Number.POSITIVE_INFINITY;
  reserve(context, controller, "controllerProgressRemaining", Math.min(progressRemaining, controllerLimit), amount);
}

function getFreeEnergyCapacity(target: EnergyCapacityTarget): number {
  if (typeof target.store?.getFreeCapacity === "function") {
    return target.store.getFreeCapacity(RESOURCE_ENERGY);
  }

  const capacity = target.storeCapacityResource?.[RESOURCE_ENERGY] ?? target.energyCapacity ?? 0;
  return Math.max(0, capacity - getStoredEnergy(target));
}

function getSiteProgressRemaining(site: ConstructionSite): number {
  return Math.max(0, site.progressTotal - site.progress);
}

function getRemaining(
  context: EnergyAccountingContext,
  target: ReservationTarget,
  field: EnergyAmountReservationField,
  initialAmount: number
): number {
  const key = getReservationKey(target);
  context[field][key] ??= initialAmount;
  return context[field][key];
}

function reserve(
  context: EnergyAccountingContext,
  target: ReservationTarget,
  field: EnergyAmountReservationField,
  initialAmount: number,
  amount: number
): void {
  if (amount <= 0) {
    return;
  }

  const key = getReservationKey(target);
  context[field][key] = Math.max(0, (context[field][key] ?? initialAmount) - amount);
}

function getReservationKey(target: ReservationTarget): string {
  if (typeof target.id === "string") {
    return target.id;
  }
  if (typeof target.name === "string") {
    return target.name;
  }
  if (target.pos) {
    return `${target.pos.roomName}:${target.pos.x}:${target.pos.y}`;
  }

  return "unknown";
}
