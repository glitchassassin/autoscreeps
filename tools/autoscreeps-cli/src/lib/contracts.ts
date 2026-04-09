import type { TerminalCondition, TerminalConditionSet } from "./scenario.ts";

export type VariantRole = "baseline" | "candidate";

export type GitVariantSnapshot = {
  kind: "git";
  source: string;
  ref: string;
  resolvedSha: string;
};

export type WorkspaceVariantSnapshot = {
  kind: "workspace";
  source: "workspace";
  baseSha: string;
  branchName: string;
  dirty: boolean;
  patchFile: string | null;
  patchHash: string | null;
};

export type VariantSnapshot = GitVariantSnapshot | WorkspaceVariantSnapshot;

export type VariantBuildRecord = {
  packagePath: string;
  bundleHash: string;
  bundleSize: number;
  builtAt: string;
  nodeVersion: string;
};

export type VariantRecord = {
  role: VariantRole;
  snapshot: VariantSnapshot;
  build: VariantBuildRecord;
};

export type VariantInput = {
  source: string;
  packagePath: string;
};

export type RunStatus = "running" | "completed" | "failed";

export type SuiteCaseStatus = "pending" | RunStatus;

export type SuiteSource =
  | {
    kind: "manifest";
    path: string;
  }
  | {
    kind: "scenario";
    path: string;
  };

export type SuitePrimaryMetric =
  | "T_RCL2"
  | "T_RCL3"
  | "controllerProgressToRCL3Pct"
  | "spawnWaitingForSufficientEnergyPct"
  | "sourceCoveragePct"
  | "sourceUptimePct";

export type SuiteGates = {
  primaryMetrics: SuitePrimaryMetric[];
  training: {
    minImprovedPrimaryMetrics: number;
  };
  holdout: {
    maxRegressionPct: number;
  };
};

