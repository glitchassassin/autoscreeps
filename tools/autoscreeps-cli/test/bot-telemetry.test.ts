import { describe, expect, it } from "vitest";
import { buildTelemetryByRole, parseBotTelemetry } from "../src/lib/bot-telemetry.ts";

describe("bot telemetry", () => {
  it("parses a valid telemetry payload", () => {
    const parsed = parseBotTelemetry(JSON.stringify({
      schemaVersion: 5,
      gameTime: 250,
      colonyMode: "normal",
      totalCreeps: 4,
      roleCounts: { harvester: 2, upgrader: 2 },
      spawn: {
        queueDepth: 1,
        isSpawning: false,
        nextRole: "harvester",
        unmetDemand: { harvester: 1, upgrader: 0 }
      },
      sources: {
        total: 2,
        staffed: 1,
        assignments: { sourceA: 1 },
        harvestingStaffed: 1,
        harvestingAssignments: { sourceA: 1 },
        activeHarvestingStaffed: 1,
        activeHarvestingAssignments: { sourceA: 1 },
        adjacentHarvesters: { sourceA: 1 },
        successfulHarvestTicks: { sourceA: 25 },
        dropEnergy: { sourceA: 50 },
        oldestDropAge: { sourceA: 10 },
        overAssigned: { sourceA: 0 },
        backlogEnergy: 50
      },
      loop: {
        phaseTicks: { "harvester.gathering": 10 },
        actionAttempts: { "harvester.harvest": 10 },
        actionSuccesses: { "harvester.harvest": 8 },
        actionFailures: { "harvester.harvest.-9": 2 },
        targetFailures: { "harvester.no_source": 1 },
        workingStateFlips: { "harvester.gather_to_work": 2 },
        cargoUtilizationTicks: { harvester: 3 },
        noTargetTicks: { harvester: 1 },
        withEnergyNoSpendTicks: { upgrader: 2 },
        noEnergyAvailableTicks: { upgrader: 1 },
        sourceAssignmentTicks: { harvester: 10 },
        sourceAdjacencyTicks: { harvester: 8 },
        samePositionTicks: { harvester: 4 },
        energyGained: { harvester: 32 },
        energySpent: { upgrader: 10 },
        energySpentOnBuild: 5,
        energySpentOnUpgrade: 5,
        deliveredEnergyByTargetType: { spawn: 20 },
        transferSuccessByTargetType: { spawn: 2 },
        workerTaskSelections: { build: 1 },
        sourceDropPickupLatencyTotal: 15,
        sourceDropPickupLatencySamples: 1,
        pickupToSpendLatencyTotal: 8,
        pickupToSpendLatencySamples: 1
      },
      creeps: {
        harvesterA: {
          role: "harvester",
          ticksSinceSuccess: 3,
          lastSuccessfulAction: "harvest",
          samePositionTicks: 1,
          targetSwitches: 2,
          lastTarget: "sourceA"
        }
      },
      milestones: { rcl2Tick: 125 },
      counters: { creepDeaths: 3 }
    }));

    expect(parsed).toEqual({
      schemaVersion: 5,
      gameTime: 250,
      colonyMode: "normal",
      totalCreeps: 4,
      roleCounts: { harvester: 2, upgrader: 2 },
      spawn: {
        queueDepth: 1,
        isSpawning: false,
        nextRole: "harvester",
        unmetDemand: { harvester: 1, upgrader: 0 }
      },
      sources: {
        total: 2,
        staffed: 1,
        assignments: { sourceA: 1 },
        harvestingStaffed: 1,
        harvestingAssignments: { sourceA: 1 },
        activeHarvestingStaffed: 1,
        activeHarvestingAssignments: { sourceA: 1 },
        adjacentHarvesters: { sourceA: 1 },
        successfulHarvestTicks: { sourceA: 25 },
        dropEnergy: { sourceA: 50 },
        oldestDropAge: { sourceA: 10 },
        overAssigned: { sourceA: 0 },
        backlogEnergy: 50
      },
      loop: {
        phaseTicks: { "harvester.gathering": 10 },
        actionAttempts: { "harvester.harvest": 10 },
        actionSuccesses: { "harvester.harvest": 8 },
        actionFailures: { "harvester.harvest.-9": 2 },
        targetFailures: { "harvester.no_source": 1 },
        workingStateFlips: { "harvester.gather_to_work": 2 },
        cargoUtilizationTicks: { harvester: 3 },
        noTargetTicks: { harvester: 1 },
        withEnergyNoSpendTicks: { upgrader: 2 },
        noEnergyAvailableTicks: { upgrader: 1 },
        sourceAssignmentTicks: { harvester: 10 },
        sourceAdjacencyTicks: { harvester: 8 },
        samePositionTicks: { harvester: 4 },
        energyGained: { harvester: 32 },
        energySpent: { upgrader: 10 },
        energySpentOnBuild: 5,
        energySpentOnUpgrade: 5,
        deliveredEnergyByTargetType: { spawn: 20 },
        transferSuccessByTargetType: { spawn: 2 },
        workerTaskSelections: { build: 1 },
        sourceDropPickupLatencyTotal: 15,
        sourceDropPickupLatencySamples: 1,
        pickupToSpendLatencyTotal: 8,
        pickupToSpendLatencySamples: 1
      },
      creeps: {
        harvesterA: {
          role: "harvester",
          ticksSinceSuccess: 3,
          lastSuccessfulAction: "harvest",
          samePositionTicks: 1,
          targetSwitches: 2,
          lastTarget: "sourceA"
        }
      },
      milestones: { rcl2Tick: 125 },
      counters: { creepDeaths: 3 }
    });
  });

  it("returns null for malformed telemetry and builds role maps", () => {
    expect(parseBotTelemetry("{bad json")).toBeNull();
    expect(parseBotTelemetry(JSON.stringify({ schemaVersion: "1", gameTime: 25 }))).toBeNull();

    expect(buildTelemetryByRole({
      baseline: JSON.stringify({ schemaVersion: 1, gameTime: 25 }),
      candidate: null
    })).toEqual({
      baseline: { schemaVersion: 1, gameTime: 25 },
      candidate: null
    });
  });
});
