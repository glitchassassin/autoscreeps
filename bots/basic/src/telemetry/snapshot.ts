import type { WorldSnapshot } from "../core/types";
import { ensureTelemetryState } from "../state/telemetry";
import { summarizeSpawnDemand } from "../planning/spawn-plan";

export const telemetrySegmentId = 42;
export const telemetrySampleEveryTicks = 25;
export const telemetrySchemaVersion = 12;

export type BotTelemetrySnapshot = {
  schemaVersion: number;
  gameTime: number;
  totalCreeps: number;
  workerCount: number;
  spawn: {
    isSpawning: boolean;
    queueDepth: number;
    nextRole: WorkerRole | null;
  };
  controller: {
    level: number | null;
    progress: number | null;
    progressTotal: number | null;
  };
  milestones: {
    firstOwnedSpawnTick: number | null;
    rcl2Tick: number | null;
    rcl3Tick: number | null;
  };
  counters: {
    creepDeaths: number;
  };
};

export type BotReport = {
  schemaVersion: number;
  gameTime: number;
  errors: string[];
  telemetry?: BotTelemetrySnapshot;
};

export function createTelemetrySnapshot(
  world: WorldSnapshot,
  telemetryState: TelemetryMemoryState = ensureTelemetryState()
): BotTelemetrySnapshot {
  const demand = summarizeSpawnDemand(world);

  return {
    schemaVersion: telemetrySchemaVersion,
    gameTime: world.gameTime,
    totalCreeps: world.totalCreeps,
    workerCount: world.creepsByRole.worker,
    spawn: {
      isSpawning: Boolean(world.primarySpawnSpawning),
      queueDepth: demand.totalUnmetDemand,
      nextRole: demand.nextRole
    },
    controller: {
      level: world.primaryController?.level ?? null,
      progress: world.primaryController?.progress ?? null,
      progressTotal: world.primaryController?.progressTotal ?? null
    },
    milestones: {
      firstOwnedSpawnTick: telemetryState.firstOwnedSpawnTick,
      rcl2Tick: telemetryState.rcl2Tick,
      rcl3Tick: telemetryState.rcl3Tick
    },
    counters: {
      creepDeaths: telemetryState.creepDeaths
    }
  };
}
