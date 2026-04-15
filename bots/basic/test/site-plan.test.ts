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
        assignedHarvesterNames: ["harvester-a"]
      },
      {
        siteId: "source-2",
        sourceId: "source-2",
        roomName: "W0N0",
        theoreticalGrossEpt: 10,
        plannedGrossEpt: 4,
        assignedWorkParts: 2,
        assignedHarvesterNames: ["harvester-b"]
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
        sourceId: "source-1"
      },
      "runner-a": {
        creepName: "runner-a",
        role: "runner",
        sourceId: null
      },
      "upgrader-a": {
        creepName: "upgrader-a",
        role: "upgrader",
        sourceId: null
      }
    });
  });
});

function makeWorld(input: { creeps: WorldSnapshot["creeps"] }): WorldSnapshot {
  return {
    gameTime: 1,
    primarySpawnName: "Spawn1",
    primarySpawnConstructionSiteCount: 0,
    primarySpawnSpawning: false,
    primaryRoomName: "W0N0",
    primaryRoomEnergyAvailable: 300,
    primaryRoomEnergyCapacityAvailable: 300,
    primaryController: {
      level: 1,
      progress: 0,
      progressTotal: 200
    },
    maxOwnedControllerLevel: 1,
    totalCreeps: input.creeps.length,
    creepsByRole: {
      "recovery-worker": input.creeps.filter((creep) => creep.role === "recovery-worker").length,
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
        ticksToRegeneration: 300
      },
      {
        sourceId: "source-2",
        roomName: "W0N0",
        x: 15,
        y: 10,
        energy: 3000,
        energyCapacity: 3000,
        ticksToRegeneration: 300
      }
    ]
  };
}

function makeCreepSnapshot(name: string, role: WorkerRole, activeWorkParts: number): WorldSnapshot["creeps"][number] {
  return {
    name,
    role,
    homeRoom: "W0N0",
    roomName: "W0N0",
    working: false,
    activeWorkParts,
    storeEnergy: 0,
    freeCapacity: 50
  };
}
