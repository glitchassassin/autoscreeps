import crypto from "node:crypto";
import path from "node:path";
import { buildVariantPackage } from "./build.ts";
import type {
  EventRecord,
  RunFailureKind,
  RunDetails,
  RunIndexEntry,
  RunMetrics,
  RunRecord,
  RunSample,
  RunSampleRoomMetrics,
  RunTerminationReason,
  TelemetryHealth,
  TerminalOutcome,
  UserBadge,
  UserSampleMetrics,
  UserWorldStatus,
  VariantInput,
  VariantRecord,
  VariantRole
} from "./contracts.ts";
import { autoscreepsTelemetrySegmentId, inspectTelemetryByRole, type BotTelemetryInspection } from "./bot-telemetry.ts";
import { copyFileToScreepsService, resetPrivateServer, restartScreepsService } from "./docker.ts";
import { createWorkspaceSnapshot, parseVariantSource, resolveRepoRoot, withGitWorktree } from "./git.ts";
import { appendEvent, appendIndexEntry, appendRunSample, createRunWorkspace, writeMetrics, writeRunRecord, writeVariantRecords } from "./history.ts";
import { generateExperimentMap } from "./map-generator.ts";
import { buildRunSummaryMetrics, shouldCaptureRunSample } from "./run-samples.ts";
import { loadScenario } from "./scenario.ts";
import type { ScenarioConfig, ScenarioRoomMutation, TerminalCondition, TerminalConditionSet } from "./scenario.ts";
import { ScreepsApiClient, type StatsResponse } from "./screeps-api.ts";
import { ScreepsServerCli } from "./server-cli.ts";
import { timestamp } from "./utils.ts";
import { summarizeLiveRoom } from "./watch.ts";

export type DuelRunInput = {
  cwd: string;
  baseline: VariantInput;
  candidate: VariantInput;
  runWorkspace?: {
    runId: string;
    runDir: string;
  };
  suite?: RunRecord["suite"];
} & (
  | {
    scenarioPath: string;
  }
  | {
    scenario: {
      path: string;
      config: ScenarioConfig;
    };
  }
);

type PreparedVariant = {
  record: VariantRecord;
  modules: Record<string, string>;
};

const spectatorCredentials = {
  username: "spectator",
  password: "passw0rd"
};

const spectatorBadge: UserBadge = {
  type: 24,
  color1: "#0b132b",
  color2: "#3a86ff",
  color3: "#f1faee",
  param: 12,
  flip: false
};

const variantRoles: VariantRole[] = ["baseline", "candidate"];
const controllerLevels = [1, 2, 3, 4, 5, 6, 7, 8] as const;

type UserTerminalStats = UserSampleMetrics;

type TerminalEvaluation = {
  status: "won" | "failed";
  condition: TerminalCondition;
};

type PendingScenarioRoomMutation = {
  id: number;
  mutation: ScenarioRoomMutation;
};

type TelemetryInspectionsByRole = Record<VariantRole, BotTelemetryInspection>;

class TelemetryHealthError extends Error {
  readonly failureKind = "telemetry" as const;
  readonly role: VariantRole;
  readonly gameTime: number;
  readonly health: TelemetryHealth;

  constructor(role: VariantRole, gameTime: number, health: TelemetryHealth) {
    super(`Telemetry ${health.status} for ${role} at tick ${gameTime}: ${health.message ?? "unknown telemetry failure"}`);
    this.name = "TelemetryHealthError";
    this.role = role;
    this.gameTime = gameTime;
    this.health = health;
  }
}

