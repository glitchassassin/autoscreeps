import type { RunSample, RunSampleRoomMetrics, RunSummaryMetrics, UserRunSummaryMetrics, UserSampleMetrics, VariantRole } from "./contracts.ts";

const trackedControllerLevels = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const rcl1ProgressTotal = 200;
const rcl2ProgressTotal = 45000;
const totalProgressToRcl3 = rcl1ProgressTotal + rcl2ProgressTotal;
const rcl2ExtensionTarget = 5;
const activeCreepPhases = new Set(["harvest", "pickup", "transfer", "upgrade", "build", "move"]);

type VariantTelemetry = NonNullable<RunSample["telemetry"]>[VariantRole];
type SpawnPipelineAccumulator = {
  observedTicks: number;
  idleTicks: number;
  spawningTicks: number;
  waitingForSufficientEnergyTicks: number;
};
type SourcePipelineAccumulator = {
  observedTicks: number;
  totalTicks: number;
  staffedTicks: number;
  fullyStaffedTicks: number;
  harvestingStaffedTicks: number;
  harvestingFullyStaffedTicks: number;
  activeHarvestingStaffedTicks: number;
  activeHarvestingFullyStaffedTicks: number;
};

export function shouldCaptureRunSample(
  startGameTime: number,
  lastSampleGameTime: number | null,
  gameTime: number,
  sampleEveryTicks: number
): boolean {
  if (sampleEveryTicks <= 0) {
    return false;
  }

  if (lastSampleGameTime === null) {
    return true;
  }

  if (lastSampleGameTime <= startGameTime && gameTime <= startGameTime) {
    return true;
  }

  return gameTime - lastSampleGameTime >= sampleEveryTicks;
}

export function buildRunSummaryMetrics(samples: RunSample[], sampleEveryTicks: number): RunSummaryMetrics {
  return {
    sampleEveryTicks,
    users: {
      baseline: summarizeVariant(samples, "baseline"),
      candidate: summarizeVariant(samples, "candidate")
    }
  };
}

