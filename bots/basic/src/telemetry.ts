import { summarizeSpawnDemand } from "./spawn";
import { ensureTelemetryState, observeTelemetryTick } from "./telemetry-state";

export const telemetrySegmentId = 42;
export const telemetrySampleEveryTicks = 25;
export const telemetrySchemaVersion = 6;

export type BotTelemetrySnapshot = {
  schemaVersion: number;
  gameTime: number;
  debugError?: string | null;
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
    harvestedEnergy: number;
    activeHarvestingStaffed: number;
    activeHarvestingAssignments: Record<string, number>;
    adjacentHarvesters: Record<string, number>;
    successfulHarvestTicks: Record<string, number>;
    dropEnergy: Record<string, number>;
    oldestDropAge: Record<string, number>;
    overAssigned: Record<string, number>;
    backlogEnergy: number;
  };
  loop: TelemetryLoopState;
  creeps: Record<string, {
    role: string;
    ticksSinceSuccess: number | null;
    lastSuccessfulAction: string | null;
    samePositionTicks: number;
    targetSwitches: number;
    lastTarget: string | null;
  }>;
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
  observeTelemetryTick(primarySpawn);
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

  try {
    telemetryState.debugError = null;
    RawMemory.segments[telemetrySegmentId] = JSON.stringify(createTelemetrySnapshot(primarySpawn, telemetryState));
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    telemetryState.debugError = message;
    RawMemory.segments[telemetrySegmentId] = JSON.stringify({
      schemaVersion: telemetrySchemaVersion,
      gameTime: Game.time,
      debugError: message
    });
  }
}

export function createTelemetrySnapshot(
  primarySpawn: StructureSpawn | null,
  telemetryState: TelemetryMemoryState = ensureTelemetryState()
): BotTelemetrySnapshot {
  const demand = summarizeSpawnDemand(primarySpawn?.room ?? null);
  const roleCounts = countRoles();
  const totalCreeps = Object.keys(Game.creeps).length;

  return {
    schemaVersion: telemetrySchemaVersion,
    gameTime: Game.time,
    debugError: telemetryState.debugError ?? null,
    colonyMode: determineColonyMode(primarySpawn, totalCreeps),
    totalCreeps,
    roleCounts,
    spawn: {
      queueDepth: demand.totalUnmetDemand,
      isSpawning: Boolean(primarySpawn?.spawning),
      nextRole: demand.nextRole,
      unmetDemand: demand.unmetDemand
    },
    sources: summarizeSourceStaffing(telemetryState),
    loop: telemetryState.loop ?? emptyLoopState(),
    creeps: summarizeCreepDiagnostics(telemetryState),
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
    courier: 0,
    worker: 0
  };

  for (const creep of Object.values(Game.creeps)) {
    counts[creep.memory.role] += 1;
  }

  return counts;
}

function summarizeSourceStaffing(telemetryState: TelemetryMemoryState): BotTelemetrySnapshot["sources"] {
  const assignments: Record<string, number> = {};
  const harvestingAssignments: Record<string, number> = {};
  const activeHarvestingAssignments: Record<string, number> = {};
  const adjacentHarvesters: Record<string, number> = {};
  const dropEnergy: Record<string, number> = {};
  const oldestDropAge: Record<string, number> = {};
  const overAssigned: Record<string, number> = {};
  const successfulHarvestTicks = collectSuccessfulHarvestTicks(telemetryState);
  const harvestedEnergy = collectHarvestedEnergy(telemetryState);
  const sourcesById = new Map<string, Source>();
  let backlogEnergy = 0;
  let total = 0;

  for (const room of Object.values(Game.rooms)) {
    const sources = room.find(FIND_SOURCES);
    for (const source of sources) {
      total += 1;
      sourcesById.set(source.id, source);
      dropEnergy[source.id] = 0;
      oldestDropAge[source.id] = 0;
      overAssigned[source.id] = 0;
      adjacentHarvesters[source.id] = 0;
    }

    const drops = room.find(FIND_DROPPED_RESOURCES, {
      filter: (resource) => resource.resourceType === RESOURCE_ENERGY && resource.amount > 0
    });
    for (const drop of drops) {
      const source = sources.find((candidate) => positionsAreNear(drop.pos, candidate.pos));
      if (!source) {
        continue;
      }

      dropEnergy[source.id] = (dropEnergy[source.id] ?? 0) + drop.amount;
      backlogEnergy += drop.amount;
      const firstSeenTick = Memory.telemetry?.drops?.[drop.id]?.firstSeenTick;
      if (typeof firstSeenTick === "number") {
        oldestDropAge[source.id] = Math.max(oldestDropAge[source.id] ?? 0, Game.time - firstSeenTick);
      }
    }
  }

  for (const creep of Object.values(Game.creeps)) {
    const sourceId = creep.memory.sourceId;
    if (!sourceId) {
      continue;
    }

    assignments[sourceId] = (assignments[sourceId] ?? 0) + 1;

    if (!creep.memory.working) {
      harvestingAssignments[sourceId] = (harvestingAssignments[sourceId] ?? 0) + 1;

      const source = sourcesById.get(sourceId);
      if (source && isAdjacentToSource(creep, source)) {
        activeHarvestingAssignments[sourceId] = (activeHarvestingAssignments[sourceId] ?? 0) + 1;
        if (creep.memory.role === "harvester") {
          adjacentHarvesters[sourceId] = (adjacentHarvesters[sourceId] ?? 0) + 1;
        }
      }
    }
  }

  for (const [sourceId, source] of sourcesById.entries()) {
    overAssigned[sourceId] = Math.max((assignments[sourceId] ?? 0) - countAvailableAdjacentTiles(source), 0);
  }

  return {
    total,
    staffed: Object.keys(assignments).length,
    assignments,
    harvestingStaffed: Object.keys(harvestingAssignments).length,
    harvestingAssignments,
    harvestedEnergy,
    activeHarvestingStaffed: Object.keys(activeHarvestingAssignments).length,
    activeHarvestingAssignments,
    adjacentHarvesters,
    successfulHarvestTicks,
    dropEnergy,
    oldestDropAge,
    overAssigned,
    backlogEnergy
  };
}

