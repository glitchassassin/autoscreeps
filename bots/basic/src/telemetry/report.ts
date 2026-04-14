import type { WorldSnapshot } from "../core/types";
import { ensureTelemetryState } from "../state/telemetry";
import { createTelemetrySnapshot, telemetrySampleEveryTicks, telemetrySchemaVersion, telemetrySegmentId, type BotReport, type BotTelemetrySnapshot } from "./snapshot";

export function recordTelemetry(world: WorldSnapshot): void {
  if (typeof RawMemory === "undefined") {
    return;
  }

  RawMemory.setActiveSegments([telemetrySegmentId]);

  const telemetryState = ensureTelemetryState();
  if (world.primarySpawnName) {
    telemetryState.firstOwnedSpawnTick ??= world.gameTime;
  }

  if (world.maxOwnedControllerLevel >= 2 && telemetryState.rcl2Tick === null) {
    telemetryState.rcl2Tick = world.gameTime;
  }
  if (world.maxOwnedControllerLevel >= 3 && telemetryState.rcl3Tick === null) {
    telemetryState.rcl3Tick = world.gameTime;
  }

  const telemetry = world.gameTime % telemetrySampleEveryTicks === 0
    ? createTelemetrySnapshot(world, telemetryState)
    : undefined;

  writeBotReport(world.gameTime, telemetryState, telemetry);
}

function writeBotReport(
  gameTime: number,
  telemetryState: TelemetryMemoryState,
  telemetry: BotTelemetrySnapshot | undefined
): void {
  const report: BotReport = {
    schemaVersion: telemetrySchemaVersion,
    gameTime,
    errors: [...(telemetryState.errors ?? [])],
    ...(telemetry ? { telemetry } : {})
  };

  RawMemory.segments[telemetrySegmentId] = JSON.stringify(report);
}
