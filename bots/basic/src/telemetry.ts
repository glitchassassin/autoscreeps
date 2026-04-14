import { summarizeSpawnDemand } from "./spawn";
import { ensureTelemetryState } from "./telemetry-state";

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

export function recordTelemetry(primarySpawn: StructureSpawn | null): void {
  if (typeof RawMemory === "undefined") {
    return;
  }

  RawMemory.setActiveSegments([telemetrySegmentId]);

  const telemetryState = ensureTelemetryState();
  if (primarySpawn) {
    telemetryState.firstOwnedSpawnTick ??= Game.time;
  }

  const maxOwnedControllerLevel = findMaxOwnedControllerLevel();
  if (maxOwnedControllerLevel >= 2 && telemetryState.rcl2Tick === null) {
    telemetryState.rcl2Tick = Game.time;
  }
  if (maxOwnedControllerLevel >= 3 && telemetryState.rcl3Tick === null) {
    telemetryState.rcl3Tick = Game.time;
  }

  const telemetry = Game.time % telemetrySampleEveryTicks === 0
    ? createTelemetrySnapshot(primarySpawn, telemetryState)
    : undefined;

  writeBotReport(telemetryState, telemetry);
}

export function createTelemetrySnapshot(
  primarySpawn: StructureSpawn | null,
  telemetryState: TelemetryMemoryState = ensureTelemetryState()
): BotTelemetrySnapshot {
  const demand = summarizeSpawnDemand(primarySpawn?.room ?? null);
  const primaryController = primarySpawn?.room.controller ?? findPrimaryController();

  return {
    schemaVersion: telemetrySchemaVersion,
    gameTime: Game.time,
    totalCreeps: Object.keys(Game.creeps).length,
    workerCount: Object.values(Game.creeps).filter((creep) => creep.memory.role === "worker").length,
    spawn: {
      isSpawning: Boolean(primarySpawn?.spawning),
      queueDepth: demand.totalUnmetDemand,
      nextRole: demand.nextRole
    },
    controller: {
      level: primaryController?.level ?? null,
      progress: primaryController?.progress ?? null,
      progressTotal: primaryController?.progressTotal ?? null
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

function writeBotReport(telemetryState: TelemetryMemoryState, telemetry: BotTelemetrySnapshot | undefined): void {
  const report: BotReport = {
    schemaVersion: telemetrySchemaVersion,
    gameTime: Game.time,
    errors: [...(telemetryState.errors ?? [])],
    ...(telemetry ? { telemetry } : {})
  };

  RawMemory.segments[telemetrySegmentId] = JSON.stringify(report);
}

function findPrimaryController(): StructureController | null {
  return Object.values(Game.rooms).find((room) => room.controller?.my)?.controller ?? null;
}

function findMaxOwnedControllerLevel(): number {
  let maxLevel = 0;

  for (const room of Object.values(Game.rooms)) {
    if (room.controller?.my) {
      maxLevel = Math.max(maxLevel, room.controller.level);
    }
  }

  return maxLevel;
}
