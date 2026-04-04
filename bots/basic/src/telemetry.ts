import { summarizeSpawnDemand } from "./spawn";
import { ensureTelemetryState } from "./telemetry-state";

export const telemetrySegmentId = 42;
export const telemetrySampleEveryTicks = 25;
export const telemetrySchemaVersion = 3;

export type BotTelemetrySnapshot = {
  schemaVersion: number;
  gameTime: number;
  colonyMode: "bootstrap" | "recovery" | "normal";
  totalCreeps: number;
  roleCounts: Record<WorkerRole, number>;
  spawn: {
    queueDepth: number;
    isSpawning: boolean;
    nextRole: WorkerRole | null;
    unmetDemand: Record<WorkerRole, number>;
  };
  sources: {
    total: number;
    staffed: number;
    assignments: Record<string, number>;
    harvestingStaffed: number;
    harvestingAssignments: Record<string, number>;
  };
  milestones: Record<string, number | null>;
  counters: {
    creepDeaths: number;
  };
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

  if (Game.time % telemetrySampleEveryTicks !== 0) {
    return;
  }

  RawMemory.segments[telemetrySegmentId] = JSON.stringify(createTelemetrySnapshot(primarySpawn, telemetryState));
}

export function createTelemetrySnapshot(
  primarySpawn: StructureSpawn | null,
  telemetryState: TelemetryMemoryState = ensureTelemetryState()
): BotTelemetrySnapshot {
  const demand = summarizeSpawnDemand();
  const roleCounts = countRoles();
  const totalCreeps = Object.keys(Game.creeps).length;

  return {
    schemaVersion: telemetrySchemaVersion,
    gameTime: Game.time,
    colonyMode: determineColonyMode(primarySpawn, totalCreeps),
    totalCreeps,
    roleCounts,
    spawn: {
      queueDepth: demand.totalUnmetDemand,
      isSpawning: Boolean(primarySpawn?.spawning),
      nextRole: demand.nextRole,
      unmetDemand: demand.unmetDemand
    },
    sources: summarizeSourceStaffing(),
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

function countRoles(): Record<WorkerRole, number> {
  const counts: Record<WorkerRole, number> = {
    harvester: 0,
    upgrader: 0
  };

  for (const creep of Object.values(Game.creeps)) {
    counts[creep.memory.role] += 1;
  }

  return counts;
}

function summarizeSourceStaffing(): BotTelemetrySnapshot["sources"] {
  const assignments: Record<string, number> = {};
  const harvestingAssignments: Record<string, number> = {};
  let total = 0;

  for (const room of Object.values(Game.rooms)) {
    total += room.find(FIND_SOURCES).length;
  }

  for (const creep of Object.values(Game.creeps)) {
    const sourceId = creep.memory.sourceId;
    if (!sourceId) {
      continue;
    }

    assignments[sourceId] = (assignments[sourceId] ?? 0) + 1;

    if (!creep.memory.working) {
      harvestingAssignments[sourceId] = (harvestingAssignments[sourceId] ?? 0) + 1;
    }
  }

  return {
    total,
    staffed: Object.keys(assignments).length,
    assignments,
    harvestingStaffed: Object.keys(harvestingAssignments).length,
    harvestingAssignments
  };
}

function determineColonyMode(primarySpawn: StructureSpawn | null, totalCreeps: number): BotTelemetrySnapshot["colonyMode"] {
  if (!primarySpawn) {
    return "bootstrap";
  }

  if (totalCreeps === 0) {
    return "recovery";
  }

  return "normal";
}

function findMaxOwnedControllerLevel(): number {
  let maxLevel = 0;

  for (const room of Object.values(Game.rooms)) {
    const controller = room.controller;
    if (controller?.my && controller.level > maxLevel) {
      maxLevel = controller.level;
    }
  }

  return maxLevel;
}
