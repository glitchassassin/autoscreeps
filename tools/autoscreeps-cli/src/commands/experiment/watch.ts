import { clearScreenDown, cursorTo } from "node:readline";

import type { EventRecord, RunRecord, RunStatus, SuiteCaseDetails, SuiteRecord, VariantRecord } from "../../lib/contracts.ts";
import { listSuites, readCaseRunDetails, readEvents, readEventTail, readSuiteRecord, resolveSuiteCaseRunDir, resolveSuiteDir } from "../../lib/history.ts";
import { resolveRepoRoot } from "../../lib/git.ts";
import { ScreepsApiClient } from "../../lib/screeps-api.ts";
import { selectSuiteForWatch, summarizeLiveRoom, summarizeRecordedRoom, type WatchRoomStats } from "../../lib/watch.ts";

const pollIntervalMs = 1000;
const eventTailLimit = 16;
const ansiPattern = /\u001b\[[0-9;]*m/g;

const palette = {
  fg: [192, 202, 245] as const,
  fgMuted: [169, 177, 214] as const,
  comment: [86, 95, 137] as const,
  border: [65, 72, 104] as const,
  blue: [122, 162, 247] as const,
  cyan: [125, 207, 255] as const,
  green: [158, 206, 106] as const,
  yellow: [224, 175, 104] as const,
  red: [247, 118, 142] as const,
  magenta: [187, 154, 247] as const,
  bgDark: [31, 35, 53] as const,
  bgPanel: [36, 40, 59] as const
};

const controllerProgressTotals: Partial<Record<number, number>> = {
  1: 200,
  2: 45000,
  3: 135000,
  4: 405000,
  5: 1215000,
  6: 3645000,
  7: 10935000
};

export type DashboardSnapshot = {
  mode: "follow-latest" | "pinned";
  suite: SuiteRecord | null;
  displayCase: SuiteCaseDetails | null;
  events: EventRecord[];
  eventsLabel: string;
  baseline: WatchRoomStats | null;
  candidate: WatchRoomStats | null;
  configuredTickDurationMs: number | null;
  measuredTickDurationMs: number | null;
  displayGameTime: number | null;
  targetGameTime: number | null;
  statsError: string | null;
};

type RenderDashboardOptions = {
  width?: number;
  colors?: boolean;
  clear?: boolean;
};

type DashboardRenderState = {
  firstFrame: boolean;
  previousLineCount: number;
  previousWidth: number;
};

export async function watchExperimentCommand(suiteId?: string): Promise<void> {
  const repoRoot = await resolveRepoRoot(process.cwd());
  const mode = suiteId ? "pinned" : "follow-latest";
  const renderState: DashboardRenderState = {
    firstFrame: true,
    previousLineCount: 0,
    previousWidth: 0
  };

  if (suiteId) {
    await readSuiteRecord(repoRoot, suiteId);
  }

  while (true) {
    const snapshot = await collectDashboardSnapshot(repoRoot, suiteId, mode);
    writeDashboardSnapshot(snapshot, renderState);
    await delay(pollIntervalMs);
  }
}

async function collectDashboardSnapshot(
  repoRoot: string,
  pinnedSuiteId: string | undefined,
  mode: DashboardSnapshot["mode"]
): Promise<DashboardSnapshot> {
  const runs = pinnedSuiteId
    ? [await readSuiteRecord(repoRoot, pinnedSuiteId).then((suite) => ({
      id: suite.id,
      status: suite.status,
      createdAt: suite.createdAt,
      finishedAt: suite.finishedAt,
      name: suite.name,
      progress: suite.progress
    }))]
    : await listSuites(repoRoot);
  const selectedRun = selectSuiteForWatch(runs, pinnedSuiteId);

  if (!selectedRun) {
    return {
      mode,
      suite: null,
      displayCase: null,
      events: [],
      eventsLabel: "Recent Suite Events",
      baseline: null,
      candidate: null,
      configuredTickDurationMs: null,
      measuredTickDurationMs: null,
      displayGameTime: null,
      targetGameTime: null,
      statsError: null
    };
  }

  const suite = await readSuiteRecord(repoRoot, selectedRun.id);
  const displayCase = await readDisplayCase(repoRoot, suite);
  const currentCaseRunId = suite.progress.currentCaseRunId;
  const caseRunDir = displayCase?.runId ? resolveSuiteCaseRunDir(repoRoot, suite.id, displayCase.runId) : null;
  const eventDir = currentCaseRunId && displayCase?.runId === currentCaseRunId
    ? resolveSuiteCaseRunDir(repoRoot, suite.id, currentCaseRunId)
    : resolveSuiteDir(repoRoot, suite.id);
  const events = await readEventTail(eventDir, eventTailLimit);

  if (!displayCase?.details) {
    return {
      mode,
      suite,
      displayCase,
      events,
      eventsLabel: currentCaseRunId ? "Recent Case Events" : "Recent Suite Events",
      baseline: null,
      candidate: null,
      configuredTickDurationMs: null,
      measuredTickDurationMs: null,
      displayGameTime: null,
      targetGameTime: null,
      statsError: null
    };
  }

  const details = displayCase.details;
  const targetGameTime = details.run.run.startGameTime === null ? null : details.run.run.startGameTime + details.run.run.maxTicks;

  if (details.run.status !== "running") {
    const measuredTickDurationMs = caseRunDir === null
      ? null
      : estimateMeasuredTickDurationFromEvents(details.run, await readEvents(caseRunDir));

    return {
      mode,
      suite,
      displayCase,
      events,
      eventsLabel: currentCaseRunId ? "Recent Case Events" : "Recent Suite Events",
      baseline: details.metrics?.rooms.baseline ? summarizeRecordedRoom(details.metrics.rooms.baseline) : null,
      candidate: details.metrics?.rooms.candidate ? summarizeRecordedRoom(details.metrics.rooms.candidate) : null,
      configuredTickDurationMs: details.run.run.tickDuration,
      measuredTickDurationMs,
      displayGameTime: details.run.run.endGameTime ?? details.run.run.startGameTime,
      targetGameTime,
      statsError: null
    };
  }

  try {
    const api = new ScreepsApiClient(details.run.server.httpUrl, { requestTimeoutMs: 1500 });
    const [gameTime, baselineRoom, candidateRoom, measuredTickDurationMs] = await Promise.all([
      api.getGameTime(),
      api.getRoomObjects(details.run.rooms.baseline!),
      details.run.rooms.candidate ? api.getRoomObjects(details.run.rooms.candidate) : Promise.resolve(null),
      api.getMeasuredTickDuration()
    ]);

    return {
      mode,
      suite,
      displayCase,
      events,
      eventsLabel: "Recent Case Events",
      baseline: summarizeLiveRoom(details.run.rooms.baseline!, baselineRoom),
      candidate: details.run.rooms.candidate && candidateRoom ? summarizeLiveRoom(details.run.rooms.candidate, candidateRoom) : null,
      configuredTickDurationMs: details.run.run.tickDuration,
      measuredTickDurationMs,
      displayGameTime: gameTime,
      targetGameTime,
      statsError: null
    };
  } catch (error) {
    return {
      mode,
      suite,
      displayCase,
      events,
      eventsLabel: "Recent Case Events",
      baseline: null,
      candidate: null,
      configuredTickDurationMs: details.run.run.tickDuration,
      measuredTickDurationMs: null,
      displayGameTime: details.run.run.startGameTime,
      targetGameTime,
      statsError: error instanceof Error ? error.message : String(error)
    };
  }
}

export function renderDashboard(snapshot: DashboardSnapshot, options: RenderDashboardOptions = {}): string {
  const colors = options.colors ?? shouldUseColors();
  const width = Math.max(80, options.width ?? process.stdout.columns ?? 120);
  const clearPrefix = options.clear === false ? "" : "\u001b[2J\u001b[H";
  const lines: string[] = [];

  lines.push(renderTitleBar(width, colors));
  lines.push("");

  if (!snapshot.suite) {
    lines.push(...buildPanel(
      "Waiting For Suite",
      [palette.blue, palette.comment],
      [
        padAnsi(styleText("Watcher Mode", { fg: palette.fgMuted, bold: true }, colors), width - 4),
        padAnsi(styleText(snapshot.mode === "pinned" ? "Pinned" : "Follow newest suite", { fg: palette.blue }, colors), width - 4),
        "",
        styleText("No suite.json files are available yet under .autoscreeps/suites/.", { fg: palette.fg }, colors)
      ],
      width,
      colors
    ));

    return finalizeDashboard(lines, width, clearPrefix);
  }

  const suite = snapshot.suite;
  const caseDetails = snapshot.displayCase?.details ?? null;
  const run = caseDetails?.run ?? null;
  const variants = caseDetails?.variants ?? null;
  const summaryRows = [
    formatTwoColumnRow(
      { label: "Suite", value: suite.name },
      { label: "Watcher", value: snapshot.mode === "pinned" ? "Pinned" : "Follow newest suite" },
      width - 4,
      colors
    ),
    formatTwoColumnRow(
      { label: "Suite ID", value: suite.id },
      { label: "Status", value: formatStatusBadge(suite.status, colors) },
      width - 4,
      colors
    ),
    formatTwoColumnRow(
      { label: "Source", value: formatSuiteSource(suite) },
      { label: "Case", value: formatSuiteCaseLabel(suite, snapshot.displayCase) },
      width - 4,
      colors
    ),
    formatTwoColumnRow(
      { label: "Scenario", value: snapshot.displayCase?.scenarioName ?? "-" },
      { label: "Case Status", value: formatCaseStatusBadge(snapshot.displayCase?.status ?? null, colors) },
      width - 4,
      colors
    ),
    formatTwoColumnRow(
      { label: "Run", value: run?.id ?? "-" },
      { label: "Tick Duration", value: run ? formatTickDurationSummary(snapshot.configuredTickDurationMs, snapshot.measuredTickDurationMs) : "-" },
      width - 4,
      colors
    ),
    formatTwoColumnRow(
      { label: "Baseline", value: formatVariantSummary(variants?.baseline) },
      { label: "Candidate", value: formatVariantSummary(variants?.candidate) },
      width - 4,
      colors
    ),
    formatTwoColumnRow(
      { label: "Created", value: suite.createdAt },
      { label: "Started", value: suite.startedAt ?? "-" },
      width - 4,
      colors
    ),
    formatTwoColumnRow(
      { label: "Finished", value: suite.finishedAt ?? "-" },
      { label: "Cases", value: formatSuiteCaseCounts(suite) },
      width - 4,
      colors
    ),
    formatWideField("Suite Progress", formatSuiteProgressValue(suite, Math.max(18, width - 34), colors), width - 4, colors)
  ];

  if (run) {
    summaryRows.push(
      formatWideField("Case Progress", formatProgressValue(run.run.startGameTime, snapshot.displayGameTime, snapshot.targetGameTime, Math.max(18, width - 34), colors), width - 4, colors)
    );
  }

  if (snapshot.statsError) {
    summaryRows.push(formatWideField("Live Stats", styleText(snapshot.statsError, { fg: palette.yellow }, colors), width - 4, colors));
  }

  lines.push(...buildPanel("Suite Summary", [palette.blue, palette.cyan], summaryRows, width, colors));
  lines.push("");

  const stackedRoomPanels = width < 118;
  if (stackedRoomPanels) {
    lines.push(...buildRoomPanel("Baseline", snapshot.baseline, width, palette.cyan, colors));
    lines.push("");
    lines.push(...buildRoomPanel("Candidate", snapshot.candidate, width, palette.magenta, colors));
  } else {
    const gap = 2;
    const columnWidth = Math.floor((width - gap) / 2);
    lines.push(...joinColumns(
      buildRoomPanel("Baseline", snapshot.baseline, columnWidth, palette.cyan, colors),
      buildRoomPanel("Candidate", snapshot.candidate, columnWidth, palette.magenta, colors),
      columnWidth,
      columnWidth,
      gap
    ));
  }

  lines.push("");
  lines.push(...buildPanel(snapshot.eventsLabel, [palette.yellow, palette.comment], formatEventRows(snapshot.events, width - 4, colors), width, colors));

  return finalizeDashboard(lines, width, clearPrefix);
}

async function readDisplayCase(repoRoot: string, suite: SuiteRecord): Promise<SuiteCaseDetails | null> {
  const currentCase = suite.progress.currentCaseRunId
    ? suite.cases.find((testCase) => testCase.runId === suite.progress.currentCaseRunId) ?? null
    : null;
  const latestCase = [...suite.cases].reverse().find((testCase) => testCase.runId !== null) ?? null;
  const displayCase = currentCase ?? latestCase;

  if (!displayCase || displayCase.runId === null) {
    return displayCase ? { ...displayCase, details: null } : null;
  }

  return {
    ...displayCase,
    details: await readCaseRunDetailsOrNull(resolveSuiteCaseRunDir(repoRoot, suite.id, displayCase.runId))
  };
}

async function readCaseRunDetailsOrNull(runDir: string): Promise<SuiteCaseDetails["details"]> {
  try {
    return await readCaseRunDetails(runDir);
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code === "ENOENT" || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function writeDashboardSnapshot(snapshot: DashboardSnapshot, renderState: DashboardRenderState): void {
  const width = Math.max(80, process.stdout.columns ?? 120);
  const isTTY = Boolean(process.stdout.isTTY);
  const frame = renderDashboard(snapshot, {
    width,
    clear: isTTY && renderState.firstFrame
  });
  const lineCount = countRenderedLines(frame);

  if (isTTY && !renderState.firstFrame) {
    cursorTo(process.stdout, 0, 0);

    if (width !== renderState.previousWidth) {
      clearScreenDown(process.stdout);
    }
  }

  process.stdout.write(frame);

  if (isTTY && !renderState.firstFrame && width === renderState.previousWidth && lineCount < renderState.previousLineCount) {
    clearScreenDown(process.stdout);
  }

  renderState.firstFrame = false;
  renderState.previousLineCount = lineCount;
  renderState.previousWidth = width;
}

function finalizeDashboard(lines: string[], width: number, clearPrefix: string): string {
  return `${clearPrefix}${normalizeDashboardLines(lines, width).join("\n")}\n`;
}

function normalizeDashboardLines(lines: string[], width: number): string[] {
  return lines.map((line) => padAnsi(truncateAnsi(line, width), width));
}

function renderTitleBar(width: number, colors: boolean): string {
  const left = styleText(" AUTOSCREEPS EXPERIMENT WATCH ", { fg: palette.blue, bg: palette.bgDark, bold: true }, colors);
  const right = styleText(`updated ${new Date().toLocaleTimeString()}`, { fg: palette.comment, bg: palette.bgDark }, colors);
  const fillerWidth = Math.max(width - visibleLength(left) - visibleLength(right), 1);
  const filler = styleText(" ".repeat(fillerWidth), { bg: palette.bgDark }, colors);
  return `${left}${filler}${right}`;
}

function buildRoomPanel(
  label: string,
  stats: WatchRoomStats | null,
  width: number,
  accent: readonly [number, number, number],
  colors: boolean
): string[] {
  const rows = stats === null
    ? [styleText("Live room stats are not available.", { fg: palette.yellow }, colors)]
    : [
        formatWideField("Owner", stats.owner ?? "-", width - 4, colors),
        formatTwoColumnRow(
          { label: "Creeps", value: formatNumber(stats.creeps) },
          { label: "Spawns", value: formatNumber(stats.spawns) },
          width - 4,
          colors
        ),
        formatTwoColumnRow(
          { label: "Extensions", value: formatNumber(stats.extensions) },
          { label: "Sites", value: formatNumber(stats.constructionSites) },
          width - 4,
          colors
        ),
        formatWideField("Controller", formatController(stats), width - 4, colors),
        formatWideField("Energy", formatEnergy(stats.energy, stats.energyCapacity), width - 4, colors),
        formatWideField("Objects", `${stats.objects}`, width - 4, colors)
      ];

  const title = stats === null ? label : `${label} (${stats.room})`;
  return buildPanel(title, [accent, palette.comment], rows, width, colors);
}

function buildPanel(
  title: string,
  accents: readonly [readonly [number, number, number], readonly [number, number, number]],
  rows: string[],
  width: number,
  colors: boolean
): string[] {
  if (!colors) {
    return [
      title,
      ...rows.map((row) => `  ${truncateAnsi(row, Math.max(width - 2, 1))}`)
    ];
  }

  const contentWidth = Math.max(width - 2, 1);
  const borderColor = accents[0];
  const titleColor = accents[1];
  const cardBackground = palette.bgDark;
  const border = styleText("┃", { fg: borderColor, bg: cardBackground }, colors);
  const headerLabel = `${border}${styleText(` ${title.toUpperCase()}`, { fg: titleColor, bg: cardBackground, bold: true }, colors)}`;

  return [
    fillBackground(padAnsi(truncateAnsi(headerLabel, width), width), cardBackground, colors, palette.fg),
    ...rows.map((row) => {
      const line = `${styleText("┃", { fg: borderColor, bg: cardBackground }, colors)} ${padAnsi(truncateAnsi(row, contentWidth), contentWidth)}`;
      return fillBackground(line, cardBackground, colors, palette.fg);
    })
  ];
}

function formatEventRows(events: EventRecord[], width: number, colors: boolean): string[] {
  if (events.length === 0) {
    return [styleText("No runner events yet.", { fg: palette.comment }, colors)];
  }

  return events.map((event) => {
    const time = styleText(extractTime(event.timestamp), { fg: palette.comment }, colors);
    const level = formatLevelBadge(event.level, colors);
    const name = styleText(event.event, { fg: event.level === "error" ? palette.red : palette.cyan, bold: true }, colors);
    const message = styleText(event.message, { fg: palette.fg }, colors);
    const data = summarizeEventData(event.data, colors);
    const row = [time, level, name, message, data].filter((part) => part.length > 0).join("  ");
    return truncateAnsi(row, width);
  });
}

function joinColumns(leftLines: string[], rightLines: string[], leftWidth: number, rightWidth: number, gap: number): string[] {
  const totalLines = Math.max(leftLines.length, rightLines.length);
  const lines: string[] = [];

  for (let index = 0; index < totalLines; index += 1) {
    const left = leftLines[index] ?? "";
    const right = rightLines[index] ?? "";
    lines.push(`${padAnsi(left, leftWidth)}${" ".repeat(gap)}${padAnsi(right, rightWidth)}`);
  }

  return lines;
}

function formatTwoColumnRow(
  left: { label: string; value: string },
  right: { label: string; value: string },
  width: number,
  colors: boolean
): string {
  const gap = 3;
  const columnWidth = Math.floor((width - gap) / 2);
  return `${formatField(left.label, left.value, columnWidth, colors)}${" ".repeat(gap)}${formatField(right.label, right.value, columnWidth, colors)}`;
}

function formatWideField(label: string, value: string, width: number, colors: boolean): string {
  return formatField(label, value, width, colors);
}

function formatField(label: string, value: string, width: number, colors: boolean): string {
  const labelWidth = Math.min(14, Math.max(8, width - 6));
  const labelText = padAnsi(styleText(label.toUpperCase(), { fg: palette.fgMuted, bold: true }, colors), labelWidth);
  const valueText = truncateAnsi(styleText(value, { fg: palette.fg }, colors), Math.max(width - labelWidth - 1, 0));
  return padAnsi(`${labelText} ${valueText}`, width);
}

function formatVariantSummary(variant: VariantRecord | undefined): string {
  if (!variant) {
    return "unavailable";
  }

  const source = variant.snapshot.kind === "git"
    ? `git:${variant.snapshot.ref}`
    : variant.snapshot.source;
  return `${source} ${variant.build.packagePath}`;
}

function formatSuiteSource(suite: SuiteRecord): string {
  return `${suite.source.kind}:${suite.source.path}`;
}

function formatSuiteCaseLabel(suite: SuiteRecord, displayCase: SuiteCaseDetails | null): string {
  if (!displayCase) {
    return "-";
  }

  const suffix = suite.progress.currentCaseRunId === displayCase.runId ? "" : " (latest)";
  return `${displayCase.caseIndex}/${suite.progress.caseCount} ${displayCase.id}${suffix}`;
}

function formatSuiteCaseCounts(suite: SuiteRecord): string {
  const done = suite.progress.completedCaseCount + suite.progress.failedCaseCount;
  return `${done}/${suite.progress.caseCount} done, ${suite.progress.failedCaseCount} failed`;
}

function formatProgressValue(startGameTime: number | null, gameTime: number | null, targetGameTime: number | null, width: number, colors: boolean): string {
  if (startGameTime === null || gameTime === null || targetGameTime === null) {
    return styleText("waiting for game time...", { fg: palette.comment }, colors);
  }

  const totalTicks = Math.max(targetGameTime - startGameTime, 1);
  const completedTicks = Math.min(Math.max(gameTime - startGameTime, 0), totalTicks);
  const ratio = completedTicks / totalTicks;
  const barWidth = Math.max(10, Math.min(32, width - 22));
  const filled = Math.max(1, Math.min(barWidth, Math.round(ratio * barWidth)));
  const empty = Math.max(barWidth - filled, 0);

  if (!colors) {
    return `${completedTicks}/${totalTicks} ${(ratio * 100).toFixed(1)}%`;
  }

  const bar = `${styleText(" ".repeat(filled), { bg: palette.green }, colors)}${styleText(" ".repeat(empty), { bg: palette.border }, colors)}`;
  const details = styleText(` ${completedTicks}/${totalTicks}  ${(ratio * 100).toFixed(1)}%`, { fg: palette.fg }, colors);
  return `${bar}${details}`;
}

function formatSuiteProgressValue(suite: SuiteRecord, width: number, colors: boolean): string {
  const totalCases = Math.max(suite.progress.caseCount, 1);
  const completedCases = suite.progress.completedCaseCount + suite.progress.failedCaseCount;
  const ratio = completedCases / totalCases;

  if (!colors) {
    return `${completedCases}/${suite.progress.caseCount} ${(ratio * 100).toFixed(1)}% (${suite.progress.failedCaseCount} failed)`;
  }

  const barWidth = Math.max(10, Math.min(32, width - 22));
  const filled = Math.max(completedCases === 0 ? 0 : 1, Math.min(barWidth, Math.round(ratio * barWidth)));
  const empty = Math.max(barWidth - filled, 0);
  const bar = `${styleText(" ".repeat(filled), { bg: suite.progress.failedCaseCount > 0 ? palette.yellow : palette.green }, colors)}${styleText(" ".repeat(empty), { bg: palette.border }, colors)}`;
  const details = styleText(` ${completedCases}/${suite.progress.caseCount}  ${(ratio * 100).toFixed(1)}%  ${suite.progress.failedCaseCount} failed`, { fg: palette.fg }, colors);
  return `${bar}${details}`;
}

function formatTickDurationSummary(configuredTickDurationMs: number | null, measuredTickDurationMs: number | null): string {
  return `${formatMilliseconds(configuredTickDurationMs)} configured / ${formatMilliseconds(measuredTickDurationMs)} actual`;
}

function formatController(stats: WatchRoomStats): string {
  if (stats.controllerLevel === null) {
    return "-";
  }

  if (stats.controllerProgress === null) {
    return `RCL ${stats.controllerLevel}`;
  }

  const progressTotal = stats.controllerProgressTotal ?? controllerProgressTotals[stats.controllerLevel] ?? null;
  if (progressTotal === null || progressTotal <= 0) {
    return `RCL ${stats.controllerLevel}`;
  }

  const progressPct = Math.min(Math.max((stats.controllerProgress / progressTotal) * 100, 0), 100);
  return `RCL ${stats.controllerLevel} (${progressPct.toFixed(1)}% to RCL ${stats.controllerLevel + 1})`;
}

function formatEnergy(energy: number | null, energyCapacity: number | null): string {
  if (energy === null || energyCapacity === null) {
    return "-";
  }

  return `${energy}/${energyCapacity}`;
}

function formatNumber(value: number | null): string {
  return value === null ? "-" : `${value}`;
}

function formatMilliseconds(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return "-";
  }

  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)} ms` : `${rounded.toFixed(1)} ms`;
}

function estimateMeasuredTickDurationFromEvents(run: RunRecord, events: EventRecord[]): number | null {
  const simulationStarted = events.find((event) => event.event === "simulation.running");
  const simulationCompleted = [...events].reverse().find((event) => event.event === "simulation.completed");

  const startGameTime = readNumericEventField(simulationStarted?.data, "startGameTime") ?? run.run.startGameTime;
  const endGameTime = readNumericEventField(simulationCompleted?.data, "gameTime") ?? run.run.endGameTime;
  const startedAtMs = simulationStarted ? Date.parse(simulationStarted.timestamp) : Number.NaN;
  const completedAtMs = simulationCompleted ? Date.parse(simulationCompleted.timestamp) : Number.NaN;

  if (startGameTime === null || endGameTime === null || endGameTime <= startGameTime) {
    return null;
  }

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs) || completedAtMs <= startedAtMs) {
    return null;
  }

  return (completedAtMs - startedAtMs) / (endGameTime - startGameTime);
}

function readNumericEventField(data: unknown, key: string): number | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }

  const value = (data as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summarizeEventData(data: unknown, colors: boolean): string {
  if (data === undefined) {
    return "";
  }

  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const parts = Object.entries(data)
      .slice(0, 4)
      .map(([key, value]) => `${key}=${formatEventPrimitive(value)}`);

    if (parts.length > 0) {
      return styleText(parts.join(" "), { fg: palette.comment }, colors);
    }
  }

  return styleText(truncatePlain(JSON.stringify(data), 72), { fg: palette.comment }, colors);
}

function formatEventPrimitive(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return `${value}`;
  }

  if (value === null) {
    return "null";
  }

  return truncatePlain(JSON.stringify(value), 24);
}

function formatStatusBadge(status: RunStatus, colors: boolean): string {
  switch (status) {
    case "completed":
      return badge("COMPLETED", palette.green, palette.bgDark, colors);
    case "failed":
      return badge("FAILED", palette.red, palette.bgDark, colors);
    default:
      return badge("RUNNING", palette.yellow, palette.bgDark, colors);
  }
}

function formatCaseStatusBadge(status: SuiteCaseDetails["status"] | null, colors: boolean): string {
  if (status === null) {
    return "-";
  }

  switch (status) {
    case "pending":
      return badge("PENDING", palette.comment, palette.bgDark, colors);
    case "completed":
      return badge("COMPLETED", palette.green, palette.bgDark, colors);
    case "failed":
      return badge("FAILED", palette.red, palette.bgDark, colors);
    default:
      return badge("RUNNING", palette.yellow, palette.bgDark, colors);
  }
}

function formatLevelBadge(level: EventRecord["level"], colors: boolean): string {
  return level === "error"
    ? badge("ERR", palette.red, palette.bgDark, colors)
    : badge("INF", palette.blue, palette.bgDark, colors);
}

function badge(text: string, fg: readonly [number, number, number], bg: readonly [number, number, number], colors: boolean): string {
  return styleText(text, { fg, bg, bold: true }, colors);
}

function extractTime(isoTimestamp: string): string {
  return isoTimestamp.slice(11, 19);
}

function styleText(
  text: string,
  style: {
    fg?: readonly [number, number, number];
    bg?: readonly [number, number, number];
    bold?: boolean;
  },
  enabled: boolean
): string {
  if (!enabled) {
    return text;
  }

  const codes: string[] = [];
  if (style.bold) {
    codes.push("1");
  }
  if (style.fg) {
    codes.push(`38;2;${style.fg[0]};${style.fg[1]};${style.fg[2]}`);
  }
  if (style.bg) {
    codes.push(`48;2;${style.bg[0]};${style.bg[1]};${style.bg[2]}`);
  }

  if (codes.length === 0) {
    return text;
  }

  return `\u001b[${codes.join(";")}m${text}\u001b[0m`;
}

function shouldUseColors(): boolean {
  return Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
}

function visibleLength(text: string): number {
  return text.replace(ansiPattern, "").length;
}

function padAnsi(text: string, width: number): string {
  const padding = Math.max(width - visibleLength(text), 0);
  return `${text}${" ".repeat(padding)}`;
}

function fillBackground(
  text: string,
  bg: readonly [number, number, number],
  enabled: boolean,
  fg?: readonly [number, number, number]
): string {
  if (!enabled) {
    return text;
  }

  const codes: string[] = [];
  if (fg) {
    codes.push(`38;2;${fg[0]};${fg[1]};${fg[2]}`);
  }
  codes.push(`48;2;${bg[0]};${bg[1]};${bg[2]}`);
  const reopen = `\u001b[${codes.join(";")}m`;
  return `${reopen}${text.replace(/\u001b\[0m/g, `\u001b[0m${reopen}`)}\u001b[0m`;
}

function truncateAnsi(text: string, width: number): string {
  if (width <= 0) {
    return "";
  }

  if (visibleLength(text) <= width) {
    return text;
  }

  if (width <= 3) {
    return truncatePlain(text.replace(ansiPattern, ""), width);
  }

  const target = width - 3;
  const hadAnsi = text.includes("\u001b[");
  let result = "";
  let visible = 0;

  for (let index = 0; index < text.length && visible < target; index += 1) {
    if (text[index] === "\u001b") {
      const terminator = text.indexOf("m", index);
      if (terminator === -1) {
        break;
      }
      result += text.slice(index, terminator + 1);
      index = terminator;
      continue;
    }

    result += text[index];
    visible += 1;
  }

  return hadAnsi ? `${result}...\u001b[0m` : `${result}...`;
}

function truncatePlain(text: string, width: number): string {
  if (text.length <= width) {
    return text;
  }

  if (width <= 3) {
    return text.slice(0, width);
  }

  return `${text.slice(0, width - 3)}...`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function countRenderedLines(text: string): number {
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}
