import { describe, expect, it } from "vitest";
import { buildTelemetryByRole, inspectBotTelemetry, inspectTelemetryByRole, parseBotTelemetry } from "../src/lib/bot-telemetry.ts";

describe("bot telemetry", () => {
  it("parses a valid telemetry payload", () => {
    const raw = JSON.stringify({
      schemaVersion: 11,
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
      admissions: {
        firstCourier3: {
          gameTime: 700,
          sourceBacklog: 601,
          loadedCouriers: 1,
          roleCounts: { harvester: 2, courier: 2, worker: 3 },
          openReasons: ["source_backlog"],
          spawnWaitingWithSourceBacklogTicks: 518,
          sourceDropToBankLatencyAvg: 221.67,
          withinCourier3Window: true,
          courier3PriorityActive: true
        },
        firstWorker4: {
          gameTime: 775,
          sourceBacklog: 560,
          loadedCouriers: 1,
          roleCounts: { harvester: 2, courier: 3, worker: 3 },
          openReasons: ["source_backlog", "courier_parity"],
          spawnWaitingWithSourceBacklogTicks: 518,
          sourceDropToBankLatencyAvg: 229.73,
          withinCourier3Window: true,
          courier3PriorityActive: true
        }
      },
      sources: {
        total: 2,
        staffed: 1,
        assignments: { sourceA: 1 },
        harvestingStaffed: 1,
        harvestingAssignments: { sourceA: 1 },
        harvestedEnergy: 42,
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
        pickupToSpendLatencySamples: 1,
        pickupToBankLatencyTotal: 6,
        pickupToBankLatencySamples: 1,
        sourceDropToBankLatencyTotal: 9,
        sourceDropToBankLatencySamples: 1,
        spawnObservedTicks: 25,
        spawnIdleTicks: 5,
        spawnSpawningTicks: 10,
        spawnWaitingForSufficientEnergyTicks: 10,
        bankLowObservedTicks: 7,
        bankReserveBreachCount: 2,
        bankReserveRecoveryLatencyTotal: 11,
        bankReserveRecoveryLatencySamples: 2,
        spawnWaitingWithLoadedCourierTicks: 4,
        spawnWaitingWithSpawnAdjacentLoadedCourierTicks: 3,
        spawnBlockedDespiteAdjacentCourierClosingDeficitTicks: 1,
        queueHeadReserveCourierTicks: 12,
        queueHeadReserveHeldEnergyTotal: 1800,
        spawnWaitingWithWorkerEnergyTicks: 5,
        spawnWaitingWithSourceBacklogTicks: 6,
        loadedCourierIdleWhileBankLowTicks: 2,
        extraWorkerGateBlockedTicks: 1,
        extraWorkerGateOpenReasonCounts: { source_backlog: 2 },
        bankLowDeliveredEnergyByTargetType: { worker_handoff: 10 },
        sourceObservedTicks: 25,
        sourceTotalTicks: 50,
        sourceStaffedTicks: 30,
        sourceFullyStaffedTicks: 8,
        harvestingSourceStaffedTicks: 20,
        harvestingSourceFullyStaffedTicks: 4,
        activeHarvestingSourceStaffedTicks: 12,
        activeHarvestingSourceFullyStaffedTicks: 2
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
    const parsed = parseBotTelemetry(raw);
    const inspection = inspectBotTelemetry(raw);

    expect(parsed).toEqual({
      schemaVersion: 11,
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
      admissions: {
        firstCourier3: {
          gameTime: 700,
          sourceBacklog: 601,
          loadedCouriers: 1,
          roleCounts: { harvester: 2, courier: 2, worker: 3 },
          openReasons: ["source_backlog"],
          spawnWaitingWithSourceBacklogTicks: 518,
          sourceDropToBankLatencyAvg: 221.67,
          withinCourier3Window: true,
          courier3PriorityActive: true
        },
        firstWorker4: {
          gameTime: 775,
          sourceBacklog: 560,
          loadedCouriers: 1,
          roleCounts: { harvester: 2, courier: 3, worker: 3 },
          openReasons: ["source_backlog", "courier_parity"],
          spawnWaitingWithSourceBacklogTicks: 518,
          sourceDropToBankLatencyAvg: 229.73,
          withinCourier3Window: true,
          courier3PriorityActive: true
        }
      },
      sources: {
        total: 2,
        staffed: 1,
        assignments: { sourceA: 1 },
        harvestingStaffed: 1,
        harvestingAssignments: { sourceA: 1 },
        harvestedEnergy: 42,
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
        pickupToSpendLatencySamples: 1,
        pickupToBankLatencyTotal: 6,
        pickupToBankLatencySamples: 1,
        sourceDropToBankLatencyTotal: 9,
        sourceDropToBankLatencySamples: 1,
        spawnObservedTicks: 25,
        spawnIdleTicks: 5,
        spawnSpawningTicks: 10,
        spawnWaitingForSufficientEnergyTicks: 10,
        bankLowObservedTicks: 7,
        bankReserveBreachCount: 2,
        bankReserveRecoveryLatencyTotal: 11,
        bankReserveRecoveryLatencySamples: 2,
        spawnWaitingWithLoadedCourierTicks: 4,
        spawnWaitingWithSpawnAdjacentLoadedCourierTicks: 3,
        spawnBlockedDespiteAdjacentCourierClosingDeficitTicks: 1,
        queueHeadReserveCourierTicks: 12,
        queueHeadReserveHeldEnergyTotal: 1800,
        spawnWaitingWithWorkerEnergyTicks: 5,
        spawnWaitingWithSourceBacklogTicks: 6,
        loadedCourierIdleWhileBankLowTicks: 2,
        extraWorkerGateBlockedTicks: 1,
        extraWorkerGateOpenReasonCounts: { source_backlog: 2 },
        bankLowDeliveredEnergyByTargetType: { worker_handoff: 10 },
        sourceObservedTicks: 25,
        sourceTotalTicks: 50,
        sourceStaffedTicks: 30,
        sourceFullyStaffedTicks: 8,
        harvestingSourceStaffedTicks: 20,
        harvestingSourceFullyStaffedTicks: 4,
        activeHarvestingSourceStaffedTicks: 12,
        activeHarvestingSourceFullyStaffedTicks: 2
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
    expect(inspection).toMatchObject({
      health: {
        status: "ok",
        message: null
      }
    });
  });

  it("classifies malformed and missing telemetry health", () => {
    expect(parseBotTelemetry("{bad json")).toBeNull();
    expect(parseBotTelemetry(JSON.stringify({ schemaVersion: "1", gameTime: 25 }))).toBeNull();
    expect(inspectBotTelemetry("{bad json")).toMatchObject({
      snapshot: null,
      health: {
        status: "parse_error"
      }
    });
    expect(inspectBotTelemetry(null)).toEqual({
      snapshot: null,
      health: {
        status: "missing",
        message: null
      }
    });
  });

  it("surfaces runtime telemetry errors without discarding the snapshot", () => {
    const inspection = inspectBotTelemetry(JSON.stringify({
      schemaVersion: 5,
      gameTime: 250,
      debugError: "RangeError: boom"
    }));

    expect(inspection).toEqual({
      snapshot: {
        schemaVersion: 5,
        gameTime: 250,
        debugError: "RangeError: boom"
      },
      health: {
        status: "runtime_error",
        message: "RangeError: boom"
      }
    });
  });

  it("builds telemetry and health maps by role", () => {
    expect(buildTelemetryByRole({
      baseline: JSON.stringify({ schemaVersion: 1, gameTime: 25 }),
      candidate: null
    })).toEqual({
      baseline: { schemaVersion: 1, gameTime: 25 },
      candidate: null
    });

    expect(inspectTelemetryByRole({
      baseline: JSON.stringify({ schemaVersion: 1, gameTime: 25 }),
      candidate: null
    })).toEqual({
      baseline: {
        snapshot: { schemaVersion: 1, gameTime: 25 },
        health: {
          status: "ok",
          message: null
        }
      },
      candidate: {
        snapshot: null,
        health: {
          status: "missing",
          message: null
        }
      }
    });
  });
});