function collectSuccessfulHarvestTicks(telemetryState: TelemetryMemoryState): Record<string, number> {
  const ticks: Record<string, number> = {};

  if (!telemetryState.sources) {
    return ticks;
  }

  for (const [sourceId, state] of Object.entries(telemetryState.sources)) {
    ticks[sourceId] = state.successfulHarvestTicks ?? 0;
  }

  return ticks;
}

function collectHarvestedEnergy(telemetryState: TelemetryMemoryState): number {
  let total = 0;

  for (const state of Object.values(telemetryState.sources ?? {})) {
    total += state.harvestedEnergy ?? 0;
  }

  return total;
}

function summarizeCreepDiagnostics(telemetryState: TelemetryMemoryState): BotTelemetrySnapshot["creeps"] {
  const diagnostics: BotTelemetrySnapshot["creeps"] = {};

  for (const [name, state] of Object.entries(telemetryState.creeps ?? {})) {
    diagnostics[name] = {
      role: state.role,
      ticksSinceSuccess: state.lastSuccessfulActionTick === null ? null : Game.time - state.lastSuccessfulActionTick,
      lastSuccessfulAction: state.lastSuccessfulAction,
      samePositionTicks: state.samePositionTicks,
      targetSwitches: state.targetSwitches,
      lastTarget: state.lastTarget
    };
  }

  return diagnostics;
}

function emptyLoopState(): TelemetryLoopState {
  return {
    phaseTicks: {},
    actionAttempts: {},
    actionSuccesses: {},
    actionFailures: {},
    targetFailures: {},
    workingStateFlips: {},
    cargoUtilizationTicks: {},
    noTargetTicks: {},
    withEnergyNoSpendTicks: {},
    noEnergyAvailableTicks: {},
    sourceAssignmentTicks: {},
    sourceAdjacencyTicks: {},
        samePositionTicks: {},
        energyGained: {},
        energySpent: {},
        energySpentOnBuild: 0,
        energySpentOnUpgrade: 0,
        deliveredEnergyByTargetType: {},
    transferSuccessByTargetType: {},
    workerTaskSelections: {},
    sourceDropPickupLatencyTotal: 0,
    sourceDropPickupLatencySamples: 0,
    pickupToSpendLatencyTotal: 0,
    pickupToSpendLatencySamples: 0,
    spawnObservedTicks: 0,
    spawnIdleTicks: 0,
    spawnSpawningTicks: 0,
    spawnWaitingForSufficientEnergyTicks: 0,
    sourceObservedTicks: 0,
    sourceTotalTicks: 0,
    sourceStaffedTicks: 0,
    sourceFullyStaffedTicks: 0,
    harvestingSourceStaffedTicks: 0,
    harvestingSourceFullyStaffedTicks: 0,
    activeHarvestingSourceStaffedTicks: 0,
    activeHarvestingSourceFullyStaffedTicks: 0
  };
}

function isAdjacentToSource(creep: Creep, source: Source): boolean {
  return positionsAreNear(creep.pos, source.pos);
}

function positionsAreNear(position: RoomPosition | undefined, target: RoomPosition | undefined): boolean {
  if (!position || !target) {
    return false;
  }

  if (typeof position.isNearTo === "function") {
    return position.isNearTo(target);
  }

  if (position.roomName !== target.roomName) {
    return false;
  }

  return Math.max(Math.abs(position.x - target.x), Math.abs(position.y - target.y)) <= 1;
}

function countAvailableAdjacentTiles(source: Source): number {
  const terrain = Game.rooms[source.pos.roomName]?.getTerrain();
  if (!terrain) {
    return 0;
  }

  let total = 0;
  for (let y = source.pos.y - 1; y <= source.pos.y + 1; y += 1) {
    for (let x = source.pos.x - 1; x <= source.pos.x + 1; x += 1) {
      if (x === source.pos.x && y === source.pos.y) {
        continue;
      }
      if (x < 0 || x > 49 || y < 0 || y > 49) {
        continue;
      }
      if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
        total += 1;
      }
    }
  }

  return total;
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