export async function runDuelExperiment(input: DuelRunInput): Promise<RunDetails> {
  const repoRoot = await resolveRepoRoot(input.cwd);
  const scenario = "scenario" in input ? input.scenario : await loadScenario(input.scenarioPath);
  let runId: string;
  let runDir: string;
  let historyRoot: string | null = null;

  if (input.runWorkspace) {
    runId = input.runWorkspace.runId;
    runDir = input.runWorkspace.runDir;
  } else {
    const workspace = await createRunWorkspace(repoRoot);
    runId = workspace.runId;
    runDir = workspace.runDir;
    historyRoot = workspace.historyRoot;
  }
  const world = await resolveExperimentWorld({
    scenario: scenario.config,
    runDir
  });
  const runRecord: RunRecord = {
    id: runId,
    type: "duel",
    status: "running",
    failureKind: null,
    createdAt: timestamp(),
    startedAt: null,
    finishedAt: null,
    repoRoot,
    scenarioPath: path.relative(repoRoot, scenario.path),
    scenarioName: scenario.config.name,
    suite: input.suite,
    rooms: {
      baseline: world.rooms.baseline,
      candidate: world.rooms.candidate
    },
    run: {
      tickDuration: scenario.config.run.tickDuration,
      maxTicks: scenario.config.run.maxTicks,
      sampleEveryTicks: scenario.config.run.sampleEveryTicks,
      pollIntervalMs: scenario.config.run.pollIntervalMs,
      map: world.label,
      startGameTime: null,
      endGameTime: null,
      terminalConditions: scenario.config.run.terminalConditions ?? null,
      terminationReason: null
    },
    server: {
      httpUrl: scenario.config.server.httpUrl,
      cliHost: scenario.config.server.cliHost,
      cliPort: scenario.config.server.cliPort
    },
    error: null
  };

  await writeRunRecord(runDir, runRecord);
  await logEvent(runDir, "info", "run.created", "Created experiment run workspace.", { runId });

  let variants: Record<VariantRole, VariantRecord> | null = null;
  let metrics: RunMetrics | null = null;
  let cli: ScreepsServerCli | null = null;
  let simulationRunning = false;

  try {
    const preparedBaseline = await prepareVariant({
      repoRoot,
      runDir,
      role: "baseline",
      source: input.baseline.source,
      packagePath: input.baseline.packagePath
    });
    const preparedCandidate = await prepareVariant({
      repoRoot,
      runDir,
      role: "candidate",
      source: input.candidate.source,
      packagePath: input.candidate.packagePath
    });

    variants = {
      baseline: preparedBaseline.record,
      candidate: preparedCandidate.record
    };
    await writeVariantRecords(runDir, variants);
    await logEvent(runDir, "info", "variants.prepared", "Prepared source snapshots and builds for both variants.");

    runRecord.startedAt = timestamp();
    await writeRunRecord(runDir, runRecord);

    await logEvent(runDir, "info", "server.reset", "Resetting and restarting the private server stack.");
    await resetPrivateServer(repoRoot);

    const api = new ScreepsApiClient(runRecord.server.httpUrl);
    cli = new ScreepsServerCli({
      repoRoot,
      host: runRecord.server.cliHost,
      port: runRecord.server.cliPort
    });

    await Promise.all([api.waitForReady(), cli.waitForReady()]);
    await logEvent(runDir, "info", "server.ready", "Private server HTTP and CLI endpoints are ready.");

    await cli.pauseSimulation();
    await cli.setTickDuration(runRecord.run.tickDuration);
    if (world.import.kind === "map-id") {
      await logEvent(runDir, "info", "server.map", "Importing scenario map.", { map: world.label });
      await cli.importMap(world.import.value);
      await logEvent(runDir, "info", "server.restart", "Restarting the Screeps service after map import.");
      await restartScreepsService(repoRoot);
      await Promise.all([api.waitForReady(), cli.waitForReady()]);
      await cli.pauseSimulation();
      await cli.setTickDuration(runRecord.run.tickDuration);
    }

    if (world.import.kind === "map-file") {
      await logEvent(runDir, "info", "server.map", "Importing generated scenario map file.", {
        map: world.label,
        file: path.relative(repoRoot, world.import.hostFilePath)
      });
      await copyFileToScreepsService(repoRoot, world.import.hostFilePath, world.import.containerFilePath);
      await cli.importMapFile(world.import.containerFilePath);
      await logEvent(runDir, "info", "server.restart", "Restarting the Screeps service after map import.");
      await restartScreepsService(repoRoot);
      await Promise.all([api.waitForReady(), cli.waitForReady()]);
      await cli.pauseSimulation();
      await cli.setTickDuration(runRecord.run.tickDuration);
    }

    await api.registerUser({
      username: spectatorCredentials.username,
      password: spectatorCredentials.password,
      modules: { main: "" }
    });
    const spectatorSession = await api.signIn(spectatorCredentials.username, spectatorCredentials.password);
    await api.setBadge(spectatorSession, spectatorBadge);
    await logEvent(runDir, "info", "spectator.ready", "Created the spectator account and set its badge.", {
      username: spectatorCredentials.username
    });

    const credentials = {
      baseline: { username: "baseline", password: createPassword() },
      candidate: { username: "candidate", password: createPassword() }
    };

    await api.registerUser({
      username: credentials.baseline.username,
      password: credentials.baseline.password,
      modules: preparedBaseline.modules
    });
    await api.registerUser({
      username: credentials.candidate.username,
      password: credentials.candidate.password,
      modules: preparedCandidate.modules
    });
    await cli.setUserBanned(spectatorCredentials.username, true);
    await cli.setSpawnWhitelist([credentials.baseline.username, credentials.candidate.username]);
    await logEvent(runDir, "info", "users.registered", "Registered baseline and candidate users and applied the spawn whitelist.");

    const baselineSession = await api.signIn(credentials.baseline.username, credentials.baseline.password);
    const candidateSession = await api.signIn(credentials.candidate.username, credentials.candidate.password);
    await api.placeAutoSpawn(baselineSession, runRecord.rooms.baseline);
    await api.placeAutoSpawn(candidateSession, runRecord.rooms.candidate);
    await logEvent(runDir, "info", "rooms.claimed", "Placed auto spawns for the assigned rooms.", runRecord.rooms);

    runRecord.run.startGameTime = await cli.getGameTime();
    const targetGameTime = runRecord.run.startGameTime + runRecord.run.maxTicks;
    const sampleEveryTicks = scenario.config.run.sampleEveryTicks;
    const terminalOutcomes: Record<VariantRole, TerminalOutcome | null> = {
      baseline: null,
      candidate: null
    };
    const samples: RunSample[] = [];
    let pendingRoomMutations: PendingScenarioRoomMutation[] = scenario.config.roomMutations.map((mutation, index) => ({
      id: index + 1,
      mutation
    }));
    await writeRunRecord(runDir, runRecord);
    await cli.resumeSimulation();
    simulationRunning = true;
    await logEvent(runDir, "info", "simulation.running", "Simulation resumed.", {
      startGameTime: runRecord.run.startGameTime,
      targetGameTime
    });

    let lastReportedGameTime: number | null = null;
    let lastSampleGameTime: number | null = null;

    const waitResult = await waitForSimulation({
      cli,
      targetGameTime,
      pollIntervalMs: runRecord.run.pollIntervalMs,
      maxWallClockMs: scenario.config.run.maxWallClockMs,
      maxStalledPolls: scenario.config.run.maxStalledPolls,
      onSample: async ({ gameTime }) => {
        if (gameTime === lastReportedGameTime) {
          return;
        }

        lastReportedGameTime = gameTime;

        if (pendingRoomMutations.length > 0) {
          pendingRoomMutations = await applyScenarioRoomMutations({
            pendingRoomMutations,
            api,
            cli: cli!,
            credentials,
            rooms: runRecord.rooms,
            runDir,
            gameTime
          });
        }

        const captureSample = shouldCaptureRunSample(runRecord.run.startGameTime!, lastSampleGameTime, gameTime, sampleEveryTicks);
        let stats: StatsResponse | null = null;
        let telemetryByRole: TelemetryInspectionsByRole | null = null;
        let roomData: RunSample["rooms"] | null = null;

        if (runRecord.run.terminalConditions || captureSample) {
          stats = await api.getStats();
        }

        if (captureSample) {
          const [baselineTelemetry, candidateTelemetry, baselineRoomObjects, candidateRoomObjects] = await Promise.all([
            api.getMemorySegment(baselineSession, autoscreepsTelemetrySegmentId),
            api.getMemorySegment(candidateSession, autoscreepsTelemetrySegmentId),
            api.getRoomObjects(runRecord.rooms.baseline),
            api.getRoomObjects(runRecord.rooms.candidate)
          ]);
          telemetryByRole = inspectTelemetryByRole({
            baseline: baselineTelemetry,
            candidate: candidateTelemetry
          });
          await ensureTelemetryHealth(runDir, gameTime, telemetryByRole);
          roomData = {
            baseline: buildSampleRoomMetrics(runRecord.rooms.baseline, baselineRoomObjects),
            candidate: buildSampleRoomMetrics(runRecord.rooms.candidate, candidateRoomObjects)
          };
        }

        if (runRecord.run.terminalConditions) {
          for (const role of variantRoles) {
            if (terminalOutcomes[role] !== null) {
              continue;
            }

            const evaluation = evaluateTerminalConditions(
              runRecord.run.terminalConditions,
              summarizeUserTerminalStats(stats!, credentials[role].username)
            );
            if (!evaluation) {
              continue;
            }

            terminalOutcomes[role] = {
              status: evaluation.status,
              gameTime,
              condition: evaluation.condition
            };
            await logEvent(runDir, "info", "simulation.terminal", `Variant ${role} reached terminal status ${evaluation.status}.`, {
              role,
              gameTime,
              terminal: terminalOutcomes[role]
            });
          }
        }

        if (captureSample && stats) {
          const sample = buildRunSample(gameTime, stats, credentials, telemetryByRole, roomData);
          samples.push(sample);
          lastSampleGameTime = gameTime;
          await appendRunSample(runDir, sample);
        }

        await logEvent(runDir, "info", "simulation.progress", "Simulation advanced.", {
          gameTime,
          targetGameTime,
          completedTicks: Math.max(gameTime - runRecord.run.startGameTime!, 0),
          remainingTicks: Math.max(targetGameTime - gameTime, 0)
        });
      },
      isComplete: () => runRecord.run.terminalConditions !== null && variantRoles.every((role) => terminalOutcomes[role] !== null)
    });

    await cli.pauseSimulation();
    simulationRunning = false;
    const endGameTime = await cli.getGameTime();
    runRecord.run.endGameTime = endGameTime;
    runRecord.run.terminationReason = waitResult.reason;

    if (waitResult.reason === "all-bots-terminal") {
      await logEvent(runDir, "info", "simulation.completed", "Simulation stopped because all bots reached a terminal status.", {
        gameTime: runRecord.run.endGameTime,
        terminal: terminalOutcomes
      });
    } else {
      if (runRecord.run.terminalConditions) {
        for (const role of variantRoles) {
          if (terminalOutcomes[role] !== null) {
            continue;
          }

          terminalOutcomes[role] = {
            status: "timed_out",
            gameTime: endGameTime,
            condition: null
          };
        }
      }

      await logEvent(runDir, "info", "simulation.completed", "Simulation stopped after reaching the maximum tick budget.", {
        gameTime: runRecord.run.endGameTime,
        targetGameTime,
        terminal: terminalOutcomes
      });
    }

    const [finalStats, baselineWorldStatus, candidateWorldStatus, baselineRoomSummary, candidateRoomSummary] = await Promise.all([
      api.getStats(),
      api.getWorldStatus(baselineSession),
      api.getWorldStatus(candidateSession),
      api.summarizeRoom(runRecord.rooms.baseline),
      api.summarizeRoom(runRecord.rooms.candidate)
    ]);

    if (samples[samples.length - 1]?.gameTime !== endGameTime) {
      const [baselineTelemetry, candidateTelemetry, baselineRoomObjects, candidateRoomObjects] = await Promise.all([
        api.getMemorySegment(baselineSession, autoscreepsTelemetrySegmentId),
        api.getMemorySegment(candidateSession, autoscreepsTelemetrySegmentId),
        api.getRoomObjects(runRecord.rooms.baseline),
        api.getRoomObjects(runRecord.rooms.candidate)
      ]);
      const telemetryByRole = inspectTelemetryByRole({
        baseline: baselineTelemetry,
        candidate: candidateTelemetry
      });
      await ensureTelemetryHealth(runDir, endGameTime, telemetryByRole);
      const finalSample = buildRunSample(endGameTime, finalStats, credentials, telemetryByRole, {
        baseline: buildSampleRoomMetrics(runRecord.rooms.baseline, baselineRoomObjects),
        candidate: buildSampleRoomMetrics(runRecord.rooms.candidate, candidateRoomObjects)
      });
      samples.push(finalSample);
      lastSampleGameTime = endGameTime;
      await appendRunSample(runDir, finalSample);
    }

    metrics = {
      users: {
        baseline: buildUserRunMetrics(baselineWorldStatus, summarizeUserTerminalStats(finalStats, credentials.baseline.username), terminalOutcomes.baseline),
        candidate: buildUserRunMetrics(candidateWorldStatus, summarizeUserTerminalStats(finalStats, credentials.candidate.username), terminalOutcomes.candidate)
      },
      rooms: {
        baseline: baselineRoomSummary,
        candidate: candidateRoomSummary
      },
      summary: buildRunSummaryMetrics(samples, sampleEveryTicks)
    };
    await writeMetrics(runDir, metrics);
    await logEvent(runDir, "info", "metrics.captured", "Captured post-run metrics.");

    runRecord.status = "completed";
    runRecord.finishedAt = timestamp();
    await writeRunRecord(runDir, runRecord);
  } catch (error) {
    runRecord.status = "failed";
    runRecord.failureKind = classifyFailureKind(error);
    runRecord.finishedAt = timestamp();
    runRecord.error = error instanceof Error ? error.stack ?? error.message : String(error);
    await writeRunRecord(runDir, runRecord);
    await logEvent(runDir, "error", "run.failed", "Experiment run failed.", { error: runRecord.error });
  } finally {
    if (simulationRunning && cli) {
      try {
        await cli.pauseSimulation();
      } catch {
        // Best effort cleanup after a failed run.
      }
    }
  }

  if (historyRoot !== null) {
    const indexEntry: RunIndexEntry = {
      id: runRecord.id,
      type: runRecord.type,
      status: runRecord.status,
      createdAt: runRecord.createdAt,
      finishedAt: runRecord.finishedAt,
      scenarioName: runRecord.scenarioName,
      rooms: runRecord.rooms
    };
    await appendIndexEntry(historyRoot, indexEntry);
  }

  return {
    run: runRecord,
    variants,
    metrics
  };
}

