import crypto from "node:crypto";
import path from "node:path";
import { buildVariantPackage } from "./build.ts";
import type {
  AuthSession,
  BotReportHealth,
  EventRecord,
  RoleRecord,
  RunDetails,
  RunFailureKind,
  RunIndexEntry,
  RunMetrics,
  RunRecord,
  RunSample,
  RunSampleRoomMetrics,
  RunTerminationReason,
  TerminalOutcome,
  UserBadge,
  UserRunMetrics,
  UserSampleMetrics,
  UserWorldStatus,
  VariantInput,
  VariantRecord,
  VariantRole
} from "./contracts.ts";
import { autoscreepsReportSegmentId, inspectReportsByRole, type BotReportInspection } from "./bot-telemetry.ts";
import { resetPrivateServer, restartScreepsService, startScreepsService, stopScreepsService } from "./docker.ts";
import { createWorkspaceSnapshot, parseVariantSource, resolveRepoRoot, withGitWorktree } from "./git.ts";
import { appendEvent, appendIndexEntry, appendRunSample, createRunWorkspace, writeMetrics, writeRunRecord, writeVariantRecords } from "./history.ts";
import { generateExperimentMap } from "./map-generator.ts";
import { importMapFileOffline } from "./offline-map-import.ts";
import { buildRunSummaryMetrics, shouldCaptureRunSample } from "./run-samples.ts";
import { loadScenario } from "./scenario.ts";
import type { ScenarioConfig, ScenarioRoomMutation, TerminalCondition, TerminalConditionSet } from "./scenario.ts";
import { ScreepsApiClient, type RoomObjectsResponse, type StatsResponse } from "./screeps-api.ts";
import { ScreepsServerCli } from "./server-cli.ts";
import { timestamp } from "./utils.ts";
import { summarizeLiveRoom } from "./watch.ts";

