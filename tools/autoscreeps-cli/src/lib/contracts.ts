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

export type RunStatus = "running" | "completed" | "failed";

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
  };
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

export type RunSample = {
  gameTime: number;
  users: Record<VariantRole, UserSampleMetrics>;
  telemetry?: Record<VariantRole, BotTelemetrySnapshot | null>;
};

export type UserRunSummaryMetrics = {
  sampleCount: number;
  firstSeenGameTime: number | null;
  controllerLevelMilestones: Record<string, number | null>;
  maxCombinedRCL: number;
  maxOwnedControllers: number;
  telemetrySampleCount: number;
  spawnIdlePct: number | null;
  sourceCoveragePct: number | null;
  sourceUptimePct: number | null;
  harvestingSourceCoveragePct: number | null;
  harvestingSourceUptimePct: number | null;
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

export type EventRecord = {
  timestamp: string;
  level: "info" | "error";
  event: string;
  message: string;
  data?: unknown;
};