async function prepareVariant(input: {
  repoRoot: string;
  runDir: string;
  role: VariantRole;
  source: string;
  packagePath: string;
}): Promise<PreparedVariant> {
  const parsedSource = parseVariantSource(input.source);

  if (parsedSource.kind === "workspace") {
    const patchPath = path.join(input.runDir, `${input.role}.patch`);
    const snapshot = await createWorkspaceSnapshot(input.repoRoot, patchPath);
    const { bundle, record } = await buildVariantPackage(input.repoRoot, input.packagePath, "auto");

    return {
      record: {
        role: input.role,
        snapshot,
        build: record
      },
      modules: {
        main: bundle
      }
    };
  }

  return await withGitWorktree(input.repoRoot, parsedSource.ref, async (worktreeRoot, resolvedSha) => {
    const { bundle, record } = await buildVariantPackage(worktreeRoot, input.packagePath, "ci");
    return {
      record: {
        role: input.role,
        snapshot: {
          kind: "git",
          source: parsedSource.raw,
          ref: parsedSource.ref,
          resolvedSha
        },
        build: record
      },
      modules: {
        main: bundle
      }
    };
  });
}

async function logEvent(runDir: string, level: EventRecord["level"], event: string, message: string, data?: unknown): Promise<void> {
  await appendEvent(runDir, {
    timestamp: timestamp(),
    level,
    event,
    message,
    data
  });
}

