import type { ColonyPlan, ExecutionSummary, SitePlan, SpawnDemandInputs, WorldSnapshot } from "../core/types";
import { getRoomPlanningTelemetry, type RoomPlanningTelemetry } from "../planning/room-planning-runtime";
import { ensureTelemetryState } from "../state/telemetry";
import { createEmptyCpuTelemetrySnapshot, type CpuTelemetrySnapshot } from "./cpu-profiler";

export const telemetrySegmentId = 42;
export const telemetrySampleEveryTicks = 25;
export const telemetrySchemaVersion = 18;

export type SourceTelemetrySnapshot = {
  sourceId: string;
  theoreticalGrossEpt: number;
  plannedGrossEpt: number;
  actualGrossEpt: number;
  staffingCoverage: number | null;
  harvestExecutionRatio: number | null;
  overallUtilization: number | null;
  assignedHarvesterCount: number;
};

export type BotTelemetrySnapshot = {
  schemaVersion: number;
  gameTime: number;
  cpuGameTime: number | null;
  cpu: CpuTelemetrySnapshot;
  totalCreeps: number;
  mode: ColonyPlan["mode"];
  roleCounts: Record<WorkerRole, number>;
  spawn: {
    isSpawning: boolean;
    queueDepth: number;
    nextRole: WorkerRole | null;
    inputs: SpawnDemandInputs;
  };
  sources: SourceTelemetrySnapshot[];
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
  roomPlanning: RoomPlanningTelemetry;
};

export type BotReport = {
  schemaVersion: number;
  gameTime: number;
  errors: string[];
  telemetry?: BotTelemetrySnapshot;
};

export function createTelemetrySnapshot(
  world: WorldSnapshot,
  plan: ColonyPlan,
  execution: ExecutionSummary,
  telemetryState: TelemetryMemoryState = ensureTelemetryState(),
  cpu: CpuTelemetrySnapshot = createEmptyCpuTelemetrySnapshot(),
  cpuGameTime: number | null = null
): BotTelemetrySnapshot {
  return {
    schemaVersion: telemetrySchemaVersion,
    gameTime: world.gameTime,
    cpuGameTime,
    cpu,
    totalCreeps: world.totalCreeps,
    mode: plan.mode,
    roleCounts: world.creepsByRole,
    spawn: {
      isSpawning: Boolean(world.primarySpawnSpawning),
      queueDepth: plan.spawn.demand.totalUnmetDemand,
      nextRole: plan.spawn.demand.nextRole,
      inputs: plan.spawn.demand.inputs
    },
    sources: plan.sites.map((site) => createSourceTelemetrySnapshot(site, execution)),
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
    },
    roomPlanning: getRoomPlanningTelemetry()
  };
}

function createSourceTelemetrySnapshot(site: SitePlan, execution: ExecutionSummary): SourceTelemetrySnapshot {
  const actualGrossEpt = execution.harvestedEnergyBySourceId[site.sourceId] ?? 0;

  return {
    sourceId: site.sourceId,
    theoreticalGrossEpt: site.theoreticalGrossEpt,
    plannedGrossEpt: site.plannedGrossEpt,
    actualGrossEpt,
    staffingCoverage: divide(site.plannedGrossEpt, site.theoreticalGrossEpt),
    harvestExecutionRatio: divide(actualGrossEpt, site.plannedGrossEpt),
    overallUtilization: divide(actualGrossEpt, site.theoreticalGrossEpt),
    assignedHarvesterCount: site.assignedHarvesterNames.length
  };
}

function divide(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }

  return numerator / denominator;
}