function summarizeVariant(samples: RunSample[], role: VariantRole): UserRunSummaryMetrics {
  const controllerLevelMilestones = initializeControllerLevelMilestones();
  let firstSeenGameTime: number | null = null;
  let controllerProgressToRCL3Pct: number | null = null;
  let maxCombinedRCL = 0;
  let maxOwnedControllers = 0;
  let firstExtensionTick: number | null = null;
  let allRcl2ExtensionsTick: number | null = null;
  let telemetrySampleCount = 0;
  let latestTelemetry: VariantTelemetry = null;
  const spawnPipelineFallback: SpawnPipelineAccumulator = {
    observedTicks: 0,
    idleTicks: 0,
    spawningTicks: 0,
    waitingForSufficientEnergyTicks: 0
  };
  const sourcePipelineFallback: SourcePipelineAccumulator = {
    observedTicks: 0,
    totalTicks: 0,
    staffedTicks: 0,
    fullyStaffedTicks: 0,
    harvestingStaffedTicks: 0,
    harvestingFullyStaffedTicks: 0,
    activeHarvestingStaffedTicks: 0,
    activeHarvestingFullyStaffedTicks: 0
  };

  for (const sample of samples) {
    const stats = sample.users[role];
    if (!stats) {
      continue;
    }

    firstSeenGameTime ??= sample.gameTime;
    maxCombinedRCL = Math.max(maxCombinedRCL, stats.combinedRCL);
    maxOwnedControllers = Math.max(maxOwnedControllers, stats.ownedControllers);

    for (const level of trackedControllerLevels) {
      const key = String(level);
      if (controllerLevelMilestones[key] === null && stats.maxOwnedControllerLevel !== null && stats.maxOwnedControllerLevel >= level) {
        controllerLevelMilestones[key] = sample.gameTime;
      }
    }

    const room = sample.rooms?.[role];
    const progress = calculateControllerProgressToRcl3Pct(room, stats);
    if (progress !== null) {
      controllerProgressToRCL3Pct = progress;
    }

    const extensions = room?.extensions;
    if (typeof extensions === "number") {
      if (firstExtensionTick === null && extensions > 0) {
        firstExtensionTick = sample.gameTime;
      }
      if (allRcl2ExtensionsTick === null && extensions >= rcl2ExtensionTarget) {
        allRcl2ExtensionsTick = sample.gameTime;
      }
    }

    const telemetry = sample.telemetry?.[role];
    if (!telemetry) {
      continue;
    }

    latestTelemetry = telemetry;
    telemetrySampleCount += 1;

    if (telemetry.spawn) {
      spawnPipelineFallback.observedTicks += 1;

      if (telemetry.spawn.isSpawning) {
        spawnPipelineFallback.spawningTicks += 1;
      } else if (telemetry.spawn.queueDepth > 0) {
        spawnPipelineFallback.waitingForSufficientEnergyTicks += 1;
      } else {
        spawnPipelineFallback.idleTicks += 1;
      }
    }

    if (telemetry.sources && telemetry.sources.total > 0) {
      sourcePipelineFallback.observedTicks += 1;
      sourcePipelineFallback.totalTicks += telemetry.sources.total;
      sourcePipelineFallback.staffedTicks += telemetry.sources.staffed;
      if (telemetry.sources.staffed >= telemetry.sources.total) {
        sourcePipelineFallback.fullyStaffedTicks += 1;
      }

      sourcePipelineFallback.harvestingStaffedTicks += telemetry.sources.harvestingStaffed;
      if (telemetry.sources.harvestingStaffed >= telemetry.sources.total) {
        sourcePipelineFallback.harvestingFullyStaffedTicks += 1;
      }

      if (typeof telemetry.sources.activeHarvestingStaffed === "number") {
        sourcePipelineFallback.activeHarvestingStaffedTicks += telemetry.sources.activeHarvestingStaffed;
        if (telemetry.sources.activeHarvestingStaffed >= telemetry.sources.total) {
          sourcePipelineFallback.activeHarvestingFullyStaffedTicks += 1;
        }
      }
    }
  }

  const spawnPipeline = summarizeSpawnPipeline(latestTelemetry, spawnPipelineFallback);
  const sourcePipeline = summarizeSourcePipeline(latestTelemetry, firstSeenGameTime, sourcePipelineFallback);
  const sourceCoveragePipeline = summarizeSourceCoveragePipeline(latestTelemetry, sourcePipelineFallback);
  const creepPipeline = summarizeCreepPipeline(latestTelemetry);

  return {
    sampleCount: samples.length,
    firstSeenGameTime,
    controllerLevelMilestones,
    controllerProgressToRCL3Pct,
    maxCombinedRCL,
    maxOwnedControllers,
    firstExtensionTick,
    allRcl2ExtensionsTick,
    telemetrySampleCount,
    sourceHarvestEnergyPerTick: sourcePipeline.sourceHarvestEnergyPerTick,
    sourceHarvestCeilingEnergyPerTick: sourcePipeline.sourceHarvestCeilingEnergyPerTick,
    sourceHarvestUtilizationPct: sourcePipeline.sourceHarvestUtilizationPct,
    spawnIdlePct: spawnPipeline.spawnIdlePct,
    spawnSpawningPct: spawnPipeline.spawnSpawningPct,
    spawnWaitingForSufficientEnergyPct: spawnPipeline.spawnWaitingForSufficientEnergyPct,
    creepIdlePct: creepPipeline.creepIdlePct,
    creepActivePct: creepPipeline.creepActivePct,
    creepWaitingForEnergyPct: creepPipeline.creepWaitingForEnergyPct,
    sourceCoveragePct: sourceCoveragePipeline.sourceCoveragePct,
    sourceUptimePct: sourceCoveragePipeline.sourceUptimePct,
    harvestingSourceCoveragePct: sourceCoveragePipeline.harvestingSourceCoveragePct,
    harvestingSourceUptimePct: sourceCoveragePipeline.harvestingSourceUptimePct,
    activeHarvestingSourceCoveragePct: sourceCoveragePipeline.activeHarvestingSourceCoveragePct,
    activeHarvestingSourceUptimePct: sourceCoveragePipeline.activeHarvestingSourceUptimePct
  };
}

