import type { TerminalCondition, TerminalConditionSet } from "./scenario.ts";

export type VariantRole = "baseline" | "candidate";
export type RoleRecord<T> = Partial<Record<VariantRole, T>>;

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

export type RunType = "single" | "duel";
export type RunStatus = "running" | "completed" | "failed";
export type RunFailureKind = "report" | "bot" | "scenario" | "execution";

export type BotReportHealth = {
  status: "ok" | "missing" | "parse_error";
  message: string | null;
};

export type BotReport = {
  schemaVersion: number;
  gameTime: number;
  errors: string[];
  telemetry?: unknown;
};

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

export type SuiteCaseRecord = {
  id: string;
  cohort: "train" | "holdout";
  caseIndex: number;
  tags: string[];
  scenarioPath: string;
  scenarioName: string | null;
  runId: string | null;
  status: SuiteCaseStatus;
  failureKind?: RunFailureKind | null;
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
  mode: RunType;
  source: SuiteSource;
  baseline: VariantInput;
  candidate?: VariantInput;
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

export type RunTerminationReason = "all-bots-terminal" | "participant-failed" | "max-ticks";
export type TerminalOutcomeStatus = "passed" | "failed";
export type TerminalOutcomeReason = "win" | "fail" | "timeout";

export type TerminalOutcome = {
  status: TerminalOutcomeStatus;
  reason: TerminalOutcomeReason;
  gameTime: number;
  condition: TerminalCondition | null;
};

export type RunRecord = {
  id: string;
  type: RunType;
  status: RunStatus;
  failureKind?: RunFailureKind | null;
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
  rooms: RoleRecord<string>;
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

export type RunSampleRoomImage = {
  room: string;
  path: string;
  width: number;
  height: number;
  scale: number;
  objects: number;
};

export type RunSample = {
  gameTime: number;
  users: RoleRecord<UserSampleMetrics>;
  rooms?: RoleRecord<RunSampleRoomMetrics>;
  roomImages?: RoleRecord<RunSampleRoomImage>;
  reports?: RoleRecord<BotReport | null>;
};

export type CpuRunSummaryMetrics = {
  observedTickCount: number;
  avgUsedPerTick: number | null;
  peakUsedPerTick: number | null;
  topLevelAvgPerTick: Record<string, number>;
  topLevelPeakPerTick: Record<string, number>;
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
  cpu?: CpuRunSummaryMetrics;
};

export type RunSummaryMetrics = {
  sampleEveryTicks: number;
  users: RoleRecord<UserRunSummaryMetrics>;
};

export type RunMetrics = {
  users: RoleRecord<UserRunMetrics>;
  rooms: RoleRecord<RoomSummary>;
  summary?: RunSummaryMetrics;
};

export type RunIndexEntry = {
  id: string;
  type: RunType;
  status: RunStatus;
  createdAt: string;
  finishedAt: string | null;
  scenarioName: string;
  rooms: RoleRecord<string>;
};

export type RunDetails = {
  run: RunRecord;
  variants: RoleRecord<VariantRecord> | null;
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
