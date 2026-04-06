let fallbackTelemetryState: TelemetryMemoryState | null = null;

export function ensureTelemetryState(): TelemetryMemoryState {
  if (typeof Memory === "undefined") {
    fallbackTelemetryState ??= {
      creepDeaths: 0,
      firstOwnedSpawnTick: null,
      rcl2Tick: null,
      rcl3Tick: null,
      loop: createLoopState(),
      creeps: {},
      drops: {},
      sources: {}
    };

    return fallbackTelemetryState;
  }

  Memory.telemetry ??= {
    creepDeaths: 0,
    firstOwnedSpawnTick: null,
    rcl2Tick: null,
    rcl3Tick: null,
    loop: createLoopState(),
    creeps: {},
    drops: {},
    sources: {}
  };

  Memory.telemetry.loop ??= createLoopState();
  Memory.telemetry.creeps ??= {};
  Memory.telemetry.drops ??= {};
  Memory.telemetry.sources ??= {};

  return Memory.telemetry;
}

export function recordCreepDeath(count = 1): void {
  const state = ensureTelemetryState();
  state.creepDeaths += count;
}

export function recordTelemetryAction(
  creep: Creep,
  action: TelemetryActionName,
  result: ScreepsReturnCode,
  options: {
    targetType?: string;
    targetKey?: string;
    sourceId?: string;
    dropId?: string;
  } = {}
): void {
  const state = ensureTelemetryState();
  const loop = state.loop!;
  const creepState = ensureCreepRuntimeState(resolveCreepName(creep), creep, state);
  const role = creep.memory.role;

  increment(loop.actionAttempts, `${role}.${action}`);
  updateTargetSelection(creepState, loop, role, options.targetKey ?? null);

  if (result === OK) {
    increment(loop.actionSuccesses, `${role}.${action}`);
    creepState.lastSuccessfulActionTick = Game.time;
    creepState.lastSuccessfulAction = action;

    if (action === "transfer" && options.targetType) {
      increment(loop.transferSuccessByTargetType, options.targetType);
    }

    if (action === "harvest" && options.sourceId) {
      const sourceState = ensureSourceRuntimeState(options.sourceId, state);
      sourceState.successfulHarvestTicks += 1;
    }

    if (action === "pickup") {
      creepState.lastPickupTick = Game.time;
      if (options.dropId) {
        const dropState = state.drops?.[options.dropId];
        if (dropState && !dropState.pickupLatencyRecorded) {
          loop.sourceDropPickupLatencyTotal += Game.time - dropState.firstSeenTick;
          loop.sourceDropPickupLatencySamples += 1;
          dropState.pickupLatencyRecorded = true;
        }
      }
    }

    if ((action === "build" || action === "upgrade") && creepState.lastPickupTick !== null) {
      loop.pickupToSpendLatencyTotal += Game.time - creepState.lastPickupTick;
      loop.pickupToSpendLatencySamples += 1;
      creepState.lastPickupTick = null;
    }
  } else {
    increment(loop.actionFailures, `${role}.${action}.${result}`);
  }

  creepState.currentAction = {
    action,
    result,
    targetType: options.targetType,
    targetKey: options.targetKey,
    sourceId: options.sourceId,
    dropId: options.dropId
  };
}

export function recordTelemetryTargetFailure(creep: Creep, reason: string): void {
  const state = ensureTelemetryState();
  const loop = state.loop!;
  const role = creep.memory.role;

  increment(loop.targetFailures, `${role}.${reason}`);

  if (reason.startsWith("no_")) {
    increment(loop.noTargetTicks, role);
  }
  if (reason === "no_source" || reason === "no_source_drop") {
    increment(loop.noEnergyAvailableTicks, role);
  }
}

export function recordTelemetryTaskSelection(role: string, task: string): void {
  const state = ensureTelemetryState();
  increment(state.loop!.workerTaskSelections, `${role}.${task}`);
}

export function observeTelemetryTick(): void {
  const state = ensureTelemetryState();
  syncDropRuntimeState(state);
  observeCreeps(state);
  pruneTelemetryState(state);
}

function observeCreeps(state: TelemetryMemoryState): void {
  const loop = state.loop!;

  for (const [creepName, creep] of Object.entries(Game.creeps)) {
    const creepState = ensureCreepRuntimeState(creepName, creep, state);
    const role = creep.memory.role;
    const energy = getCreepEnergy(creep);
    const previousEnergy = creepState.lastEnergy;
    const energyDelta = energy - previousEnergy;

    if (positionsMatch(creep.pos, creepState.lastPos)) {
      creepState.samePositionTicks += 1;
      increment(loop.samePositionTicks, role);
    } else {
      creepState.samePositionTicks = 0;
    }

    if (energy > 0) {
      increment(loop.cargoUtilizationTicks, role);
    }

    if (creepState.lastWorking !== creep.memory.working) {
      increment(loop.workingStateFlips, `${role}.${creepState.lastWorking ? "working_to_gather" : "gather_to_work"}`);
    }

    if (role === "harvester" && creep.memory.sourceId) {
      increment(loop.sourceAssignmentTicks, role);
      const source = Game.getObjectById(creep.memory.sourceId);
      if (source && positionsAreNear(creep.pos, source.pos)) {
        increment(loop.sourceAdjacencyTicks, role);
      }
    }

    if (creep.memory.working && energy > 0 && (!creepState.currentAction || !isSpendAction(creepState.currentAction.action) || creepState.currentAction.result !== OK)) {
      increment(loop.withEnergyNoSpendTicks, role);
    }

    if (energyDelta > 0) {
      add(loop.energyGained, role, energyDelta);
    }
    if (energyDelta < 0) {
      add(loop.energySpent, role, Math.abs(energyDelta));
    }

    if (creepState.currentAction?.result === OK) {
      const action = creepState.currentAction.action;
      const spentEnergy = Math.max(previousEnergy - energy, 0);

      if (action === "transfer" && creepState.currentAction.targetType && spentEnergy > 0) {
        add(loop.deliveredEnergyByTargetType, creepState.currentAction.targetType, spentEnergy);
      }
      if (action === "build" && spentEnergy > 0) {
        loop.energySpentOnBuild += spentEnergy;
      }
      if (action === "upgrade" && spentEnergy > 0) {
        loop.energySpentOnUpgrade += spentEnergy;
      }
    }

    increment(loop.phaseTicks, `${role}.${resolvePhase(creepState, creep)}`);

    creepState.lastPos = {
      x: creep.pos.x,
      y: creep.pos.y,
      roomName: creep.pos.roomName
    };
    creepState.lastEnergy = energy;
    creepState.lastWorking = creep.memory.working;
    delete creepState.currentAction;
  }
}

