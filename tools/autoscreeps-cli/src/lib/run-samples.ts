import type { RunSample, RunSummaryMetrics, UserRunSummaryMetrics, VariantRole } from "./contracts.ts";

const trackedControllerLevels = [1, 2, 3, 4, 5, 6, 7, 8] as const;

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
  let maxCombinedRCL = 0;
  let maxOwnedControllers = 0;
  let telemetrySampleCount = 0;
  let spawnIdleSamples = 0;
  let sourceCoverageSamples = 0;
  let totalSourceCoverage = 0;
  let fullyStaffedSamples = 0;
  let harvestingSourceCoverageSamples = 0;
  let totalHarvestingSourceCoverage = 0;
  let fullyHarvestingStaffedSamples = 0;
  let activeHarvestingSourceCoverageSamples = 0;
  let totalActiveHarvestingSourceCoverage = 0;
  let fullyActiveHarvestingStaffedSamples = 0;

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

    const telemetry = sample.telemetry?.[role];
    if (!telemetry) {
      continue;
    }

    telemetrySampleCount += 1;

    if (telemetry.spawn && telemetry.spawn.queueDepth > 0 && !telemetry.spawn.isSpawning) {
      spawnIdleSamples += 1;
    }

    if (telemetry.sources && telemetry.sources.total > 0) {
      sourceCoverageSamples += 1;
      totalSourceCoverage += telemetry.sources.staffed / telemetry.sources.total;
      if (telemetry.sources.staffed >= telemetry.sources.total) {
        fullyStaffedSamples += 1;
      }

      harvestingSourceCoverageSamples += 1;
      totalHarvestingSourceCoverage += telemetry.sources.harvestingStaffed / telemetry.sources.total;
      if (telemetry.sources.harvestingStaffed >= telemetry.sources.total) {
        fullyHarvestingStaffedSamples += 1;
      }

      if (typeof telemetry.sources.activeHarvestingStaffed === "number") {
        activeHarvestingSourceCoverageSamples += 1;
        totalActiveHarvestingSourceCoverage += telemetry.sources.activeHarvestingStaffed / telemetry.sources.total;
        if (telemetry.sources.activeHarvestingStaffed >= telemetry.sources.total) {
          fullyActiveHarvestingStaffedSamples += 1;
        }
      }
    }
  }

  return {
    sampleCount: samples.length,
    firstSeenGameTime,
    controllerLevelMilestones,
    maxCombinedRCL,
    maxOwnedControllers,
    telemetrySampleCount,
    spawnIdlePct: toPercent(spawnIdleSamples, telemetrySampleCount),
    sourceCoveragePct: toPercent(totalSourceCoverage, sourceCoverageSamples),
    sourceUptimePct: toPercent(fullyStaffedSamples, sourceCoverageSamples),
    harvestingSourceCoveragePct: toPercent(totalHarvestingSourceCoverage, harvestingSourceCoverageSamples),
    harvestingSourceUptimePct: toPercent(fullyHarvestingStaffedSamples, harvestingSourceCoverageSamples),
    activeHarvestingSourceCoveragePct: toPercent(totalActiveHarvestingSourceCoverage, activeHarvestingSourceCoverageSamples),
    activeHarvestingSourceUptimePct: toPercent(fullyActiveHarvestingStaffedSamples, activeHarvestingSourceCoverageSamples)
  };
}

function initializeControllerLevelMilestones(): Record<string, number | null> {
  const milestones: Record<string, number | null> = {};

  for (const level of trackedControllerLevels) {
    milestones[String(level)] = null;
  }

  return milestones;
}

function toPercent(value: number, total: number): number | null {
  if (total === 0) {
    return null;
  }

  const ratio = value / total;
  return Math.round(ratio * 10000) / 100;
}
