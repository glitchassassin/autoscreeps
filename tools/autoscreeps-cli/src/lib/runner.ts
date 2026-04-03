import crypto from "node:crypto";
import path from "node:path";
import { buildVariantPackage } from "./build.ts";
import type { EventRecord, RunDetails, RunIndexEntry, RunMetrics, RunRecord, UserBadge, VariantRecord, VariantRole } from "./contracts.ts";
import { copyFileToScreepsService, resetPrivateServer, restartScreepsService } from "./docker.ts";
import { createWorkspaceSnapshot, parseVariantSource, resolveRepoRoot, withGitWorktree } from "./git.ts";
import { appendEvent, appendIndexEntry, createRunWorkspace, writeMetrics, writeRunRecord, writeVariantRecords } from "./history.ts";
import { generateExperimentMap } from "./map-generator.ts";
import { loadScenario } from "./scenario.ts";
import { ScreepsApiClient } from "./screeps-api.ts";
import { ScreepsServerCli } from "./server-cli.ts";
import { timestamp } from "./utils.ts";

type DuelVariantInput = {
  source: string;
  packagePath: string;
};

export type DuelRunInput = {
  cwd: string;
  scenarioPath: string;
  baseline: DuelVariantInput;
  candidate: DuelVariantInput;
};

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

export async function runDuelExperiment(input: DuelRunInput): Promise<RunDetails> {
  const repoRoot = await resolveRepoRoot(input.cwd);
  const scenario = await loadScenario(input.scenarioPath);
  const { runId, runDir, historyRoot } = await createRunWorkspace(repoRoot);
  const world = await resolveExperimentWorld({
    scenario: scenario.config,
    runDir
  });
  const runRecord: RunRecord = {
    id: runId,
    type: "duel",
    status: "running",
    createdAt: timestamp(),
    startedAt: null,
    finishedAt: null,
    repoRoot,
    scenarioPath: path.relative(repoRoot, scenario.path),
    scenarioName: scenario.config.name,
    rooms: {
      baseline: world.rooms.baseline,
      candidate: world.rooms.candidate
    },
    run: {
      tickDuration: scenario.config.run.tickDuration,
      maxTicks: scenario.config.run.maxTicks,
      pollIntervalMs: scenario.config.run.pollIntervalMs,
      map: world.label,
      startGameTime: null,
      endGameTime: null
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
    const cli = new ScreepsServerCli({
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
    await writeRunRecord(runDir, runRecord);
    await cli.resumeSimulation();
    await logEvent(runDir, "info", "simulation.running", "Simulation resumed.", {
      startGameTime: runRecord.run.startGameTime,
      targetGameTime
    });

    let lastReportedGameTime: number | null = null;

    await waitForTargetGameTime({
      cli,
      targetGameTime,
      pollIntervalMs: runRecord.run.pollIntervalMs,
      maxWallClockMs: scenario.config.run.maxWallClockMs,
      maxStalledPolls: scenario.config.run.maxStalledPolls,
      onProgress: async ({ gameTime }) => {
        if (gameTime === lastReportedGameTime) {
          return;
        }

        lastReportedGameTime = gameTime;
        await logEvent(runDir, "info", "simulation.progress", "Simulation advanced.", {
          gameTime,
          targetGameTime,
          completedTicks: Math.max(gameTime - runRecord.run.startGameTime!, 0),
          remainingTicks: Math.max(targetGameTime - gameTime, 0)
        });
      }
    });

    await cli.pauseSimulation();
    runRecord.run.endGameTime = await cli.getGameTime();
    metrics = {
      users: {
        baseline: await api.getWorldStatus(baselineSession),
        candidate: await api.getWorldStatus(candidateSession)
      },
      rooms: {
        baseline: await api.summarizeRoom(runRecord.rooms.baseline),
        candidate: await api.summarizeRoom(runRecord.rooms.candidate)
      }
    };
    await writeMetrics(runDir, metrics);
    await logEvent(runDir, "info", "metrics.captured", "Captured post-run metrics.");

    runRecord.status = "completed";
    runRecord.finishedAt = timestamp();
    await writeRunRecord(runDir, runRecord);
  } catch (error) {
    runRecord.status = "failed";
    runRecord.finishedAt = timestamp();
    runRecord.error = error instanceof Error ? error.stack ?? error.message : String(error);
    await writeRunRecord(runDir, runRecord);
    await logEvent(runDir, "error", "run.failed", "Experiment run failed.", { error: runRecord.error });
  }

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type WaitForTargetGameTimeOptions = {
  cli: Pick<ScreepsServerCli, "getGameTime">;
  targetGameTime: number;
  pollIntervalMs: number;
  maxWallClockMs: number;
  maxStalledPolls: number;
  onProgress?: (sample: { gameTime: number }) => Promise<void> | void;
};

export async function waitForTargetGameTime(options: WaitForTargetGameTimeOptions): Promise<void> {
  const startedAt = Date.now();
  let lastGameTime: number | null = null;
  let stalledPolls = 0;

  while (true) {
    const gameTime = await options.cli.getGameTime();
    if (gameTime >= options.targetGameTime) {
      return;
    }

    await options.onProgress?.({ gameTime });

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