function syncDropRuntimeState(state: TelemetryMemoryState): void {
  const nextSeen = new Set<string>();

  for (const room of Object.values(Game.rooms)) {
    const sources = room.find(FIND_SOURCES);
    const drops = room.find(FIND_DROPPED_RESOURCES, {
      filter: (resource) => resource.resourceType === RESOURCE_ENERGY && resource.amount > 0
    });

    for (const drop of drops) {
      if (!sources.some((source) => positionsAreNear(drop.pos, source.pos))) {
        continue;
      }

      nextSeen.add(drop.id);
      state.drops![drop.id] ??= {
        firstSeenTick: Game.time,
        sourceId: nearestSourceId(drop.pos, sources),
        pickupLatencyRecorded: false
      };
    }
  }

  for (const dropId of Object.keys(state.drops!)) {
    if (!nextSeen.has(dropId)) {
      delete state.drops![dropId];
    }
  }
}

function pruneTelemetryState(state: TelemetryMemoryState): void {
  for (const creepName of Object.keys(state.creeps!)) {
    if (!Game.creeps[creepName]) {
      delete state.creeps![creepName];
    }
  }
}

function ensureCreepRuntimeState(creepName: string, creep: Creep, state: TelemetryMemoryState): TelemetryCreepRuntimeState {
  state.creeps![creepName] ??= {
    role: creep.memory.role,
    samePositionTicks: 0,
    lastEnergy: getCreepEnergy(creep),
    lastWorking: creep.memory.working,
    lastSuccessfulActionTick: null,
    lastSuccessfulAction: null,
    lastTarget: null,
    targetSwitches: 0,
    lastPickupTick: null
  };

  const creepState = state.creeps![creepName]!;
  creepState.role = creep.memory.role;
  return creepState;
}

function ensureSourceRuntimeState(sourceId: string, state: TelemetryMemoryState): TelemetrySourceRuntimeState {
  state.sources![sourceId] ??= {
    successfulHarvestTicks: 0
  };

  return state.sources![sourceId]!;
}

function resolveCreepName(creep: Creep): string {
  if (typeof creep.name === "string" && creep.name.length > 0) {
    return creep.name;
  }

  for (const [name, candidate] of Object.entries(Game.creeps)) {
    if (candidate === creep) {
      return name;
    }
  }

  return `${creep.memory.role}:${creep.pos.roomName}:${creep.pos.x},${creep.pos.y}`;
}

function createLoopState(): TelemetryLoopState {
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
    pickupToSpendLatencySamples: 0
  };
}

function updateTargetSelection(
  creepState: TelemetryCreepRuntimeState,
  loop: TelemetryLoopState,
  role: string,
  targetKey: string | null
): void {
  if (!targetKey) {
    return;
  }

  if (creepState.lastTarget !== null && creepState.lastTarget !== targetKey) {
    creepState.targetSwitches += 1;
    increment(loop.targetFailures, `${role}.target_switch`);
  }
  creepState.lastTarget = targetKey;
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function add(record: Record<string, number>, key: string, amount: number): void {
  record[key] = (record[key] ?? 0) + amount;
}

function positionsMatch(position: RoomPosition, previous: TelemetryCreepRuntimeState["lastPos"]): boolean {
  return Boolean(previous && previous.x === position.x && previous.y === position.y && previous.roomName === position.roomName);
}

function positionsAreNear(position: RoomPosition, target: RoomPosition): boolean {
  return Math.max(Math.abs(position.x - target.x), Math.abs(position.y - target.y)) <= 1 && position.roomName === target.roomName;
}

function nearestSourceId(position: RoomPosition, sources: Source[]): string | null {
  for (const source of sources) {
    if (positionsAreNear(position, source.pos)) {
      return source.id;
    }
  }

  return null;
}

function isSpendAction(action: string): boolean {
  return action === "build" || action === "upgrade";
}

function getCreepEnergy(creep: Creep): number {
  return typeof creep.store?.[RESOURCE_ENERGY] === "number" ? creep.store[RESOURCE_ENERGY] : 0;
}

function resolvePhase(creepState: TelemetryCreepRuntimeState, creep: Creep): string {
  if (creepState.currentAction?.result === OK) {
    return creepState.currentAction.action;
  }

  return creep.memory.working ? "working" : "gathering";
}