export type SingleRunInput = {
  cwd: string;
  variant: VariantInput;
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

type ExperimentRunInput = {
  cwd: string;
  baseline: VariantInput;
  candidate?: VariantInput;
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

const singleVariantRoles: VariantRole[] = ["baseline"];
const duelVariantRoles: VariantRole[] = ["baseline", "candidate"];
const controllerLevels = [1, 2, 3, 4, 5, 6, 7, 8] as const;

type UserTerminalStats = UserSampleMetrics & {
  ownedStructureCounts: Record<string, number>;
};

type TerminalEvaluation = {
  status: "passed" | "failed";
  reason: "win" | "fail";
  condition: TerminalCondition;
};

type PendingScenarioRoomMutation = {
  id: number;
  mutation: ScenarioRoomMutation;
};

type ReportInspectionsByRole = RoleRecord<BotReportInspection>;

class ReportHealthError extends Error {
  readonly failureKind = "report" as const;
  readonly role: VariantRole;
  readonly gameTime: number;
  readonly health: BotReportHealth;

  constructor(role: VariantRole, gameTime: number, health: BotReportHealth) {
    super(`Bot report ${health.status} for ${role} at tick ${gameTime}: ${health.message ?? "unknown report failure"}`);
    this.name = "ReportHealthError";
    this.role = role;
    this.gameTime = gameTime;
    this.health = health;
  }
}

class BotReportError extends Error {
  readonly failureKind = "bot" as const;
  readonly role: VariantRole;
  readonly gameTime: number;
  readonly errors: string[];

  constructor(role: VariantRole, gameTime: number, errors: string[]) {
    super(`Bot reported ${errors.length} error${errors.length === 1 ? "" : "s"} for ${role} at tick ${gameTime}: ${errors.join("; ")}`);
    this.name = "BotReportError";
    this.role = role;
    this.gameTime = gameTime;
    this.errors = errors;
  }
}

export async function runSingleExperiment(input: SingleRunInput): Promise<RunDetails> {
  return await runExperiment({
    ...input,
    baseline: input.variant
  });
}

export async function runDuelExperiment(input: DuelRunInput): Promise<RunDetails> {
  return await runExperiment(input);
}

async function runExperiment(input: ExperimentRunInput): Promise<RunDetails> {
  const repoRoot = await resolveRepoRoot(input.cwd);
  const scenario = "scenario" in input ? input.scenario : await loadScenario(input.scenarioPath);
  const roles = input.candidate ? duelVariantRoles : singleVariantRoles;
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
    type: input.candidate ? "duel" : "single",
    status: "running",
    failureKind: null,
    createdAt: timestamp(),
    startedAt: null,
    finishedAt: null,
    repoRoot,
    scenarioPath: path.relative(repoRoot, scenario.path),
    scenarioName: scenario.config.name,
    suite: input.suite,
    rooms: Object.fromEntries(roles.map((role) => [role, world.rooms[role]])) as RoleRecord<string>,
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

  let variants: RoleRecord<VariantRecord> | null = null;
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
    const preparedCandidate = input.candidate
      ? await prepareVariant({
        repoRoot,
        runDir,
        role: "candidate",
        source: input.candidate.source,
        packagePath: input.candidate.packagePath
      })
      : null;

    variants = {
      baseline: preparedBaseline.record,
      ...(preparedCandidate ? { candidate: preparedCandidate.record } : {})
    };
    await writeVariantRecords(runDir, variants);
    await logEvent(runDir, "info", "variants.prepared", "Prepared source snapshots and builds for the active variants.");

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

    await waitForServerControlReady({
      api,
      cli,
      tickDuration: runRecord.run.tickDuration
    });
    await logEvent(runDir, "info", "server.ready", "Private server HTTP and CLI endpoints are ready.");

    if (world.import.kind === "map-id") {
      await logEvent(runDir, "info", "server.map", "Importing scenario map.", { map: world.label });
      await cli.importMap(world.import.value);
      await logEvent(runDir, "info", "server.restart", "Restarting the Screeps service after map import.");
      await restartScreepsService(repoRoot);
      await waitForServerControlReady({
        api,
        cli,
        tickDuration: runRecord.run.tickDuration
      });
    }

    if (world.import.kind === "map-file") {
      const mapLabel = world.label ?? path.basename(world.import.hostFilePath);
      await logEvent(runDir, "info", "server.map", "Importing generated scenario map file.", {
        map: mapLabel,
        file: path.relative(repoRoot, world.import.hostFilePath)
      });
      await stopScreepsService(repoRoot);
      let importResult;
      try {
        importResult = await importMapFileOffline(world.import.hostFilePath, mapLabel);
      } finally {
        await startScreepsService(repoRoot);
      }
      await logEvent(runDir, "info", "server.mapImported", "Imported generated scenario map while the Screeps service was stopped.", importResult);
      await waitForServerControlReady({
        api,
        cli,
        tickDuration: runRecord.run.tickDuration
      });
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

    const credentials: RoleRecord<{ username: string; password: string }> = {
      baseline: { username: "baseline", password: createPassword() },
      ...(preparedCandidate ? { candidate: { username: "candidate", password: createPassword() } } : {})
    };

    await api.registerUser({
      username: credentials.baseline!.username,
      password: credentials.baseline!.password,
      modules: preparedBaseline.modules
    });
    if (preparedCandidate && credentials.candidate) {
      await api.registerUser({
        username: credentials.candidate.username,
        password: credentials.candidate.password,
        modules: preparedCandidate.modules
      });
    }

    await cli.setUserBanned(spectatorCredentials.username, true);
    await cli.setSpawnWhitelist(roles.map((role) => credentials[role]!.username));
    await logEvent(runDir, "info", "users.registered", "Registered active users and applied the spawn whitelist.");

    const sessions: RoleRecord<AuthSession> = {};
    for (const role of roles) {
      const session = await api.signIn(credentials[role]!.username, credentials[role]!.password);
      sessions[role] = session;
      await api.placeAutoSpawn(session, runRecord.rooms[role]!);
    }
    await logEvent(runDir, "info", "rooms.claimed", "Placed auto spawns for the assigned rooms.", runRecord.rooms);

    runRecord.run.startGameTime = await cli.getGameTime();
    const targetGameTime = runRecord.run.startGameTime + runRecord.run.maxTicks;
    const sampleEveryTicks = scenario.config.run.sampleEveryTicks;
    const terminalOutcomes = Object.fromEntries(roles.map((role) => [role, null])) as RoleRecord<TerminalOutcome | null>;
    const samples: RunSample[] = [];
    const terminalConditionsNeedRooms = terminalConditionsRequireRoomObjects(runRecord.run.terminalConditions);
    let pendingRoomMutations: PendingScenarioRoomMutation[] = scenario.config.roomMutations
      .filter((mutation) => roles.includes(mutation.role))
      .map((mutation, index) => ({ id: index + 1, mutation }));
    await writeRunRecord(runDir, runRecord);
    await cli.resumeSimulation();
    simulationRunning = true;
    await logEvent(runDir, "info", "simulation.running", "Simulation resumed.", {
      startGameTime: runRecord.run.startGameTime,
      targetGameTime
    });

    let lastProcessedGameTime = runRecord.run.startGameTime;
    let lastSampleGameTime: number | null = null;

    const waitResult = await waitForSimulation({
      cli,
      targetGameTime,
      pollIntervalMs: runRecord.run.pollIntervalMs,
      maxWallClockMs: scenario.config.run.maxWallClockMs,
      maxStalledPolls: scenario.config.run.maxStalledPolls,
      onSample: async ({ gameTime }) => {
        if (gameTime <= lastProcessedGameTime) {
          return;
        }

        lastProcessedGameTime = gameTime;

        const reportEntries = await Promise.all(
          roles.map(async (role) => [role, await api.getMemorySegment(sessions[role]!, autoscreepsReportSegmentId)] as const)
        );
        const reportsByRole = inspectReportsByRole(Object.fromEntries(reportEntries) as RoleRecord<string | null>);
        await ensureReportsHealthy(runDir, gameTime, reportsByRole, roles);

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
        let roomObjectsByRole: RoleRecord<RoomObjectsResponse> | null = null;

        if (runRecord.run.terminalConditions || captureSample) {
          stats = await api.getStats();
        }

        if (captureSample || terminalConditionsNeedRooms) {
          const roomEntries = await Promise.all(
            roles.map(async (role) => [role, await api.getRoomObjects(runRecord.rooms[role]!)] as const)
          );
          roomObjectsByRole = Object.fromEntries(roomEntries) as RoleRecord<RoomObjectsResponse>;
        }

        if (runRecord.run.terminalConditions) {
          for (const role of roles) {
            if (terminalOutcomes[role] !== null) {
              continue;
            }

            const evaluation = evaluateTerminalConditions(
              runRecord.run.terminalConditions,
              summarizeUserTerminalStats(stats!, credentials[role]!.username, roomObjectsByRole?.[role])
            );
            if (!evaluation) {
              continue;
            }

            terminalOutcomes[role] = {
              status: evaluation.status,
              reason: evaluation.reason,
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
          const sample = buildRunSample(gameTime, stats, credentials, runRecord.rooms, reportsByRole, roomObjectsByRole, roles);
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
      isComplete: () => determineCompletionReason(terminalOutcomes, roles)
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
    } else if (waitResult.reason === "participant-failed") {
      await logEvent(runDir, "info", "simulation.completed", "Simulation stopped because a participant failed.", {
        gameTime: runRecord.run.endGameTime,
        terminal: terminalOutcomes
      });
    } else {
      if (runRecord.run.terminalConditions) {
        for (const role of roles) {
          if (terminalOutcomes[role] !== null) {
            continue;
          }

          terminalOutcomes[role] = resolveTimeoutTerminalOutcome(runRecord.run.terminalConditions, endGameTime);
        }
      }

      await logEvent(runDir, "info", "simulation.completed", "Simulation stopped after reaching the maximum tick budget.", {
        gameTime: runRecord.run.endGameTime,
        targetGameTime,
        terminal: terminalOutcomes
      });
    }

    const finalStats = await api.getStats();
    const finalWorldStatuses = Object.fromEntries(await Promise.all(
      roles.map(async (role) => [role, await api.getWorldStatus(sessions[role]!)] as const)
    )) as RoleRecord<UserWorldStatus>;
    const finalRoomSummaries = Object.fromEntries(await Promise.all(
      roles.map(async (role) => [role, await api.summarizeRoom(runRecord.rooms[role]!)] as const)
    )) as RunMetrics["rooms"];

    if (samples[samples.length - 1]?.gameTime !== endGameTime) {
      const reportEntries = await Promise.all(
        roles.map(async (role) => [role, await api.getMemorySegment(sessions[role]!, autoscreepsReportSegmentId)] as const)
      );
      const reportsByRole = inspectReportsByRole(Object.fromEntries(reportEntries) as RoleRecord<string | null>);
      await ensureReportsHealthy(runDir, endGameTime, reportsByRole, roles);
      const roomEntries = await Promise.all(
        roles.map(async (role) => [role, await api.getRoomObjects(runRecord.rooms[role]!)] as const)
      );
      const finalSample = buildRunSample(
        endGameTime,
        finalStats,
        credentials,
        runRecord.rooms,
        reportsByRole,
        Object.fromEntries(roomEntries) as RoleRecord<RoomObjectsResponse>,
        roles
      );
      samples.push(finalSample);
      await appendRunSample(runDir, finalSample);
    }

    metrics = {
      users: Object.fromEntries(roles.map((role) => [
        role,
        buildUserRunMetrics(
          finalWorldStatuses[role]!,
          summarizeUserTerminalStats(finalStats, credentials[role]!.username),
          terminalOutcomes[role] ?? null
        )
      ])) as RunMetrics["users"],
      rooms: finalRoomSummaries,
      summary: buildRunSummaryMetrics(samples, sampleEveryTicks)
    };
    await writeMetrics(runDir, metrics);
    await logEvent(runDir, "info", "metrics.captured", "Captured post-run metrics.");

    const scenarioFailed = roles.some((role) => terminalOutcomes[role]?.status === "failed");
    runRecord.status = scenarioFailed ? "failed" : "completed";
    runRecord.failureKind = scenarioFailed ? "scenario" : null;
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

async function waitForServerControlReady(input: {
  api: ScreepsApiClient;
  cli: ScreepsServerCli;
  tickDuration: number;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? 120000;
  const start = Date.now();
  let lastError: unknown = null;

  while (Date.now() - start < timeoutMs) {
    try {
      await Promise.all([input.api.waitForReady(30000), input.cli.waitForReady(30000)]);
      await input.cli.pauseSimulation();
      await input.cli.setTickDuration(input.tickDuration);
      return;
    } catch (error) {
      lastError = error;
      await waitForServerControlRetryDelay(1000);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Timed out waiting for the Screeps server control plane to become ready.");
}

function waitForServerControlRetryDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
  rooms: Record<VariantRole, string>;
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
  credentials: RoleRecord<{ username: string }>;
  rooms: RoleRecord<string>;
  runDir: string;
  gameTime: number;
}): Promise<PendingScenarioRoomMutation[]> {
  if (input.pendingRoomMutations.length === 0) {
    return [];
  }

  const roomObjectsByRole: RoleRecord<Awaited<ReturnType<ScreepsApiClient["getRoomObjects"]>>> = {};
  for (const role of new Set(input.pendingRoomMutations.map(({ mutation }) => mutation.role))) {
    const room = input.rooms[role];
    if (!room) {
      continue;
    }
    roomObjectsByRole[role] = await input.api.getRoomObjects(room);
  }

  const remaining: PendingScenarioRoomMutation[] = [];
  for (const pendingRoomMutation of input.pendingRoomMutations) {
    const mutation = pendingRoomMutation.mutation;
    const room = input.rooms[mutation.role];
    const roomObjects = roomObjectsByRole[mutation.role];
    const credential = input.credentials[mutation.role];
    if (!room || !roomObjects || !credential) {
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
          username: credential.username,
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

function summarizeUserTerminalStats(
  stats: StatsResponse,
  username: string,
  roomObjects?: RoomObjectsResponse
): UserTerminalStats {
  const user = stats.users.find((candidate) => candidate.username === username);
  const rcl = normalizeRclCounts(user?.rcl);

  return {
    ownedControllers: user?.rooms ?? 0,
    combinedRCL: user?.combinedRCL ?? 0,
    maxOwnedControllerLevel: findMaxOwnedControllerLevel(rcl),
    rcl,
    ownedStructureCounts: roomObjects ? summarizeOwnedStructureCounts(roomObjects, username) : {}
  };
}

function summarizeOwnedStructureCounts(roomObjects: RoomObjectsResponse, username: string): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const object of roomObjects.objects) {
    if (!object.user) {
      continue;
    }

    const owner = roomObjects.users[object.user]?.username ?? object.user;
    if (owner !== username) {
      continue;
    }

    counts[object.type] = (counts[object.type] ?? 0) + 1;
  }

  return counts;
}

function buildUserRunMetrics(
  worldStatus: UserWorldStatus,
  stats: UserTerminalStats,
  terminal: TerminalOutcome | null
): UserRunMetrics {
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
  credentials: RoleRecord<{ username: string }>,
  rooms: RoleRecord<string>,
  reportData: ReportInspectionsByRole,
  roomObjectsByRole: RoleRecord<RoomObjectsResponse> | null,
  roles: VariantRole[]
): RunSample {
  const sample: RunSample = {
    gameTime,
    users: Object.fromEntries(
      roles.map((role) => [role, summarizeUserTerminalStats(stats, credentials[role]!.username)])
    ) as RunSample["users"]
  };

  if (roomObjectsByRole !== null) {
    sample.rooms = Object.fromEntries(
      roles.flatMap((role) => {
        const roomObjects = roomObjectsByRole[role];
        const roomName = rooms[role];
        if (!roomObjects || !roomName) {
          return [];
        }

        return [[role, buildSampleRoomMetrics(roomObjects, roomName)]];
      })
    ) as RoleRecord<RunSampleRoomMetrics>;
  }

  sample.reports = Object.fromEntries(
    roles.map((role) => [role, reportData[role]?.snapshot ?? null])
  ) as RunSample["reports"];

  return sample;
}

async function ensureReportsHealthy(
  runDir: string,
  gameTime: number,
  reportsByRole: ReportInspectionsByRole,
  roles: VariantRole[]
): Promise<void> {
  for (const role of roles) {
    const inspection = reportsByRole[role];
    if (!inspection) {
      continue;
    }

    if (inspection.health.status !== "ok") {
      await logEvent(runDir, "error", "report.failed", "Bot report health check failed.", {
        role,
        gameTime,
        report: inspection.health
      });
      throw new ReportHealthError(role, gameTime, inspection.health);
    }

    if (inspection.snapshot && inspection.snapshot.errors.length > 0) {
      await logEvent(runDir, "error", "bot.error", "Bot reported errors.", {
        role,
        gameTime,
        errors: inspection.snapshot.errors
      });
      throw new BotReportError(role, gameTime, inspection.snapshot.errors);
    }
  }
}

function classifyFailureKind(error: unknown): RunFailureKind {
  if (error instanceof ReportHealthError) {
    return "report";
  }
  if (error instanceof BotReportError) {
    return "bot";
  }

  return "execution";
}

function buildSampleRoomMetrics(response: RoomObjectsResponse, fallbackRoom: string): RunSampleRoomMetrics {
  const detectedRoom = response.objects.find((object) => typeof object.room === "string")?.room ?? fallbackRoom;
  const summary = summarizeLiveRoom(detectedRoom, response);

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
      reason: "fail",
      condition: failCondition
    };
  }

  const winCondition = terminalConditions.win.find((condition) => matchesTerminalCondition(condition, stats));
  if (winCondition) {
    return {
      status: "passed",
      reason: "win",
      condition: winCondition
    };
  }

  return null;
}

function matchesTerminalCondition(condition: TerminalCondition, stats: UserTerminalStats): boolean {
  switch (condition.type) {
    case "any-owned-controller-level-at-least":
      return stats.maxOwnedControllerLevel !== null && stats.maxOwnedControllerLevel >= condition.level;
    case "owned-structure-count-at-least":
      return (stats.ownedStructureCounts[condition.structureType] ?? 0) >= condition.count;
    case "no-owned-controllers":
      return stats.ownedControllers === 0;
  }
}

function terminalConditionsRequireRoomObjects(terminalConditions: TerminalConditionSet | null): boolean {
  if (!terminalConditions) {
    return false;
  }

  return [...terminalConditions.win, ...terminalConditions.fail].some(
    (condition) => condition.type === "owned-structure-count-at-least"
  );
}

function resolveTimeoutTerminalOutcome(terminalConditions: TerminalConditionSet, gameTime: number): TerminalOutcome {
  return {
    status: terminalConditions.win.length > 0 ? "failed" : "passed",
    reason: "timeout",
    gameTime,
    condition: null
  };
}

function determineCompletionReason(
  terminalOutcomes: RoleRecord<TerminalOutcome | null>,
  roles: VariantRole[]
): RunTerminationReason | null {
  if (roles.some((role) => terminalOutcomes[role]?.status === "failed")) {
    return "participant-failed";
  }

  if (roles.every((role) => terminalOutcomes[role] !== null)) {
    return "all-bots-terminal";
  }

  return null;
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
  isComplete?: (sample: { gameTime: number }) => Promise<RunTerminationReason | boolean | null> | RunTerminationReason | boolean | null;
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

    const completionReason = await options.isComplete?.({ gameTime });
    if (completionReason) {
      return {
        gameTime,
        reason: completionReason === true ? "all-bots-terminal" : completionReason
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
