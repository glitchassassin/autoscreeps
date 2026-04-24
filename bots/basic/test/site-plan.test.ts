import { describe, expect, it } from "vitest";
import { createCreepPlans, createSitePlans } from "../src/planning/site-plan";
import type { WorldSnapshot } from "../src/core/types";

describe("site planning", () => {
  it("balances harvesters across local sources and computes planned throughput", () => {
    const world = makeWorld({
      creeps: [
        makeCreepSnapshot("harvester-a", "harvester", 2),
        makeCreepSnapshot("harvester-b", "harvester", 2),
        makeCreepSnapshot("runner-a", "runner", 0)
      ]
    });

    const sites = createSitePlans(world);

    expect(sites).toEqual([
      {
        siteId: "source-1",
        sourceId: "source-1",
        roomName: "W0N0",
        theoreticalGrossEpt: 10,
        plannedGrossEpt: 4,
        assignedWorkParts: 2,
        assignedHarvesterNames: ["harvester-a"],
        harvesterSlots: makeHarvestSlots(5, 10, 3)
      },
      {
        siteId: "source-2",
        sourceId: "source-2",
        roomName: "W0N0",
        theoreticalGrossEpt: 10,
        plannedGrossEpt: 4,
        assignedWorkParts: 2,
        assignedHarvesterNames: ["harvester-b"],
        harvesterSlots: makeHarvestSlots(15, 10, 3)
      }
    ]);
  });

  it("creates planner assignments only for harvester source targets", () => {
    const world = makeWorld({
      creeps: [
        makeCreepSnapshot("harvester-a", "harvester", 2),
        makeCreepSnapshot("runner-a", "runner", 0),
        makeCreepSnapshot("upgrader-a", "upgrader", 1)
      ]
    });

    const sites = createSitePlans(world);

    expect(createCreepPlans(world, sites)).toEqual({
      "harvester-a": {
        creepName: "harvester-a",
        role: "harvester",
        sourceId: "source-1",
        sourceSlot: makeHarvestSlots(5, 10, 3)[0]
      },
      "runner-a": {
        creepName: "runner-a",
        role: "runner",
        sourceId: null,
        sourceSlot: null
      },
      "upgrader-a": {
        creepName: "upgrader-a",
        role: "upgrader",
        sourceId: null,
        sourceSlot: null
      }
    });
  });

  it("does not assign more harvesters than source access slots", () => {
    const world = makeWorld({
      sourceSlotCount: 1,
      creeps: [
        makeCreepSnapshot("harvester-a", "harvester", 2),
        makeCreepSnapshot("harvester-b", "harvester", 2),
        makeCreepSnapshot("harvester-c", "harvester", 2)
      ]
    });

    const sites = createSitePlans(world);

    expect(sites.map((site) => site.assignedHarvesterNames)).toEqual([
      ["harvester-a"],
      ["harvester-b"]
    ]);
    expect(createCreepPlans(world, sites)["harvester-c"]).toMatchObject({
      sourceId: null,
      sourceSlot: null
    });
  });
});

function makeWorld(input: { creeps: WorldSnapshot["creeps"]; sourceSlotCount?: number }): WorldSnapshot {
  const sourceSlotCount = input.sourceSlotCount ?? 3;

  return {
    gameTime: 1,
    primarySpawnName: "Spawn1",
    primarySpawnConstructionSiteCount: 0,
    primaryConstructionSiteCount: 0,
    primarySpawnSpawning: false,
    primaryRoomName: "W0N0",
    primaryRoomEnergyAvailable: 300,
    primaryRoomEnergyCapacityAvailable: 300,
    primarySpawnToControllerPathLength: 10,
    primaryController: {
      level: 1,
      progress: 0,
      progressTotal: 200
    },
    maxOwnedControllerLevel: 1,
    totalCreeps: input.creeps.length,
    creepsByRole: {
      "recovery-worker": input.creeps.filter((creep) => creep.role === "recovery-worker").length,
      builder: input.creeps.filter((creep) => creep.role === "builder").length,
      harvester: input.creeps.filter((creep) => creep.role === "harvester").length,
      runner: input.creeps.filter((creep) => creep.role === "runner").length,
      upgrader: input.creeps.filter((creep) => creep.role === "upgrader").length
    },
    creeps: input.creeps,
    sources: [
      {
        sourceId: "source-1",
        roomName: "W0N0",
        x: 5,
        y: 10,
        energy: 3000,
        energyCapacity: 3000,
        ticksToRegeneration: 300,
        pathLengthToPrimarySpawn: 5,
        harvestSlots: makeHarvestSlots(5, 10, sourceSlotCount)
      },
      {
        sourceId: "source-2",
        roomName: "W0N0",
        x: 15,
        y: 10,
        energy: 3000,
        energyCapacity: 3000,
        ticksToRegeneration: 300,
        pathLengthToPrimarySpawn: 5,
        harvestSlots: makeHarvestSlots(15, 10, sourceSlotCount)
      }
    ],
    primaryStructures: [],
    primaryConstructionSites: []
  };
}

function makeHarvestSlots(sourceX: number, sourceY: number, count: number): WorldSnapshot["sources"][number]["harvestSlots"] {
  return [
    { roomName: "W0N0", x: sourceX - 1, y: sourceY },
    { roomName: "W0N0", x: sourceX, y: sourceY - 1 },
    { roomName: "W0N0", x: sourceX + 1, y: sourceY }
  ].slice(0, count);
}

function makeCreepSnapshot(name: string, role: WorkerRole, activeWorkParts: number): WorldSnapshot["creeps"][number] {
  return {
    name,
    role,
    homeRoom: "W0N0",
    roomName: "W0N0",
    working: false,
    activeWorkParts,
    activeCarryParts: 0,
    storeEnergy: 0,
    freeCapacity: 50,
    bodyCost: 0
  };
}