export type SuiteCaseRecord = {
  id: string;
  cohort: "train" | "holdout";
  caseIndex: number;
  tags: string[];
  scenarioPath: string;
  scenarioName: string | null;
  runId: string | null;
  status: SuiteCaseStatus;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type SuiteRecord = {
  id: string;
  type: "suite";
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  repoRoot: string;
  name: string;
  description?: string;
  source: SuiteSource;
  baseline: VariantInput;
  candidate: VariantInput;
  gates: SuiteGates;
  progress: {
    caseCount: number;
    completedCaseCount: number;
    failedCaseCount: number;
    currentCaseId: string | null;
    currentCaseRunId: string | null;
  };
  cases: SuiteCaseRecord[];
  error: string | null;
};

export type SuiteIndexEntry = {
  id: string;
  status: RunStatus;
  createdAt: string;
  finishedAt: string | null;
  name: string;
  progress: SuiteRecord["progress"];
};

export type RunTerminationReason = "all-bots-terminal" | "max-ticks";

export type TerminalOutcomeStatus = "won" | "failed" | "timed_out";

export type TerminalOutcome = {
  status: TerminalOutcomeStatus;
  gameTime: number;
  condition: TerminalCondition | null;
};

export type BotTelemetrySnapshot = {
  schemaVersion: number;
  gameTime: number;
  debugError?: string | null;
  colonyMode?: string;
  totalCreeps?: number;
  roleCounts?: Record<string, number>;
  spawn?: {
    queueDepth: number;
    isSpawning: boolean;
    nextRole: string | null;
    unmetDemand: Record<string, number>;
  };
  sources?: {
    total: number;
    staffed: number;
    assignments: Record<string, number>;
    harvestingStaffed: number;
    harvestingAssignments: Record<string, number>;
    activeHarvestingStaffed?: number;
    activeHarvestingAssignments?: Record<string, number>;
    adjacentHarvesters?: Record<string, number>;
    successfulHarvestTicks?: Record<string, number>;
    dropEnergy?: Record<string, number>;
    oldestDropAge?: Record<string, number>;
    overAssigned?: Record<string, number>;
    backlogEnergy?: number;
  };
  loop?: {
    phaseTicks?: Record<string, number>;
    actionAttempts?: Record<string, number>;
    actionSuccesses?: Record<string, number>;
    actionFailures?: Record<string, number>;
    targetFailures?: Record<string, number>;
    workingStateFlips?: Record<string, number>;
    cargoUtilizationTicks?: Record<string, number>;
    noTargetTicks?: Record<string, number>;
    withEnergyNoSpendTicks?: Record<string, number>;
    noEnergyAvailableTicks?: Record<string, number>;
    sourceAssignmentTicks?: Record<string, number>;
    sourceAdjacencyTicks?: Record<string, number>;
    samePositionTicks?: Record<string, number>;
    energyGained?: Record<string, number>;
    energySpent?: Record<string, number>;
    energySpentOnBuild?: number;
    energySpentOnUpgrade?: number;
    deliveredEnergyByTargetType?: Record<string, number>;
    transferSuccessByTargetType?: Record<string, number>;
    workerTaskSelections?: Record<string, number>;
    sourceDropPickupLatencyTotal?: number;
    sourceDropPickupLatencySamples?: number;
    pickupToSpendLatencyTotal?: number;
    pickupToSpendLatencySamples?: number;
  };
  creeps?: Record<string, {
    role: string;
    ticksSinceSuccess: number | null;
    lastSuccessfulAction: string | null;
    samePositionTicks: number;
    targetSwitches: number;
    lastTarget: string | null;
  }>;
  milestones?: Record<string, number | null>;
  counters?: Record<string, number>;
};

export type RunRecord = {
  id: string;
  type: "duel";
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  repoRoot: string;
  scenarioPath: string;
  scenarioName: string;
  suite?: {
    id: string;
    name: string;
    caseId: string;
    cohort: "train" | "holdout";
    caseIndex: number;
    caseCount: number;
  };
  rooms: {
    baseline: string;
    candidate: string;
  };
  run: {
    tickDuration: number;
    maxTicks: number;
    sampleEveryTicks: number;
    pollIntervalMs: number;
    map: string | null;
    startGameTime: number | null;
    endGameTime: number | null;
    terminalConditions: TerminalConditionSet | null;
    terminationReason: RunTerminationReason | null;
  };
  server: {
    httpUrl: string;
    cliHost: string;
    cliPort: number;
  };
  error: string | null;
};

export type UserWorldStatus = {
  status: string;
};

export type UserRunMetrics = UserWorldStatus & {
  ownedControllers: number;
  combinedRCL: number;
  maxOwnedControllerLevel: number | null;
  rcl: Record<string, number>;
  terminal: TerminalOutcome | null;
};

export type AuthSession = {
  username: string;
  password: string;
  token: string;
};

export type UserBadge = {
  type: number;
  color1: string;
  color2: string;
  color3: string;
  param: number;
  flip: boolean;
};

export type RoomSummary = {
  room: string;
  totalObjects: number;
  typeCounts: Record<string, number>;
  owners: Record<string, number>;
  controllerOwners: string[];
  spawnOwners: string[];
};

export type UserSampleMetrics = {
  ownedControllers: number;
  combinedRCL: number;
  maxOwnedControllerLevel: number | null;
  rcl: Record<string, number>;
};

export type RunSampleRoomMetrics = {
  controllerLevel: number | null;
  controllerProgress: number | null;
  controllerProgressTotal: number | null;
  extensions: number | null;
};

export type RunSample = {
  gameTime: number;
  users: Record<VariantRole, UserSampleMetrics>;
  rooms?: Record<VariantRole, RunSampleRoomMetrics>;
  telemetry?: Record<VariantRole, BotTelemetrySnapshot | null>;
};

export type UserRunSummaryMetrics = {
  sampleCount: number;
  firstSeenGameTime: number | null;
  controllerLevelMilestones: Record<string, number | null>;
  controllerProgressToRCL3Pct: number | null;
  maxCombinedRCL: number;
  maxOwnedControllers: number;
  firstExtensionTick: number | null;
  allRcl2ExtensionsTick: number | null;
  telemetrySampleCount: number;
  spawnWaitingForSufficientEnergyPct: number | null;
  sourceCoveragePct: number | null;
  sourceUptimePct: number | null;
  harvestingSourceCoveragePct: number | null;
  harvestingSourceUptimePct: number | null;
  activeHarvestingSourceCoveragePct: number | null;
  activeHarvestingSourceUptimePct: number | null;
};

export type RunSummaryMetrics = {
  sampleEveryTicks: number;
  users: Record<VariantRole, UserRunSummaryMetrics>;
};

export type RunMetrics = {
  users: Record<VariantRole, UserRunMetrics>;
  rooms: Record<VariantRole, RoomSummary>;
  summary?: RunSummaryMetrics;
};

export type RunIndexEntry = {
  id: string;
  type: "duel";
  status: RunStatus;
  createdAt: string;
  finishedAt: string | null;
  scenarioName: string;
  rooms: {
    baseline: string;
    candidate: string;
  };
};

export type RunDetails = {
  run: RunRecord;
  variants: Record<VariantRole, VariantRecord> | null;
  metrics: RunMetrics | null;
  samples?: RunSample[] | null;
};

export type SuiteCaseDetails = SuiteCaseRecord & {
  details: RunDetails | null;
};

export type SuiteDetails = {
  suite: SuiteRecord;
  cases: SuiteCaseDetails[];
};

export type EventRecord = {
  timestamp: string;
  level: "info" | "error";
  event: string;
  message: string;
  data?: unknown;
};
