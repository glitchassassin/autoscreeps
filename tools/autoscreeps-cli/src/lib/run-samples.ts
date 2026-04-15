import type { BotReport, CpuRunSummaryMetrics, RoleRecord, RunSample, RunSampleRoomMetrics, RunSummaryMetrics, UserRunSummaryMetrics, UserSampleMetrics, VariantRole } from "./contracts.ts";

const trackedControllerLevels = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const rcl1ProgressTotal = 200;
const totalProgressToRcl3 = rcl1ProgressTotal + 45000;
const rcl2ExtensionTarget = 5;

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
  const roles = collectRoles(samples);

  return {
    sampleEveryTicks,
    users: Object.fromEntries(roles.map((role) => [role, summarizeVariant(samples, role)])) as RoleRecord<UserRunSummaryMetrics>
  };
}

function collectRoles(samples: RunSample[]): VariantRole[] {
  const roles = new Set<VariantRole>();

  for (const sample of samples) {
    for (const role of Object.keys(sample.users) as VariantRole[]) {
      roles.add(role);
    }
  }

  return [...roles];
}

function summarizeVariant(samples: RunSample[], role: VariantRole): UserRunSummaryMetrics {
  const controllerLevelMilestones = initializeControllerLevelMilestones();
  const cpuAccumulator = createCpuSummaryAccumulator();
  let firstSeenGameTime: number | null = null;
  let controllerProgressToRCL3Pct: number | null = null;
  let maxCombinedRCL = 0;
  let maxOwnedControllers = 0;
  let firstExtensionTick: number | null = null;
  let allRcl2ExtensionsTick: number | null = null;
  let sampleCount = 0;

  for (const sample of samples) {
    const stats = sample.users[role];
    if (!stats) {
      continue;
    }

    sampleCount += 1;
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

    recordCpuSummary(cpuAccumulator, sample.reports?.[role] ?? null);
  }

  return {
    sampleCount,
    firstSeenGameTime,
    controllerLevelMilestones,
    controllerProgressToRCL3Pct,
    maxCombinedRCL,
    maxOwnedControllers,
    firstExtensionTick,
    allRcl2ExtensionsTick,
    ...(cpuAccumulator.observedTickCount > 0 ? { cpu: finalizeCpuSummary(cpuAccumulator) } : {})
  };
}

function createCpuSummaryAccumulator(): {
  observedTickCount: number;
  totalUsed: number;
  peakUsed: number | null;
  topLevelTotals: Record<string, number>;
  topLevelPeaks: Record<string, number>;
} {
  return {
    observedTickCount: 0,
    totalUsed: 0,
    peakUsed: null,
    topLevelTotals: {},
    topLevelPeaks: {}
  };
}

function recordCpuSummary(
  accumulator: ReturnType<typeof createCpuSummaryAccumulator>,
  report: BotReport | null
): void {
  const cpu = extractCpuSummary(report);
  if (cpu === null) {
    return;
  }

  accumulator.observedTickCount += 1;
  accumulator.totalUsed += cpu.used;
  accumulator.peakUsed = accumulator.peakUsed === null ? cpu.used : Math.max(accumulator.peakUsed, cpu.used);

  for (const phase of cpu.topLevelPhases) {
    accumulator.topLevelTotals[phase.label] = (accumulator.topLevelTotals[phase.label] ?? 0) + phase.total;
    accumulator.topLevelPeaks[phase.label] = Math.max(accumulator.topLevelPeaks[phase.label] ?? 0, phase.total);
  }
}

function finalizeCpuSummary(
  accumulator: ReturnType<typeof createCpuSummaryAccumulator>
): CpuRunSummaryMetrics {
  return {
    observedTickCount: accumulator.observedTickCount,
    avgUsedPerTick: divideAndRound(accumulator.totalUsed, accumulator.observedTickCount),
    peakUsedPerTick: roundMetric(accumulator.peakUsed),
    topLevelAvgPerTick: Object.fromEntries(
      Object.entries(accumulator.topLevelTotals)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, total]) => [label, divideAndRound(total, accumulator.observedTickCount) ?? 0])
    ),
    topLevelPeakPerTick: Object.fromEntries(
      Object.entries(accumulator.topLevelPeaks)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, peak]) => [label, roundMetric(peak) ?? 0])
    )
  };
}

function extractCpuSummary(report: BotReport | null): {
  used: number;
  topLevelPhases: Array<{ label: string; total: number }>;
} | null {
  if (!report || !isRecord(report.telemetry)) {
    return null;
  }

  const cpu = report.telemetry.cpu;
  if (!isRecord(cpu)) {
    return null;
  }

  const used = normalizeNumber(cpu.used);
  if (used === null) {
    return null;
  }

  const rawProfile = Array.isArray(cpu.profile) ? cpu.profile : [];
  const topLevelPhases = rawProfile.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const label = typeof entry.label === "string" ? entry.label : null;
    const total = normalizeNumber(entry.total);
    if (label === null || total === null) {
      return [];
    }

    return [{ label, total }];
  });

  return {
    used,
    topLevelPhases
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

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function divideAndRound(total: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }

  return roundMetric(total / count);
}

function roundMetric(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  return Math.round(value * 1000) / 1000;
}
