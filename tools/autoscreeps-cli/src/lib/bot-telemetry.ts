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
      assignments: parsed.sources.assignments
    };
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
