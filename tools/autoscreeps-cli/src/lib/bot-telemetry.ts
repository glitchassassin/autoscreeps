import type { BotTelemetrySnapshot, TelemetryHealth, VariantRole } from "./contracts.ts";

export const autoscreepsTelemetrySegmentId = 42;

export type BotTelemetryInspection = {
  snapshot: BotTelemetrySnapshot | null;
  health: TelemetryHealth;
};

export function parseBotTelemetry(value: string | null): BotTelemetrySnapshot | null {
  return inspectBotTelemetry(value).snapshot;
}

export function inspectBotTelemetry(value: string | null): BotTelemetryInspection {
  if (!value) {
    return {
      snapshot: null,
      health: {
        status: "missing",
        message: null
      }
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    return {
      snapshot: null,
      health: {
        status: "parse_error",
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }

  if (!isRecord(parsed)) {
    return {
      snapshot: null,
      health: {
        status: "parse_error",
        message: "Telemetry payload must be a JSON object."
      }
    };
  }

  const schemaVersion = parsed.schemaVersion;
  const gameTime = parsed.gameTime;
  if (typeof schemaVersion !== "number" || typeof gameTime !== "number") {
    return {
      snapshot: null,
      health: {
        status: "parse_error",
        message: "Telemetry payload is missing required numeric schemaVersion/gameTime fields."
      }
    };
  }

  const snapshot: BotTelemetrySnapshot = {
    schemaVersion,
    gameTime
  };

  if (typeof parsed.debugError === "string" || parsed.debugError === null) {
    snapshot.debugError = parsed.debugError as string | null;
  }

  if (typeof parsed.colonyMode === "string") {
    snapshot.colonyMode = parsed.colonyMode;
  }
  if (typeof parsed.totalCreeps === "number") {
    snapshot.totalCreeps = parsed.totalCreeps;
  }
  if (isNumberRecord(parsed.roleCounts)) {
    snapshot.roleCounts = parsed.roleCounts;
  }
  if (isRecord(parsed.spawn) && isNumberRecord(parsed.spawn.unmetDemand)) {
    snapshot.spawn = {
      queueDepth: typeof parsed.spawn.queueDepth === "number" ? parsed.spawn.queueDepth : 0,
      isSpawning: typeof parsed.spawn.isSpawning === "boolean" ? parsed.spawn.isSpawning : false,
      nextRole: typeof parsed.spawn.nextRole === "string" ? parsed.spawn.nextRole : null,
      unmetDemand: parsed.spawn.unmetDemand
    };
  }
  if (isRecord(parsed.admissions)) {
    snapshot.admissions = {
      firstCourier3: parseSpawnAdmission(parsed.admissions.firstCourier3),
      firstWorker4: parseSpawnAdmission(parsed.admissions.firstWorker4)
    };
  }
  if (isRecord(parsed.sources) && isNumberRecord(parsed.sources.assignments)) {
    snapshot.sources = {
      total: typeof parsed.sources.total === "number" ? parsed.sources.total : 0,
      staffed: typeof parsed.sources.staffed === "number" ? parsed.sources.staffed : 0,
      assignments: parsed.sources.assignments,
      harvestingStaffed: typeof parsed.sources.harvestingStaffed === "number" ? parsed.sources.harvestingStaffed : 0,
      harvestingAssignments: isNumberRecord(parsed.sources.harvestingAssignments) ? parsed.sources.harvestingAssignments : {},
      harvestedEnergy: typeof parsed.sources.harvestedEnergy === "number" ? parsed.sources.harvestedEnergy : undefined,
      activeHarvestingStaffed: typeof parsed.sources.activeHarvestingStaffed === "number" ? parsed.sources.activeHarvestingStaffed : undefined,
      activeHarvestingAssignments: isNumberRecord(parsed.sources.activeHarvestingAssignments)
        ? parsed.sources.activeHarvestingAssignments
        : undefined,
      adjacentHarvesters: isNumberRecord(parsed.sources.adjacentHarvesters) ? parsed.sources.adjacentHarvesters : undefined,
      successfulHarvestTicks: isNumberRecord(parsed.sources.successfulHarvestTicks) ? parsed.sources.successfulHarvestTicks : undefined,
      dropEnergy: isNumberRecord(parsed.sources.dropEnergy) ? parsed.sources.dropEnergy : undefined,
      oldestDropAge: isNumberRecord(parsed.sources.oldestDropAge) ? parsed.sources.oldestDropAge : undefined,
      overAssigned: isNumberRecord(parsed.sources.overAssigned) ? parsed.sources.overAssigned : undefined,
      backlogEnergy: typeof parsed.sources.backlogEnergy === "number" ? parsed.sources.backlogEnergy : undefined
    };
  }
  if (isRecord(parsed.loop)) {
    snapshot.loop = {
      phaseTicks: isNumberRecord(parsed.loop.phaseTicks) ? parsed.loop.phaseTicks : undefined,
      actionAttempts: isNumberRecord(parsed.loop.actionAttempts) ? parsed.loop.actionAttempts : undefined,
      actionSuccesses: isNumberRecord(parsed.loop.actionSuccesses) ? parsed.loop.actionSuccesses : undefined,
      actionFailures: isNumberRecord(parsed.loop.actionFailures) ? parsed.loop.actionFailures : undefined,
      targetFailures: isNumberRecord(parsed.loop.targetFailures) ? parsed.loop.targetFailures : undefined,
      workingStateFlips: isNumberRecord(parsed.loop.workingStateFlips) ? parsed.loop.workingStateFlips : undefined,
      cargoUtilizationTicks: isNumberRecord(parsed.loop.cargoUtilizationTicks) ? parsed.loop.cargoUtilizationTicks : undefined,
      noTargetTicks: isNumberRecord(parsed.loop.noTargetTicks) ? parsed.loop.noTargetTicks : undefined,
      withEnergyNoSpendTicks: isNumberRecord(parsed.loop.withEnergyNoSpendTicks) ? parsed.loop.withEnergyNoSpendTicks : undefined,
      noEnergyAvailableTicks: isNumberRecord(parsed.loop.noEnergyAvailableTicks) ? parsed.loop.noEnergyAvailableTicks : undefined,
      sourceAssignmentTicks: isNumberRecord(parsed.loop.sourceAssignmentTicks) ? parsed.loop.sourceAssignmentTicks : undefined,
      sourceAdjacencyTicks: isNumberRecord(parsed.loop.sourceAdjacencyTicks) ? parsed.loop.sourceAdjacencyTicks : undefined,
      samePositionTicks: isNumberRecord(parsed.loop.samePositionTicks) ? parsed.loop.samePositionTicks : undefined,
      energyGained: isNumberRecord(parsed.loop.energyGained) ? parsed.loop.energyGained : undefined,
      energySpent: isNumberRecord(parsed.loop.energySpent) ? parsed.loop.energySpent : undefined,
      energySpentOnBuild: typeof parsed.loop.energySpentOnBuild === "number" ? parsed.loop.energySpentOnBuild : undefined,
      energySpentOnUpgrade: typeof parsed.loop.energySpentOnUpgrade === "number" ? parsed.loop.energySpentOnUpgrade : undefined,
      deliveredEnergyByTargetType: isNumberRecord(parsed.loop.deliveredEnergyByTargetType) ? parsed.loop.deliveredEnergyByTargetType : undefined,
      transferSuccessByTargetType: isNumberRecord(parsed.loop.transferSuccessByTargetType) ? parsed.loop.transferSuccessByTargetType : undefined,
      workerTaskSelections: isNumberRecord(parsed.loop.workerTaskSelections) ? parsed.loop.workerTaskSelections : undefined,
      sourceDropPickupLatencyTotal: typeof parsed.loop.sourceDropPickupLatencyTotal === "number" ? parsed.loop.sourceDropPickupLatencyTotal : undefined,
      sourceDropPickupLatencySamples: typeof parsed.loop.sourceDropPickupLatencySamples === "number" ? parsed.loop.sourceDropPickupLatencySamples : undefined,
      pickupToSpendLatencyTotal: typeof parsed.loop.pickupToSpendLatencyTotal === "number" ? parsed.loop.pickupToSpendLatencyTotal : undefined,
      pickupToSpendLatencySamples: typeof parsed.loop.pickupToSpendLatencySamples === "number" ? parsed.loop.pickupToSpendLatencySamples : undefined,
      pickupToBankLatencyTotal: typeof parsed.loop.pickupToBankLatencyTotal === "number" ? parsed.loop.pickupToBankLatencyTotal : undefined,
      pickupToBankLatencySamples: typeof parsed.loop.pickupToBankLatencySamples === "number" ? parsed.loop.pickupToBankLatencySamples : undefined,
      sourceDropToBankLatencyTotal: typeof parsed.loop.sourceDropToBankLatencyTotal === "number" ? parsed.loop.sourceDropToBankLatencyTotal : undefined,
      sourceDropToBankLatencySamples: typeof parsed.loop.sourceDropToBankLatencySamples === "number" ? parsed.loop.sourceDropToBankLatencySamples : undefined,
      spawnObservedTicks: typeof parsed.loop.spawnObservedTicks === "number" ? parsed.loop.spawnObservedTicks : undefined,
      spawnIdleTicks: typeof parsed.loop.spawnIdleTicks === "number" ? parsed.loop.spawnIdleTicks : undefined,
      spawnSpawningTicks: typeof parsed.loop.spawnSpawningTicks === "number" ? parsed.loop.spawnSpawningTicks : undefined,
      spawnWaitingForSufficientEnergyTicks: typeof parsed.loop.spawnWaitingForSufficientEnergyTicks === "number"
        ? parsed.loop.spawnWaitingForSufficientEnergyTicks
        : undefined,
      bankLowObservedTicks: typeof parsed.loop.bankLowObservedTicks === "number" ? parsed.loop.bankLowObservedTicks : undefined,
      bankReserveBreachCount: typeof parsed.loop.bankReserveBreachCount === "number" ? parsed.loop.bankReserveBreachCount : undefined,
      bankReserveRecoveryLatencyTotal: typeof parsed.loop.bankReserveRecoveryLatencyTotal === "number"
        ? parsed.loop.bankReserveRecoveryLatencyTotal
        : undefined,
      bankReserveRecoveryLatencySamples: typeof parsed.loop.bankReserveRecoveryLatencySamples === "number"
        ? parsed.loop.bankReserveRecoveryLatencySamples
        : undefined,
      spawnWaitingWithLoadedCourierTicks: typeof parsed.loop.spawnWaitingWithLoadedCourierTicks === "number"
        ? parsed.loop.spawnWaitingWithLoadedCourierTicks
        : undefined,
      spawnWaitingWithSpawnAdjacentLoadedCourierTicks: typeof parsed.loop.spawnWaitingWithSpawnAdjacentLoadedCourierTicks === "number"
        ? parsed.loop.spawnWaitingWithSpawnAdjacentLoadedCourierTicks
        : undefined,
      spawnWaitingWithWorkerEnergyTicks: typeof parsed.loop.spawnWaitingWithWorkerEnergyTicks === "number"
        ? parsed.loop.spawnWaitingWithWorkerEnergyTicks
        : undefined,
      spawnWaitingWithSourceBacklogTicks: typeof parsed.loop.spawnWaitingWithSourceBacklogTicks === "number"
        ? parsed.loop.spawnWaitingWithSourceBacklogTicks
        : undefined,
      loadedCourierIdleWhileBankLowTicks: typeof parsed.loop.loadedCourierIdleWhileBankLowTicks === "number"
        ? parsed.loop.loadedCourierIdleWhileBankLowTicks
        : undefined,
      extraWorkerGateBlockedTicks: typeof parsed.loop.extraWorkerGateBlockedTicks === "number"
        ? parsed.loop.extraWorkerGateBlockedTicks
        : undefined,
      extraWorkerGateOpenReasonCounts: isNumberRecord(parsed.loop.extraWorkerGateOpenReasonCounts)
        ? parsed.loop.extraWorkerGateOpenReasonCounts
        : undefined,
      bankLowDeliveredEnergyByTargetType: isNumberRecord(parsed.loop.bankLowDeliveredEnergyByTargetType)
        ? parsed.loop.bankLowDeliveredEnergyByTargetType
        : undefined,
      sourceObservedTicks: typeof parsed.loop.sourceObservedTicks === "number" ? parsed.loop.sourceObservedTicks : undefined,
      sourceTotalTicks: typeof parsed.loop.sourceTotalTicks === "number" ? parsed.loop.sourceTotalTicks : undefined,
      sourceStaffedTicks: typeof parsed.loop.sourceStaffedTicks === "number" ? parsed.loop.sourceStaffedTicks : undefined,
      sourceFullyStaffedTicks: typeof parsed.loop.sourceFullyStaffedTicks === "number" ? parsed.loop.sourceFullyStaffedTicks : undefined,
      harvestingSourceStaffedTicks: typeof parsed.loop.harvestingSourceStaffedTicks === "number"
        ? parsed.loop.harvestingSourceStaffedTicks
        : undefined,
      harvestingSourceFullyStaffedTicks: typeof parsed.loop.harvestingSourceFullyStaffedTicks === "number"
        ? parsed.loop.harvestingSourceFullyStaffedTicks
        : undefined,
      activeHarvestingSourceStaffedTicks: typeof parsed.loop.activeHarvestingSourceStaffedTicks === "number"
        ? parsed.loop.activeHarvestingSourceStaffedTicks
        : undefined,
      activeHarvestingSourceFullyStaffedTicks: typeof parsed.loop.activeHarvestingSourceFullyStaffedTicks === "number"
        ? parsed.loop.activeHarvestingSourceFullyStaffedTicks
        : undefined
    };
  }
  if (isRecord(parsed.creeps)) {
    const creeps = Object.fromEntries(Object.entries(parsed.creeps).flatMap(([name, value]) => {
      if (!isRecord(value) || typeof value.role !== "string") {
        return [];
      }

      return [[name, {
        role: value.role,
        ticksSinceSuccess: typeof value.ticksSinceSuccess === "number" ? value.ticksSinceSuccess : value.ticksSinceSuccess === null ? null : null,
        lastSuccessfulAction: typeof value.lastSuccessfulAction === "string" ? value.lastSuccessfulAction : value.lastSuccessfulAction === null ? null : null,
        samePositionTicks: typeof value.samePositionTicks === "number" ? value.samePositionTicks : 0,
        targetSwitches: typeof value.targetSwitches === "number" ? value.targetSwitches : 0,
        lastTarget: typeof value.lastTarget === "string" ? value.lastTarget : value.lastTarget === null ? null : null
      }]];
    }));

    if (Object.keys(creeps).length > 0) {
      snapshot.creeps = creeps;
    }
  }
  if (isNullableNumberRecord(parsed.milestones)) {
    snapshot.milestones = parsed.milestones;
  }
  if (isNumberRecord(parsed.counters)) {
    snapshot.counters = parsed.counters;
  }

  return {
    snapshot,
    health: snapshot.debugError
      ? {
        status: "runtime_error",
        message: snapshot.debugError
      }
      : {
        status: "ok",
        message: null
      }
  };
}

export function buildTelemetryByRole(values: Record<VariantRole, string | null>): Record<VariantRole, BotTelemetrySnapshot | null> {
  return {
    baseline: parseBotTelemetry(values.baseline),
    candidate: parseBotTelemetry(values.candidate)
  };
}

export function inspectTelemetryByRole(values: Record<VariantRole, string | null>): Record<VariantRole, BotTelemetryInspection> {
  return {
    baseline: inspectBotTelemetry(values.baseline),
    candidate: inspectBotTelemetry(values.candidate)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "number");
}

function isNullableNumberRecord(value: unknown): value is Record<string, number | null> {
  return isRecord(value) && Object.values(value).every((entry) => entry === null || typeof entry === "number");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseSpawnAdmission(
  value: unknown
): {
  gameTime: number;
  sourceBacklog: number;
  loadedCouriers: number;
  roleCounts: Record<string, number>;
  openReasons: string[];
  spawnWaitingWithSourceBacklogTicks: number;
  sourceDropToBankLatencyAvg: number | null;
  withinCourier3Window: boolean;
  courier3PriorityActive: boolean;
} | null | undefined {
  if (value === null) {
    return null;
  }

  if (!isRecord(value) || !isNumberRecord(value.roleCounts)) {
    return undefined;
  }

  return {
    gameTime: typeof value.gameTime === "number" ? value.gameTime : 0,
    sourceBacklog: typeof value.sourceBacklog === "number" ? value.sourceBacklog : 0,
    loadedCouriers: typeof value.loadedCouriers === "number" ? value.loadedCouriers : 0,
    roleCounts: value.roleCounts,
    openReasons: isStringArray(value.openReasons) ? value.openReasons : [],
    spawnWaitingWithSourceBacklogTicks: typeof value.spawnWaitingWithSourceBacklogTicks === "number"
      ? value.spawnWaitingWithSourceBacklogTicks
      : 0,
    sourceDropToBankLatencyAvg: typeof value.sourceDropToBankLatencyAvg === "number"
      ? value.sourceDropToBankLatencyAvg
      : value.sourceDropToBankLatencyAvg === null
        ? null
        : null,
    withinCourier3Window: typeof value.withinCourier3Window === "boolean" ? value.withinCourier3Window : false,
    courier3PriorityActive: typeof value.courier3PriorityActive === "boolean" ? value.courier3PriorityActive : false
  };
}
