import type { BotTelemetrySnapshot, VariantRole } from "./contracts.ts";

export const autoscreepsTelemetrySegmentId = 42;

export function parseBotTelemetry(value: string | null): BotTelemetrySnapshot | null {
  if (!value) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const schemaVersion = parsed.schemaVersion;
  const gameTime = parsed.gameTime;
  if (typeof schemaVersion !== "number" || typeof gameTime !== "number") {
    return null;
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
  if (isRecord(parsed.sources) && isNumberRecord(parsed.sources.assignments)) {
    snapshot.sources = {
      total: typeof parsed.sources.total === "number" ? parsed.sources.total : 0,
      staffed: typeof parsed.sources.staffed === "number" ? parsed.sources.staffed : 0,
      assignments: parsed.sources.assignments,
      harvestingStaffed: typeof parsed.sources.harvestingStaffed === "number" ? parsed.sources.harvestingStaffed : 0,
      harvestingAssignments: isNumberRecord(parsed.sources.harvestingAssignments) ? parsed.sources.harvestingAssignments : {},
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
      pickupToSpendLatencySamples: typeof parsed.loop.pickupToSpendLatencySamples === "number" ? parsed.loop.pickupToSpendLatencySamples : undefined
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

  return snapshot;
}

export function buildTelemetryByRole(values: Record<VariantRole, string | null>): Record<VariantRole, BotTelemetrySnapshot | null> {
  return {
    baseline: parseBotTelemetry(values.baseline),
    candidate: parseBotTelemetry(values.candidate)
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
