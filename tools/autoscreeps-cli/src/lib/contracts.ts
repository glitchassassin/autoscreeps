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
    pollIntervalMs: number;
    map: string | null;
    startGameTime: number | null;
    endGameTime: number | null;
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

export type RunMetrics = {
  users: Record<VariantRole, UserWorldStatus>;
  rooms: Record<VariantRole, RoomSummary>;
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
};

export type EventRecord = {
  timestamp: string;
  level: "info" | "error";
  event: string;
  message: string;
  data?: unknown;
};
