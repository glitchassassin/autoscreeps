import type { RoomSummary, RunRecord } from "./contracts.ts";
import type { RoomObjectRecord, RoomObjectsResponse } from "./screeps-api.ts";

export type WatchRoomStats = {
  room: string;
  owner: string | null;
  controllerLevel: number | null;
  controllerProgress: number | null;
  controllerProgressTotal: number | null;
  creeps: number | null;
  spawns: number | null;
  constructionSites: number | null;
  extensions: number | null;
  energy: number | null;
  energyCapacity: number | null;
  objects: number;
};

export function selectRunForWatch(runs: RunRecord[], pinnedRunId?: string): RunRecord | null {
  if (pinnedRunId) {
    return runs.find((run) => run.id === pinnedRunId) ?? null;
  }

  return [...runs].sort(compareRunsNewestFirst)[0] ?? null;
}

export function summarizeLiveRoom(room: string, response: RoomObjectsResponse): WatchRoomStats {
  const controller = response.objects.find((object) => object.type === "controller");
  const primaryUserId = findPrimaryUserId(response.objects, controller);
  const ownedObjects = primaryUserId === null
    ? []
    : response.objects.filter((object) => object.user === primaryUserId);

  let energy = 0;
  let energyCapacity = 0;

  for (const object of ownedObjects) {
    const storedEnergy = getEnergyFromStore(object.store);
    const storedCapacity = getEnergyFromStore(object.storeCapacityResource);

    if (storedEnergy !== null || storedCapacity !== null) {
      energy += storedEnergy ?? 0;
      energyCapacity += storedCapacity ?? 0;
      continue;
    }

    energy += getNumericProperty(object, "energy") ?? 0;
    energyCapacity += getNumericProperty(object, "energyCapacity") ?? 0;
  }

  return {
    room,
    owner: resolveOwnerName(controller, response.users),
    controllerLevel: getNumericProperty(controller, "level"),
    controllerProgress: getNumericProperty(controller, "progress"),
    controllerProgressTotal: getNumericProperty(controller, "progressTotal"),
    creeps: countOwnedObjects(ownedObjects, "creep"),
    spawns: countOwnedObjects(ownedObjects, "spawn"),
    constructionSites: countOwnedObjects(ownedObjects, "constructionSite"),
    extensions: countOwnedObjects(ownedObjects, "extension"),
    energy,
    energyCapacity,
    objects: response.objects.length
  };
}

export function summarizeRecordedRoom(summary: RoomSummary): WatchRoomStats {
  return {
    room: summary.room,
    owner: summary.controllerOwners[0] ?? summary.spawnOwners[0] ?? null,
    controllerLevel: null,
    controllerProgress: null,
    controllerProgressTotal: null,
    creeps: summary.typeCounts.creep ?? 0,
    spawns: summary.typeCounts.spawn ?? 0,
    constructionSites: summary.typeCounts.constructionSite ?? 0,
    extensions: summary.typeCounts.extension ?? 0,
    energy: null,
    energyCapacity: null,
    objects: summary.totalObjects
  };
}

function compareRunsNewestFirst(left: RunRecord, right: RunRecord): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id);
}

function findPrimaryUserId(objects: RoomObjectRecord[], controller: RoomObjectRecord | undefined): string | null {
  if (typeof controller?.user === "string") {
    return controller.user;
  }

  for (const object of objects) {
    if (typeof object.user === "string" && (object.type === "spawn" || object.type === "creep" || object.type === "extension")) {
      return object.user;
    }
  }

  return null;
}

function resolveOwnerName(
  controller: RoomObjectRecord | undefined,
  users: RoomObjectsResponse["users"]
): string | null {
  if (typeof controller?.user === "string") {
    return users[controller.user]?.username ?? controller.user;
  }

  const reservation = controller?.reservation;
  if (isObjectRecord(reservation) && typeof reservation.user === "string") {
    const username = users[reservation.user]?.username ?? reservation.user;
    return `${username} (reserved)`;
  }

  return null;
}

function countOwnedObjects(objects: RoomObjectRecord[], type: string): number {
  return objects.filter((object) => object.type === type).length;
}

function getNumericProperty(record: RoomObjectRecord | undefined, key: string): number | null {
  if (!record) {
    return null;
  }

  const value = record[key];
  return typeof value === "number" ? value : null;
}

function getEnergyFromStore(store: RoomObjectRecord["store"]): number | null {
  if (!isObjectRecord(store)) {
    return null;
  }

  const value = store.energy;
  return typeof value === "number" ? value : null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