function initializeControllerLevelMilestones(): Record<string, number | null> {
  const milestones: Record<string, number | null> = {};

  for (const level of trackedControllerLevels) {
    milestones[String(level)] = null;
  }

  return milestones;
}

function calculateControllerProgressToRcl3Pct(room: RunSampleRoomMetrics | undefined, stats: UserSampleMetrics): number | null {
  const controllerLevel = room?.controllerLevel ?? stats.maxOwnedControllerLevel;
  if (controllerLevel === null) {
    return null;
  }

  if (controllerLevel >= 3) {
    return 100;
  }

  const controllerProgress = room?.controllerProgress;
  if (typeof controllerProgress !== "number") {
    return controllerLevel >= 2 ? normalizeControllerProgressToRcl3Pct(rcl1ProgressTotal) : null;
  }

  if (controllerLevel <= 1) {
    return normalizeControllerProgressToRcl3Pct(controllerProgress);
  }

  return normalizeControllerProgressToRcl3Pct(rcl1ProgressTotal + controllerProgress);
}

function normalizeControllerProgressToRcl3Pct(progress: number): number {
  const boundedProgress = Math.min(Math.max(progress, 0), totalProgressToRcl3);
  return Math.round((boundedProgress / totalProgressToRcl3) * 10000) / 100;
}

function toPercent(value: number, total: number): number | null {
  if (total === 0) {
    return null;
  }

  const ratio = value / total;
  return Math.round(ratio * 10000) / 100;
}

function summarizeSpawnPipeline(
  telemetry: VariantTelemetry,
  fallback: SpawnPipelineAccumulator
): Pick<UserRunSummaryMetrics, "spawnIdlePct" | "spawnSpawningPct" | "spawnWaitingForSufficientEnergyPct"> {
  const observedTicks = telemetry?.loop?.spawnObservedTicks ?? fallback.observedTicks;
  const idleTicks = telemetry?.loop?.spawnIdleTicks ?? fallback.idleTicks;
  const spawningTicks = telemetry?.loop?.spawnSpawningTicks ?? fallback.spawningTicks;
  const waitingForSufficientEnergyTicks = telemetry?.loop?.spawnWaitingForSufficientEnergyTicks ?? fallback.waitingForSufficientEnergyTicks;

  return {
    spawnIdlePct: toPercent(idleTicks, observedTicks),
    spawnSpawningPct: toPercent(spawningTicks, observedTicks),
    spawnWaitingForSufficientEnergyPct: toPercent(waitingForSufficientEnergyTicks, observedTicks)
  };
}

function summarizeSourcePipeline(
  telemetry: VariantTelemetry,
  firstSeenGameTime: number | null,
  fallback: SourcePipelineAccumulator
): Pick<UserRunSummaryMetrics, "sourceHarvestEnergyPerTick" | "sourceHarvestCeilingEnergyPerTick" | "sourceHarvestUtilizationPct"> {
  const harvestedEnergy = telemetry?.sources?.harvestedEnergy;
  if (telemetry === null || typeof harvestedEnergy !== "number") {
    return {
      sourceHarvestEnergyPerTick: null,
      sourceHarvestCeilingEnergyPerTick: null,
      sourceHarvestUtilizationPct: null
    };
  }

  const observedTicks = telemetry.loop?.sourceObservedTicks
    ?? (firstSeenGameTime === null ? fallback.observedTicks : Math.max(telemetry.gameTime - Math.min(firstSeenGameTime, telemetry.gameTime) + 1, 1));
  const sourceTotalTicks = telemetry.loop?.sourceTotalTicks
    ?? (fallback.totalTicks > 0
      ? fallback.totalTicks
      : typeof telemetry.sources?.total === "number" && observedTicks > 0
        ? telemetry.sources.total * observedTicks
        : 0);
  if (observedTicks <= 0 || sourceTotalTicks <= 0) {
    return {
      sourceHarvestEnergyPerTick: null,
      sourceHarvestCeilingEnergyPerTick: null,
      sourceHarvestUtilizationPct: null
    };
  }

  const sourceHarvestEnergyPerTick = roundToTwoDecimals(harvestedEnergy / observedTicks);
  const sourceHarvestCeilingEnergyPerTick = roundToTwoDecimals((sourceTotalTicks / observedTicks) * 10);

  return {
    sourceHarvestEnergyPerTick,
    sourceHarvestCeilingEnergyPerTick,
    sourceHarvestUtilizationPct: roundToTwoDecimals((harvestedEnergy / (sourceTotalTicks * 10)) * 100)
  };
}

