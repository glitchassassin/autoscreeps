import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldSnapshot } from "../src/core/types";
import { executeConstructionPlan } from "../src/execution/construction";
import { createConstructionPlan } from "../src/planning/construction-plan";
import { roomPlannerVersion } from "../src/planning/room-planning-runtime";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("construction planning", () => {
  beforeEach(() => {
    installScreepsGlobals();
    const testGlobal = globalThis as typeof globalThis & { Game: Game; Memory: Memory };
    testGlobal.Memory = {
      rooms: {
        W0N0: {
          planning: {
            version: roomPlannerVersion,
            policy: "normal",
            status: "complete",
            requestedAt: 1,
            updatedAt: 1,
            completedAt: 1,
            ticksSpent: 1,
            structures: [
              plannedStructure("extension", 10, 10, 2, "pod1-extension-01"),
              plannedStructure("extension", 11, 10, 2, "pod1-extension-02"),
              plannedStructure("extension", 12, 10, 2, "pod1-extension-03"),
              plannedStructure("road", 9, 10, 2, "road")
            ]
          }
        }
      }
    } as unknown as Memory;
    testGlobal.Game = {
      creeps: {},
      constructionSites: {},
      getObjectById: vi.fn(() => null),
      spawns: {},
      rooms: {},
      time: 1
    } as unknown as Game;
  });

  it("selects the first unlocked extension from fastfiller pod A before lower-priority structures", () => {
    const plan = createConstructionPlan(makeWorld());

    expect(plan).toMatchObject({
      activeSiteCount: 0,
      placeableSiteCount: 4,
      backlogCount: 4,
      extensionBacklogCount: 3,
      request: {
        roomName: "W0N0",
        x: 10,
        y: 10,
        structureType: STRUCTURE_EXTENSION,
        rcl: 2,
        label: "pod1-extension-01"
      }
    });
  });

  it("skips matching built structures and active construction-site tiles", () => {
    const plan = createConstructionPlan(makeWorld({
      primaryStructures: [
        {
          structureId: "extension-1",
          roomName: "W0N0",
          x: 10,
          y: 10,
          structureType: STRUCTURE_EXTENSION
        }
      ],
      primaryConstructionSites: [
        {
          siteId: "site-1",
          roomName: "W0N0",
          x: 11,
          y: 10,
          structureType: STRUCTURE_EXTENSION,
          progress: 0,
          progressTotal: 3000
        }
      ]
    }));

    expect(plan).toMatchObject({
      activeSiteCount: 1,
      placeableSiteCount: 2,
      backlogCount: 3,
      extensionBacklogCount: 2,
      request: null
    });
  });

  it("does not request a new planned site while one is active", () => {
    const plan = createConstructionPlan(makeWorld({
      primaryConstructionSites: [
        {
          siteId: "site-1",
          roomName: "W0N0",
          x: 20,
          y: 20,
          structureType: STRUCTURE_CONTAINER,
          progress: 0,
          progressTotal: 5000
        }
      ]
    }));

    expect(plan).toMatchObject({
      activeSiteCount: 1,
      placeableSiteCount: 4,
      backlogCount: 5,
      extensionBacklogCount: 3,
      request: null
    });
  });

  it("does not create planned sites without a complete room plan", () => {
    Memory.rooms!.W0N0!.planning!.status = "failed";

    const plan = createConstructionPlan(makeWorld());

    expect(plan).toMatchObject({
      activeSiteCount: 0,
      placeableSiteCount: 0,
      backlogCount: 0,
      extensionBacklogCount: 0,
      request: null
    });
  });

  it("places at most one planned construction site per tick", () => {
    const room = {
      name: "W0N0",
      controller: { my: true },
      createConstructionSite: vi.fn(() => OK)
    } as unknown as Room;
    (Game as unknown as { rooms: Record<string, Room> }).rooms = { W0N0: room };

    const result = executeConstructionPlan(createConstructionPlan(makeWorld()));

    expect(result).toBe(OK);
    expect(room.createConstructionSite).toHaveBeenCalledTimes(1);
    expect(room.createConstructionSite).toHaveBeenCalledWith(10, 10, STRUCTURE_EXTENSION);
  });
});

function plannedStructure(
  type: string,
  x: number,
  y: number,
  rcl: number,
  label: string
): NonNullable<RoomPlanningMemoryState["structures"]>[number] {
  return { type, x, y, rcl, label };
}

function makeWorld(input: Partial<Pick<WorldSnapshot, "primaryStructures" | "primaryConstructionSites">> = {}): WorldSnapshot {
  const primaryConstructionSites = input.primaryConstructionSites ?? [];
  return {
    gameTime: 1,
    primarySpawnName: "Spawn1",
    primarySpawnConstructionSiteCount: 0,
    primaryConstructionSiteCount: primaryConstructionSites.length,
    primarySpawnSpawning: false,
    primaryRoomName: "W0N0",
    primaryRoomEnergyAvailable: 300,
    primaryRoomEnergyCapacityAvailable: 300,
    primarySpawnToControllerPathLength: 10,
    primaryController: {
      level: 2,
      progress: 0,
      progressTotal: 45000
    },
    maxOwnedControllerLevel: 2,
    totalCreeps: 0,
    creepsByRole: {
      "recovery-worker": 0,
      builder: 0,
      harvester: 0,
      runner: 0,
      upgrader: 0
    },
    creeps: [],
    sources: [],
    primaryStructures: input.primaryStructures ?? [],
    primaryConstructionSites
  };
}
