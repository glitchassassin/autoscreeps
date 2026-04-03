import type { EventRecord, RunDetails, VariantRecord } from "../../lib/contracts.ts";
import { listRunRecords, readEventTail, readRunDetails, resolveRunDir } from "../../lib/history.ts";
import { resolveRepoRoot } from "../../lib/git.ts";
import { ScreepsApiClient } from "../../lib/screeps-api.ts";
import { selectRunForWatch, summarizeLiveRoom, summarizeRecordedRoom, type WatchRoomStats } from "../../lib/watch.ts";

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

export type DashboardSnapshot = {
  mode: "follow-latest" | "pinned";
  details: RunDetails | null;
  events: EventRecord[];
  baseline: WatchRoomStats | null;
  candidate: WatchRoomStats | null;
  displayGameTime: number | null;
  targetGameTime: number | null;
  statsError: string | null;
};

type RenderDashboardOptions = {
  width?: number;
  colors?: boolean;
  clear?: boolean;
};

export async function watchExperimentCommand(runId?: string): Promise<void> {
  const repoRoot = await resolveRepoRoot(process.cwd());
  const mode = runId ? "pinned" : "follow-latest";

  if (runId) {
    await readRunDetails(repoRoot, runId);
  }

  while (true) {
    const snapshot = await collectDashboardSnapshot(repoRoot, runId, mode);
    process.stdout.write(renderDashboard(snapshot));
    await delay(pollIntervalMs);
  }
}

async function collectDashboardSnapshot(
  repoRoot: string,
  pinnedRunId: string | undefined,
  mode: DashboardSnapshot["mode"]
): Promise<DashboardSnapshot> {
  const runs = pinnedRunId
    ? [await readRunDetails(repoRoot, pinnedRunId).then((details) => details.run)]
    : await listRunRecords(repoRoot);
  const selectedRun = selectRunForWatch(runs, pinnedRunId);

  if (!selectedRun) {
    return {
      mode,
      details: null,
      events: [],
      baseline: null,
      candidate: null,
      displayGameTime: null,
      targetGameTime: null,
      statsError: null
    };
  }

  const details = await readRunDetails(repoRoot, selectedRun.id);
  const events = await readEventTail(resolveRunDir(repoRoot, selectedRun.id), eventTailLimit);
  const targetGameTime = details.run.run.startGameTime === null ? null : details.run.run.startGameTime + details.run.run.maxTicks;

  if (details.run.status !== "running") {
    return {
      mode,
      details,
      events,
      baseline: details.metrics ? summarizeRecordedRoom(details.metrics.rooms.baseline) : null,
      candidate: details.metrics ? summarizeRecordedRoom(details.metrics.rooms.candidate) : null,
      displayGameTime: details.run.run.endGameTime ?? details.run.run.startGameTime,
      targetGameTime,
      statsError: null
    };
  }

  try {
    const api = new ScreepsApiClient(details.run.server.httpUrl, { requestTimeoutMs: 1500 });
    const [gameTime, baselineRoom, candidateRoom] = await Promise.all([
      api.getGameTime(),
      api.getRoomObjects(details.run.rooms.baseline),
      api.getRoomObjects(details.run.rooms.candidate)
    ]);

    return {
      mode,
      details,
      events,
      baseline: summarizeLiveRoom(details.run.rooms.baseline, baselineRoom),
      candidate: summarizeLiveRoom(details.run.rooms.candidate, candidateRoom),
      displayGameTime: gameTime,
      targetGameTime,
      statsError: null
    };
  } catch (error) {
    return {
      mode,
      details,
      events,
      baseline: null,
      candidate: null,
      displayGameTime: details.run.run.startGameTime,
      targetGameTime,
      statsError: error instanceof Error ? error.message : String(error)
    };
  }
}

