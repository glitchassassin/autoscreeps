export type ColonyMode = "bootstrap" | "recovery" | "normal";

export type OwnedControllerSnapshot = {
  level: number;
  progress: number | null;
  progressTotal: number | null;
};

export type CreepSnapshot = {
  name: string;
  role: WorkerRole;
  homeRoom: string;
  roomName: string;
  working: boolean;
  activeWorkParts: number;
  activeCarryParts: number;
  storeEnergy: number;
  freeCapacity: number;
  bodyCost: number;
};

export type SourceSnapshot = {
  sourceId: string;
  roomName: string;
  x: number;
  y: number;
  energy: number;
  energyCapacity: number;
  ticksToRegeneration: number | null;
  pathLengthToPrimarySpawn: number | null;
};

export type WorldSnapshot = {
  gameTime: number;
  primarySpawnName: string | null;
  primarySpawnConstructionSiteCount: number;
  primarySpawnSpawning: boolean | null;
  primaryRoomName: string | null;
  primaryRoomEnergyAvailable: number | null;
  primaryRoomEnergyCapacityAvailable: number | null;
  primarySpawnToControllerPathLength: number | null;
  primaryController: OwnedControllerSnapshot | null;
  maxOwnedControllerLevel: number;
  totalCreeps: number;
  creepsByRole: Record<WorkerRole, number>;
  creeps: CreepSnapshot[];
  sources: SourceSnapshot[];
};

export type SitePlan = {
  siteId: string;
  sourceId: string;
  roomName: string;
  theoreticalGrossEpt: number;
  plannedGrossEpt: number;
  assignedWorkParts: number;
  assignedHarvesterNames: string[];
};

export type CreepPlan = {
  creepName: string;
  role: WorkerRole;
  sourceId: string | null;
};

export type SpawnDemandInputs = {
  harvest: {
    requiredWorkParts: number;
    coveredWorkParts: number;
    plannedWorkPartsPerCreep: number;
    targetCount: number;
    coverage: number;
  };
  haul: {
    requiredCarryParts: number;
    coveredCarryParts: number;
    plannedCarryPartsPerCreep: number;
    targetCount: number;
    coverage: number;
  };
  upgrade: {
    surplusBudgetEpt: number;
    coveredNetEpt: number;
    plannedNetEptPerCreep: number;
    targetCount: number;
    coverage: number;
  };
};

export type SpawnDemandSummary = {
  inputs: SpawnDemandInputs;
  unmetDemand: Record<WorkerRole, number>;
  nextRole: WorkerRole | null;
  totalUnmetDemand: number;
};

export type SpawnRequestPlan = {
  spawnName: string;
  body: BodyPartConstant[];
  memory: CreepMemory;
  name: string;
};

export type SpawnPlan = {
  bootstrapRoomName: string | null;
  demand: SpawnDemandSummary;
  request: SpawnRequestPlan | null;
};

export type ColonyPlan = {
  mode: ColonyMode;
  spawn: SpawnPlan;
  sites: SitePlan[];
  creeps: Record<string, CreepPlan>;
};

export type ExecutionSummary = {
  harvestedEnergyBySourceId: Record<string, number>;
};

export type TickResult = {
  world: WorldSnapshot;
  plan: ColonyPlan;
  execution: ExecutionSummary;
};
