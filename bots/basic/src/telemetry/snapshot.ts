import type { ColonyPlan, ExecutionSummary, SitePlan, SpawnDemandInputs, WorldSnapshot } from "../core/types";
import { getRoomPlanningTelemetry, type RoomPlanningTelemetry } from "../planning/room-planning-runtime";
import { ensureEnergyLedgerState, ensureRunnerMovementState, ensureRunnerStateTicksState, ensureTelemetryState } from "../state/telemetry";
import { createEmptyCpuTelemetrySnapshot, type CpuTelemetrySnapshot } from "./cpu-profiler";

export const telemetrySegmentId = 42;
export const telemetrySampleEveryTicks = 25;
export const telemetrySchemaVersion = 21;

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
  haul: HaulTelemetrySnapshot;
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
    energy: EnergyLedgerMemoryState;
  };
  roomPlanning: RoomPlanningTelemetry;
};

export type HaulTelemetrySnapshot = {
  observedTicks: number;
  runnerStateTicks: RunnerStateTicksMemoryState;
  movement: RunnerMovementMemoryState;
  capacity: HaulCapacityTelemetrySnapshot;
  sources: HaulSourceTelemetrySnapshot[];
};

export type HaulCapacityTelemetrySnapshot = {
  activeRunnerCarryParts: number;
  activeRunnerCarryCapacity: number;
  observedRequiredCarryParts: number;
  observedRequiredCarryPartsExact: number;
  plannedRequiredCarryParts: number;
  plannedRequiredCarryPartsExact: number;
  theoreticalRequiredCarryParts: number;
  theoreticalRequiredCarryPartsExact: number;
  observedCoverage: number | null;
  plannedCoverage: number | null;
  theoreticalCoverage: number | null;
  unknownPathSourceCount: number;
};

export type HaulSourceTelemetrySnapshot = {
  sourceId: string;
  pathLengthToPrimarySpawn: number | null;
  roundTripTicks: number | null;
  observedHarvestedEnergy: number;
  observedHarvestedEpt: number;
  plannedGrossEpt: number;
  theoreticalGrossEpt: number;
  observedRequiredCarryParts: number | null;
  observedRequiredCarryPartsExact: number | null;
  plannedRequiredCarryParts: number | null;
  plannedRequiredCarryPartsExact: number | null;
  theoreticalRequiredCarryParts: number | null;
  theoreticalRequiredCarryPartsExact: number | null;
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
    haul: createHaulTelemetrySnapshot(world, plan, telemetryState),
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
      creepDeaths: telemetryState.creepDeaths,
      energy: cloneEnergyLedger(ensureEnergyLedgerState(telemetryState))
    },
    roomPlanning: getRoomPlanningTelemetry()
  };
}

function createHaulTelemetrySnapshot(world: WorldSnapshot, plan: ColonyPlan, telemetryState: TelemetryMemoryState): HaulTelemetrySnapshot {
  const ledger = ensureEnergyLedgerState(telemetryState);
  const observedTicks = Math.max(world.gameTime - (telemetryState.firstOwnedSpawnTick ?? 0), 1);
  const activeRunnerCarryParts = world.creeps
    .filter((creep) => creep.role === "runner" && creep.homeRoom === world.primaryRoomName)
    .reduce((total, creep) => total + creep.activeCarryParts, 0);
  const sources = plan.sites.map((site) => createHaulSourceTelemetrySnapshot(world, site, ledger, observedTicks));
  const knownSources = sources.filter((source) => source.roundTripTicks !== null);
  const observedRequiredCarryPartsExact = sumNullable(knownSources.map((source) => source.observedRequiredCarryPartsExact));
  const plannedRequiredCarryPartsExact = sumNullable(knownSources.map((source) => source.plannedRequiredCarryPartsExact));
  const theoreticalRequiredCarryPartsExact = sumNullable(knownSources.map((source) => source.theoreticalRequiredCarryPartsExact));
  const observedRequiredCarryParts = sumNullable(knownSources.map((source) => source.observedRequiredCarryParts));
  const plannedRequiredCarryParts = sumNullable(knownSources.map((source) => source.plannedRequiredCarryParts));
  const theoreticalRequiredCarryParts = sumNullable(knownSources.map((source) => source.theoreticalRequiredCarryParts));

  return {
    observedTicks,
    runnerStateTicks: cloneRunnerStateTicks(ensureRunnerStateTicksState(telemetryState)),
    movement: cloneRunnerMovement(ensureRunnerMovementState(telemetryState)),
    capacity: {
      activeRunnerCarryParts,
      activeRunnerCarryCapacity: activeRunnerCarryParts * 50,
      observedRequiredCarryParts,
      observedRequiredCarryPartsExact,
      plannedRequiredCarryParts,
      plannedRequiredCarryPartsExact,
      theoreticalRequiredCarryParts,
      theoreticalRequiredCarryPartsExact,
      observedCoverage: divide(activeRunnerCarryParts, observedRequiredCarryPartsExact),
      plannedCoverage: divide(activeRunnerCarryParts, plannedRequiredCarryPartsExact),
      theoreticalCoverage: divide(activeRunnerCarryParts, theoreticalRequiredCarryPartsExact),
      unknownPathSourceCount: sources.length - knownSources.length
    },
    sources
  };
}