function summarizeSourceCoveragePipeline(
  telemetry: VariantTelemetry,
  fallback: SourcePipelineAccumulator
): Pick<
  UserRunSummaryMetrics,
  | "sourceCoveragePct"
  | "sourceUptimePct"
  | "harvestingSourceCoveragePct"
  | "harvestingSourceUptimePct"
  | "activeHarvestingSourceCoveragePct"
  | "activeHarvestingSourceUptimePct"
> {
  const observedTicks = telemetry?.loop?.sourceObservedTicks ?? fallback.observedTicks;
  const totalTicks = telemetry?.loop?.sourceTotalTicks ?? fallback.totalTicks;
  const staffedTicks = telemetry?.loop?.sourceStaffedTicks ?? fallback.staffedTicks;
  const fullyStaffedTicks = telemetry?.loop?.sourceFullyStaffedTicks ?? fallback.fullyStaffedTicks;
  const harvestingStaffedTicks = telemetry?.loop?.harvestingSourceStaffedTicks ?? fallback.harvestingStaffedTicks;
  const harvestingFullyStaffedTicks = telemetry?.loop?.harvestingSourceFullyStaffedTicks ?? fallback.harvestingFullyStaffedTicks;
  const activeHarvestingStaffedTicks = telemetry?.loop?.activeHarvestingSourceStaffedTicks ?? fallback.activeHarvestingStaffedTicks;
  const activeHarvestingFullyStaffedTicks = telemetry?.loop?.activeHarvestingSourceFullyStaffedTicks ?? fallback.activeHarvestingFullyStaffedTicks;

  return {
    sourceCoveragePct: toPercent(staffedTicks, totalTicks),
    sourceUptimePct: toPercent(fullyStaffedTicks, observedTicks),
    harvestingSourceCoveragePct: toPercent(harvestingStaffedTicks, totalTicks),
    harvestingSourceUptimePct: toPercent(harvestingFullyStaffedTicks, observedTicks),
    activeHarvestingSourceCoveragePct: toPercent(activeHarvestingStaffedTicks, totalTicks),
    activeHarvestingSourceUptimePct: toPercent(activeHarvestingFullyStaffedTicks, observedTicks)
  };
}

function summarizeCreepPipeline(
  telemetry: VariantTelemetry
): Pick<UserRunSummaryMetrics, "creepIdlePct" | "creepActivePct" | "creepWaitingForEnergyPct"> {
  const phaseTicks = telemetry?.loop?.phaseTicks;
  if (!phaseTicks) {
    return {
      creepIdlePct: null,
      creepActivePct: null,
      creepWaitingForEnergyPct: null
    };
  }

  const totalCreepTicks = sumRecord(phaseTicks);
  if (totalCreepTicks <= 0) {
    return {
      creepIdlePct: null,
      creepActivePct: null,
      creepWaitingForEnergyPct: null
    };
  }

  let activeTicks = 0;
  for (const [key, value] of Object.entries(phaseTicks)) {
    if (activeCreepPhases.has(extractPhaseName(key))) {
      activeTicks += value;
    }
  }

  const waitingTicks = Math.min(sumRecord(telemetry?.loop?.noEnergyAvailableTicks), totalCreepTicks);
  const idleTicks = Math.max(totalCreepTicks - activeTicks - waitingTicks, 0);

  return {
    creepIdlePct: toPercent(idleTicks, totalCreepTicks),
    creepActivePct: toPercent(activeTicks, totalCreepTicks),
    creepWaitingForEnergyPct: toPercent(waitingTicks, totalCreepTicks)
  };
}

function extractPhaseName(key: string): string {
  const separator = key.indexOf(".");
  return separator >= 0 ? key.slice(separator + 1) : key;
}

function sumRecord(record: Record<string, number> | undefined): number {
  if (!record) {
    return 0;
  }

  return Object.values(record as Record<string, number>).reduce((sum, value) => sum + value, 0);
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