function createPassword(): string {
  return crypto.randomBytes(12).toString("hex");
}

type ResolvedExperimentWorld = {
  label: string | null;
  rooms: {
    baseline: string;
    candidate: string;
  };
  import:
    | { kind: "map-id"; value: string }
    | { kind: "map-file"; hostFilePath: string; containerFilePath: string };
};

async function resolveExperimentWorld(input: {
  scenario: Awaited<ReturnType<typeof loadScenario>>["config"];
  runDir: string;
}): Promise<ResolvedExperimentWorld> {
  const { scenario, runDir } = input;

  if (scenario.mapGenerator) {
    const generatedMap = await generateExperimentMap(scenario.mapGenerator, runDir);
    return {
      label: generatedMap.label,
      rooms: generatedMap.rooms,
      import: {
        kind: "map-file",
        hostFilePath: generatedMap.hostFilePath,
        containerFilePath: "/data/generated-map.json"
      }
    };
  }

  if (!scenario.map || !scenario.rooms) {
    throw new Error("Scenario is missing required map or rooms configuration.");
  }

  return {
    label: scenario.map,
    rooms: {
      baseline: scenario.rooms[0],
      candidate: scenario.rooms[1]
    },
    import: {
      kind: "map-id",
      value: scenario.map
    }
  };
}