export function renderDashboard(snapshot: DashboardSnapshot, options: RenderDashboardOptions = {}): string {
  const colors = options.colors ?? shouldUseColors();
  const width = Math.max(80, options.width ?? process.stdout.columns ?? 120);
  const lines: string[] = options.clear === false ? [] : ["\u001b[2J\u001b[H"];

  lines.push(renderTitleBar(width, colors));
  lines.push("");

  if (!snapshot.details) {
    lines.push(...buildPanel(
      "Waiting For Experiment",
      [palette.blue, palette.comment],
      [
        padAnsi(styleText("Watcher Mode", { fg: palette.fgMuted, bold: true }, colors), width - 4),
        padAnsi(styleText(snapshot.mode === "pinned" ? "Pinned" : "Follow newest run", { fg: palette.blue }, colors), width - 4),
        "",
        styleText("No run.json files are available yet under .autoscreeps/runs/.", { fg: palette.fg }, colors)
      ],
      width,
      colors
    ));

    return `${lines.join("\n")}\n`;
  }

  const { run, variants } = snapshot.details;
  const summaryRows = [
    formatTwoColumnRow(
      { label: "Scenario", value: run.scenarioName },
      { label: "Watcher", value: snapshot.mode === "pinned" ? "Pinned" : "Follow newest run" },
      width - 4,
      colors
    ),
    formatTwoColumnRow(
      { label: "Run", value: run.id },
      { label: "Status", value: formatStatusBadge(run.status, colors) },
      width - 4,
      colors
    ),
    formatTwoColumnRow(
      { label: "Rooms", value: `${run.rooms.baseline} vs ${run.rooms.candidate}` },
      { label: "Tick", value: formatTickSummary(run.run.startGameTime, snapshot.displayGameTime, snapshot.targetGameTime) },
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
      { label: "Created", value: run.createdAt },
      { label: "Started", value: run.startedAt ?? "-" },
      width - 4,
      colors
    ),
    formatTwoColumnRow(
      { label: "Finished", value: run.finishedAt ?? "-" },
      { label: "Tick Duration", value: `${run.run.tickDuration}ms` },
      width - 4,
      colors
    ),
    formatWideField("Progress", formatProgressValue(run.run.startGameTime, snapshot.displayGameTime, snapshot.targetGameTime, Math.max(18, width - 34), colors), width - 4, colors)
  ];

  if (snapshot.statsError) {
    summaryRows.push(formatWideField("Live Stats", styleText(snapshot.statsError, { fg: palette.yellow }, colors), width - 4, colors));
  }

  lines.push(...buildPanel("Run Summary", [palette.blue, palette.cyan], summaryRows, width, colors));
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
      gap
    ));
  }

  lines.push("");
  lines.push(...buildPanel("Recent Events", [palette.yellow, palette.comment], formatEventRows(snapshot.events, width - 4, colors), width, colors));

  return `${lines.join("\n")}\n`;
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

function joinColumns(leftLines: string[], rightLines: string[], gap: number): string[] {
  const leftWidth = Math.max(...leftLines.map(visibleLength));
  const totalLines = Math.max(leftLines.length, rightLines.length);
  const lines: string[] = [];

  for (let index = 0; index < totalLines; index += 1) {
    const left = leftLines[index] ?? "";
    const right = rightLines[index] ?? "";
    lines.push(`${padAnsi(left, leftWidth)}${" ".repeat(gap)}${right}`.trimEnd());
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
  const labelWidth = Math.min(13, Math.max(8, width - 6));
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

function formatTickSummary(startGameTime: number | null, gameTime: number | null, targetGameTime: number | null): string {
  if (gameTime === null) {
    return startGameTime === null ? "starting" : `${startGameTime}`;
  }

  if (startGameTime === null || targetGameTime === null) {
    return `${gameTime}`;
  }

  const completedTicks = Math.max(gameTime - startGameTime, 0);
  const totalTicks = Math.max(targetGameTime - startGameTime, 1);
  const progress = Math.min((completedTicks / totalTicks) * 100, 100);
  return `${gameTime}/${targetGameTime} (${progress.toFixed(1)}%)`;
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

function formatController(stats: WatchRoomStats): string {
  if (stats.controllerLevel === null) {
    return "-";
  }

  if (stats.controllerProgress === null || stats.controllerProgressTotal === null) {
    return `RCL ${stats.controllerLevel}`;
  }

  return `RCL ${stats.controllerLevel} (${stats.controllerProgress}/${stats.controllerProgressTotal})`;
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

function formatStatusBadge(status: RunDetails["run"]["status"], colors: boolean): string {
  switch (status) {
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
