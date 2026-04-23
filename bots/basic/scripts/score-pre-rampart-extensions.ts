import { planPreRampartStructures } from "../src/planning/pre-rampart-structures.ts";
import { planRoads } from "../src/planning/road-plan.ts";
import { planSourceSinkStructures } from "../src/planning/source-sink-structure-plan.ts";
import { installScreepsGlobals } from "../test/helpers/install-globals.ts";
import { loadBotarena212RoadPlanningFixture, type CachedStampPlanCase } from "../test/helpers/stamp-plan-fixture.ts";
import { installTestPathFinder } from "../test/helpers/test-pathfinder.ts";

type ScoreConfig = {
  roomNames: string[];
  topRooms: number;
};

type ScoreRow = {
  roomName: string;
  extensions: number;
  accessRoads: number;
  totalDistance: number;
  averageDistance: number;
  maxDistance: number;
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const fixture = loadBotarena212RoadPlanningFixture();
  const config = parseArgs(process.argv.slice(2));
  const cases = selectCases(fixture.cases, config.roomNames);

  installScreepsGlobals();
  installTestPathFinder(fixture.terrainByRoom);

  const baseline = scoreCases(cases, false);
  const grown = scoreCases(cases, true);
  const baselineSummary = summarizeRows(baseline);
  const grownSummary = summarizeRows(grown);

  process.stdout.write(`Pre-rampart extension score rooms: ${cases.length}\n\n`);
  printSummary("Baseline", baselineSummary);
  printSummary("With access roads", grownSummary);
  process.stdout.write(`Delta total: ${grownSummary.totalDistance - baselineSummary.totalDistance}\n`);
  process.stdout.write(`Delta average: ${formatNumber(grownSummary.averageDistance - baselineSummary.averageDistance)}\n\n`);

  process.stdout.write(`Worst rooms with access roads (${Math.min(config.topRooms, grown.length)})\n`);
  for (const row of [...grown].sort(compareRowsByDistance).slice(0, config.topRooms)) {
    process.stdout.write(
      `  ${row.roomName}: total=${row.totalDistance}`
      + ` | avg=${formatNumber(row.averageDistance)}`
      + ` | max=${row.maxDistance}`
      + ` | extensions=${row.extensions}`
      + ` | accessRoads=${row.accessRoads}\n`
    );
  }
}

function parseArgs(args: string[]): ScoreConfig {
  const config: ScoreConfig = {
    roomNames: [],
    topRooms: 10
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      config.roomNames.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = splitFlag(arg);
    const key = rawKey.slice(2);
    switch (key) {
      case "top":
        config.topRooms = readNumberFlag(key, inlineValue, args, index);
        if (inlineValue === null) {
          index += 1;
        }
        break;
      case "help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown flag '${arg}'.`);
    }
  }

  if (config.topRooms <= 0) {
    throw new Error("--top must be a positive integer.");
  }

  return config;
}

function selectCases(cases: CachedStampPlanCase[], requestedRoomNames: string[]): CachedStampPlanCase[] {
  if (requestedRoomNames.length === 0) {
    return cases;
  }

  const byName = new Map(cases.map((testCase) => [testCase.roomName, testCase]));
  return requestedRoomNames.map((roomName) => {
    const testCase = byName.get(roomName);
    if (!testCase) {
      throw new Error(`Cached road-planning fixture room '${roomName}' not found.`);
    }
    return testCase;
  });
}

function scoreCases(cases: CachedStampPlanCase[], growAccessRoads: boolean): ScoreRow[] {
  return cases.map((testCase) => {
    const roadPlan = planRoads(testCase.room, testCase.plan);
    const sourceSinkPlan = planSourceSinkStructures(testCase.room, testCase.plan, roadPlan);
    const plan = planPreRampartStructures(testCase.room, testCase.plan, roadPlan, sourceSinkPlan, { growAccessRoads });
    const extensionSlots = plan.extraStructures.slice(0, plan.extensionCount);
    const distances = extensionSlots.map((extension) => extension.score[1] ?? 0);
    const totalDistance = distances.reduce((sum, distance) => sum + distance, 0);

    return {
      roomName: testCase.roomName,
      extensions: extensionSlots.length,
      accessRoads: plan.accessRoadTiles.length,
      totalDistance,
      averageDistance: distances.length === 0 ? 0 : totalDistance / distances.length,
      maxDistance: distances.length === 0 ? 0 : Math.max(...distances)
    };
  });
}

function summarizeRows(rows: ScoreRow[]): {
  extensions: number;
  accessRoads: number;
  totalDistance: number;
  averageDistance: number;
  maxDistance: number;
} {
  const extensions = rows.reduce((sum, row) => sum + row.extensions, 0);
  const totalDistance = rows.reduce((sum, row) => sum + row.totalDistance, 0);
  return {
    extensions,
    accessRoads: rows.reduce((sum, row) => sum + row.accessRoads, 0),
    totalDistance,
    averageDistance: extensions === 0 ? 0 : totalDistance / extensions,
    maxDistance: Math.max(...rows.map((row) => row.maxDistance))
  };
}

function printSummary(
  label: string,
  summary: ReturnType<typeof summarizeRows>
): void {
  process.stdout.write(`${label}\n`);
  process.stdout.write(`  extensions: ${summary.extensions}\n`);
  process.stdout.write(`  access roads: ${summary.accessRoads}\n`);
  process.stdout.write(`  total distance: ${summary.totalDistance}\n`);
  process.stdout.write(`  average distance: ${formatNumber(summary.averageDistance)}\n`);
  process.stdout.write(`  max distance: ${summary.maxDistance}\n\n`);
}

function compareRowsByDistance(left: ScoreRow, right: ScoreRow): number {
  if (left.totalDistance !== right.totalDistance) {
    return right.totalDistance - left.totalDistance;
  }
  return left.roomName.localeCompare(right.roomName);
}

function splitFlag(arg: string): [string, string | null] {
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex === -1) {
    return [arg, null];
  }
  return [arg.slice(0, equalsIndex), arg.slice(equalsIndex + 1)];
}

function readNumberFlag(key: string, inlineValue: string | null, args: string[], index: number): number {
  const value = inlineValue ?? args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`--${key} requires a numeric value.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`--${key} must be an integer.`);
  }
  return parsed;
}

function formatNumber(value: number): string {
  return value.toFixed(2);
}

function printHelp(): void {
  process.stdout.write(`Usage: node scripts/score-pre-rampart-extensions.ts [options] [room...]

Options:
  --top <n>  Worst rooms to print, default 10
  --help     Show this help
`);
}