async function applyScenarioRoomMutations(input: {
  pendingRoomMutations: PendingScenarioRoomMutation[];
  api: Pick<ScreepsApiClient, "getRoomObjects">;
  cli: Pick<ScreepsServerCli, "placeCompletedExtensionNearSpawn">;
  credentials: Record<VariantRole, { username: string }>;
  rooms: Record<VariantRole, string>;
  runDir: string;
  gameTime: number;
}): Promise<PendingScenarioRoomMutation[]> {
  if (input.pendingRoomMutations.length === 0) {
    return [];
  }

  const roomObjectsByRole: Partial<Record<VariantRole, Awaited<ReturnType<ScreepsApiClient["getRoomObjects"]>>>> = {};
  for (const role of new Set(input.pendingRoomMutations.map(({ mutation }) => mutation.role))) {
    roomObjectsByRole[role] = await input.api.getRoomObjects(input.rooms[role]);
  }

  const remaining: PendingScenarioRoomMutation[] = [];
  for (const pendingRoomMutation of input.pendingRoomMutations) {
    const mutation = pendingRoomMutation.mutation;
    const room = input.rooms[mutation.role];
    const roomObjects = roomObjectsByRole[mutation.role];
    if (!roomObjects) {
      remaining.push(pendingRoomMutation);
      continue;
    }

    const roomSummary = summarizeLiveRoom(room, roomObjects);
    if (roomSummary.controllerLevel === null || roomSummary.controllerLevel < mutation.level) {
      remaining.push(pendingRoomMutation);
      continue;
    }

    switch (mutation.type) {
      case "grant-completed-extension-on-controller-level": {
        const result = await input.cli.placeCompletedExtensionNearSpawn({
          username: input.credentials[mutation.role].username,
          room,
          targetCount: mutation.count,
          minControllerLevel: mutation.level
        });
        await logEvent(input.runDir, "info", "scenario.room-mutation.applied", "Applied scenario room mutation.", {
          gameTime: input.gameTime,
          mutationId: pendingRoomMutation.id,
          role: mutation.role,
          mutation,
          result
        });
        break;
      }
    }
  }

  return remaining;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function summarizeUserTerminalStats(stats: StatsResponse, username: string): UserTerminalStats {
  const user = stats.users.find((candidate) => candidate.username === username);
  const rcl = normalizeRclCounts(user?.rcl);

  return {
    ownedControllers: user?.rooms ?? 0,
    combinedRCL: user?.combinedRCL ?? 0,
    maxOwnedControllerLevel: findMaxOwnedControllerLevel(rcl),
    rcl
  };
}

function buildUserRunMetrics(
  worldStatus: UserWorldStatus,
  stats: UserTerminalStats,
  terminal: TerminalOutcome | null
): RunMetrics["users"][VariantRole] {
  return {
    status: worldStatus.status,
    ownedControllers: stats.ownedControllers,
    combinedRCL: stats.combinedRCL,
    maxOwnedControllerLevel: stats.maxOwnedControllerLevel,
    rcl: stats.rcl,
    terminal
  };
}

function buildRunSample(
  gameTime: number,
  stats: StatsResponse,
  credentials: Record<VariantRole, { username: string }>,
  telemetryData: TelemetryInspectionsByRole | null,
  roomData: Record<VariantRole, RunSampleRoomMetrics> | null
): RunSample {
  const sample: RunSample = {
    gameTime,
    users: {
      baseline: summarizeUserTerminalStats(stats, credentials.baseline.username),
      candidate: summarizeUserTerminalStats(stats, credentials.candidate.username)
    }
  };

  if (roomData) {
    sample.rooms = roomData;
  }

  if (telemetryData) {
    sample.telemetry = {
      baseline: telemetryData.baseline.snapshot,
      candidate: telemetryData.candidate.snapshot
    };
    sample.telemetryHealth = {
      baseline: telemetryData.baseline.health,
      candidate: telemetryData.candidate.health
    };
  }

  return sample;
}

async function ensureTelemetryHealth(
  runDir: string,
  gameTime: number,
  telemetryByRole: TelemetryInspectionsByRole
): Promise<void> {
  for (const role of variantRoles) {
    const inspection = telemetryByRole[role];
    if (inspection.health.status !== "parse_error" && inspection.health.status !== "runtime_error") {
      continue;
    }

    await logEvent(runDir, "error", "telemetry.failed", "Telemetry health check failed.", {
      role,
      gameTime,
      telemetry: inspection.health
    });
    throw new TelemetryHealthError(role, gameTime, inspection.health);
  }
}

function classifyFailureKind(error: unknown): RunFailureKind {
  return error instanceof TelemetryHealthError ? "telemetry" : "execution";
}

function buildSampleRoomMetrics(room: string, response: Awaited<ReturnType<ScreepsApiClient["getRoomObjects"]>>): RunSampleRoomMetrics {
  const summary = summarizeLiveRoom(room, response);

  return {
    controllerLevel: summary.controllerLevel,
    controllerProgress: summary.controllerProgress,
    controllerProgressTotal: summary.controllerProgressTotal,
    extensions: summary.extensions
  };
}

export function evaluateTerminalConditions(
  terminalConditions: TerminalConditionSet,
  stats: UserTerminalStats
): TerminalEvaluation | null {
  const failCondition = terminalConditions.fail.find((condition) => matchesTerminalCondition(condition, stats));
  if (failCondition) {
    return {
      status: "failed",
      condition: failCondition
    };
  }

  const winCondition = terminalConditions.win.find((condition) => matchesTerminalCondition(condition, stats));
  if (winCondition) {
    return {
      status: "won",
      condition: winCondition
    };
  }

  return null;
}

function matchesTerminalCondition(condition: TerminalCondition, stats: UserTerminalStats): boolean {
  switch (condition.type) {
    case "any-owned-controller-level-at-least":
      return stats.maxOwnedControllerLevel !== null && stats.maxOwnedControllerLevel >= condition.level;
    case "no-owned-controllers":
      return stats.ownedControllers === 0;
  }
}

function normalizeRclCounts(rcl: Record<string, number> | undefined): Record<string, number> {
  const normalized: Record<string, number> = {};

  for (const level of controllerLevels) {
    normalized[String(level)] = rcl?.[String(level)] ?? 0;
  }

  return normalized;
}

function findMaxOwnedControllerLevel(rcl: Record<string, number>): number | null {
  for (let index = controllerLevels.length - 1; index >= 0; index -= 1) {
    const level = controllerLevels[index]!;
    if ((rcl[String(level)] ?? 0) > 0) {
      return level;
    }
  }

  return null;
}

type WaitForTargetGameTimeOptions = {
  cli: Pick<ScreepsServerCli, "getGameTime">;
  targetGameTime: number;
  pollIntervalMs: number;
  maxWallClockMs: number;
  maxStalledPolls: number;
  onProgress?: (sample: { gameTime: number }) => Promise<void> | void;
};

type WaitForSimulationOptions = {
  cli: Pick<ScreepsServerCli, "getGameTime">;
  targetGameTime: number;
  pollIntervalMs: number;
  maxWallClockMs: number;
  maxStalledPolls: number;
  onSample?: (sample: { gameTime: number }) => Promise<void> | void;
  isComplete?: (sample: { gameTime: number }) => Promise<boolean> | boolean;
};

export type WaitForSimulationResult = {
  gameTime: number;
  reason: RunTerminationReason;
};

export async function waitForSimulation(options: WaitForSimulationOptions): Promise<WaitForSimulationResult> {
  const startedAt = Date.now();
  let lastGameTime: number | null = null;
  let stalledPolls = 0;

  while (true) {
    const gameTime = await options.cli.getGameTime();
    await options.onSample?.({ gameTime });

    if (await options.isComplete?.({ gameTime })) {
      return {
        gameTime,
        reason: "all-bots-terminal"
      };
    }

    if (gameTime >= options.targetGameTime) {
      return {
        gameTime,
        reason: "max-ticks"
      };
    }

    if (Date.now() - startedAt > options.maxWallClockMs) {
      throw new Error(`Timed out waiting for game time ${options.targetGameTime}; last observed tick was ${gameTime}.`);
    }

    if (lastGameTime !== null && gameTime <= lastGameTime) {
      stalledPolls += 1;
      if (stalledPolls >= options.maxStalledPolls) {
        throw new Error(`Game time stalled at ${gameTime} for ${stalledPolls} consecutive polls.`);
      }
    } else {
      stalledPolls = 0;
    }

    lastGameTime = gameTime;
    await delay(options.pollIntervalMs);
  }
}

export async function waitForTargetGameTime(options: WaitForTargetGameTimeOptions): Promise<void> {
  await waitForSimulation({
    ...options,
    onSample: async ({ gameTime }) => {
      if (gameTime < options.targetGameTime) {
        await options.onProgress?.({ gameTime });
      }
    }
  });
}
