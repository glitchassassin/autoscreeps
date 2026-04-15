import type { ColonyPlan, ExecutionSummary, WorldSnapshot } from "../core/types";
import { ensureTelemetryState } from "../state/telemetry";
import { createEmptyCpuTelemetrySnapshot, measureCpu, snapshotCpuProfiler, type CpuProfiler, type CpuTelemetrySnapshot } from "./cpu-profiler";
import { createTelemetrySnapshot, telemetrySchemaVersion, telemetrySegmentId, type BotReport, type BotTelemetrySnapshot } from "./snapshot";

type PendingCpuTelemetry = {
  gameTime: number;
  snapshot: CpuTelemetrySnapshot;
};

let pendingCpuTelemetry: PendingCpuTelemetry | null = null;

export function resetPendingCpuTelemetry(): void {
  pendingCpuTelemetry = null;
}

export function recordTelemetry(world: WorldSnapshot, plan?: ColonyPlan, execution?: ExecutionSummary, profiler?: CpuProfiler): void {
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

  const telemetry = plan && execution
    ? createTelemetrySnapshot(
      world,
      plan,
      execution,
      telemetryState,
      pendingCpuTelemetry?.snapshot ?? createEmptyCpuTelemetrySnapshot(),
      pendingCpuTelemetry?.gameTime ?? null
    )
    : undefined;

  if (profiler?.enabled) {
    measureCpu(profiler, "report", () => writeBotReport(world.gameTime, telemetryState, telemetry));
    pendingCpuTelemetry = {
      gameTime: world.gameTime,
      snapshot: snapshotCpuProfiler(profiler)
    };
    return;
  }

  writeBotReport(world.gameTime, telemetryState, telemetry);
  pendingCpuTelemetry = null;
}

function writeBotReport(
  gameTime: number,
  telemetryState: TelemetryMemoryState,
  telemetry?: BotTelemetrySnapshot
): void {
  const report: BotReport = {
    schemaVersion: telemetrySchemaVersion,
    gameTime,
    errors: [...(telemetryState.errors ?? [])],
    ...(telemetry ? { telemetry } : {})
  };

  RawMemory.segments[telemetrySegmentId] = JSON.stringify(report);
}
