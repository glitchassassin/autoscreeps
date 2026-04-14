export type OwnedControllerSnapshot = {
  level: number;
  progress: number | null;
  progressTotal: number | null;
};

export type WorldSnapshot = {
  gameTime: number;
  primarySpawnName: string | null;
  primarySpawnSpawning: boolean | null;
  primaryRoomName: string | null;
  primaryRoomEnergyAvailable: number | null;
  primaryRoomEnergyCapacityAvailable: number | null;
  primaryController: OwnedControllerSnapshot | null;
  maxOwnedControllerLevel: number;
  totalCreeps: number;
  creepsByRole: Record<WorkerRole, number>;
};

export type SpawnDemandSummary = {
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
  demand: SpawnDemandSummary;
  request: SpawnRequestPlan | null;
};

export type ColonyPlan = {
  spawn: SpawnPlan;
};

export type TickResult = {
  world: WorldSnapshot;
  plan: ColonyPlan;
};
