import type { BotReport, BotReportHealth, RoleRecord, VariantRole } from "./contracts.ts";

export const autoscreepsReportSegmentId = 42;

export type BotReportInspection = {
  snapshot: BotReport | null;
  health: BotReportHealth;
};

export function parseBotReport(value: string | null): BotReport | null {
  return inspectBotReport(value).snapshot;
}

export function inspectBotReport(value: string | null): BotReportInspection {
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
        message: "Bot report payload must be a JSON object."
      }
    };
  }

  const schemaVersion = parsed.schemaVersion;
  const gameTime = parsed.gameTime;
  const errors = parsed.errors;
  if (typeof schemaVersion !== "number" || typeof gameTime !== "number" || !isStringArray(errors)) {
    return {
      snapshot: null,
      health: {
        status: "parse_error",
        message: "Bot report payload is missing required numeric schemaVersion/gameTime fields or string[] errors."
      }
    };
  }

  const snapshot: BotReport = {
    schemaVersion,
    gameTime,
    errors,
    ...(Object.prototype.hasOwnProperty.call(parsed, "telemetry") ? { telemetry: parsed.telemetry } : {})
  };

  return {
    snapshot,
    health: {
      status: "ok",
      message: null
    }
  };
}

export function buildReportsByRole(values: RoleRecord<string | null>): RoleRecord<BotReport | null> {
  return Object.fromEntries(
    Object.entries(values).map(([role, value]) => [role, parseBotReport(value)])
  ) as RoleRecord<BotReport | null>;
}

export function inspectReportsByRole(values: RoleRecord<string | null>): RoleRecord<BotReportInspection> {
  return Object.fromEntries(
    Object.entries(values).map(([role, value]) => [role, inspectBotReport(value)])
  ) as RoleRecord<BotReportInspection>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export type { VariantRole };