function createHaulSourceTelemetrySnapshot(
  world: WorldSnapshot,
  site: SitePlan,
  ledger: EnergyLedgerMemoryState,
  observedTicks: number
): HaulSourceTelemetrySnapshot {
  const source = world.sources.find((candidate) => candidate.sourceId === site.sourceId);
  const pathLengthToPrimarySpawn = source?.pathLengthToPrimarySpawn ?? null;
  const roundTripTicks = pathLengthToPrimarySpawn === null ? null : 2 * Math.max(pathLengthToPrimarySpawn, 0) + 2;
  const observedHarvestedEnergy = ledger.harvestedBySourceId[site.sourceId] ?? 0;
  const observedHarvestedEpt = observedHarvestedEnergy / observedTicks;

  return {
    sourceId: site.sourceId,
    pathLengthToPrimarySpawn,
    roundTripTicks,
    observedHarvestedEnergy,
    observedHarvestedEpt,
    plannedGrossEpt: site.plannedGrossEpt,
    theoreticalGrossEpt: site.theoreticalGrossEpt,
    observedRequiredCarryParts: calculateRequiredCarryParts(observedHarvestedEpt, roundTripTicks),
    observedRequiredCarryPartsExact: calculateRequiredCarryPartsExact(observedHarvestedEpt, roundTripTicks),
    plannedRequiredCarryParts: calculateRequiredCarryParts(site.plannedGrossEpt, roundTripTicks),
    plannedRequiredCarryPartsExact: calculateRequiredCarryPartsExact(site.plannedGrossEpt, roundTripTicks),
    theoreticalRequiredCarryParts: calculateRequiredCarryParts(site.theoreticalGrossEpt, roundTripTicks),
    theoreticalRequiredCarryPartsExact: calculateRequiredCarryPartsExact(site.theoreticalGrossEpt, roundTripTicks)
  };
}

function cloneEnergyLedger(ledger: EnergyLedgerMemoryState): EnergyLedgerMemoryState {
  return {
    harvested: ledger.harvested,
    harvestedBySourceId: { ...ledger.harvestedBySourceId },
    dropped: ledger.dropped,
    pickedUp: ledger.pickedUp,
    withdrawn: ledger.withdrawn,
    transferred: ledger.transferred,
    spawnedBodyCost: ledger.spawnedBodyCost,
    upgraded: ledger.upgraded,
    built: ledger.built,
    lostOnCreepDeath: ledger.lostOnCreepDeath
  };
}

function cloneRunnerStateTicks(ticks: RunnerStateTicksMemoryState): RunnerStateTicksMemoryState {
  return {
    idleNoPickupTarget: ticks.idleNoPickupTarget,
    movingToPickup: ticks.movingToPickup,
    pickupSucceeded: ticks.pickupSucceeded,
    pickupFailed: ticks.pickupFailed,
    idleNoDeliveryTarget: ticks.idleNoDeliveryTarget,
    movingToDelivery: ticks.movingToDelivery,
    transferSucceeded: ticks.transferSucceeded,
    transferFailed: ticks.transferFailed
  };
}

function cloneRunnerMovement(movement: RunnerMovementMemoryState): RunnerMovementMemoryState {
  return {
    pickup: cloneRunnerMovementTicks(movement.pickup),
    delivery: cloneRunnerMovementTicks(movement.delivery),
    total: cloneRunnerMovementTicks(movement.total)
  };
}

function cloneRunnerMovementTicks(ticks: RunnerMovementTicksMemoryState): RunnerMovementTicksMemoryState {
  return {
    failedToPath: ticks.failedToPath,
    tired: ticks.tired,
    stuck: ticks.stuck
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

function calculateRequiredCarryParts(ept: number, roundTripTicks: number | null): number | null {
  const exact = calculateRequiredCarryPartsExact(ept, roundTripTicks);
  return exact === null ? null : Math.ceil(exact);
}

function calculateRequiredCarryPartsExact(ept: number, roundTripTicks: number | null): number | null {
  return roundTripTicks === null ? null : ept * roundTripTicks / 50;
}

function sumNullable(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function divide(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }

  return numerator / denominator;
}
