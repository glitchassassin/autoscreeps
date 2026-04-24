import { planRoads, type RoadPlan } from "../src/planning/road-plan.ts";
import type { RoomPlanningRoomData } from "../src/planning/room-plan.ts";
import { planSourceSinkStructures, type SourceSinkStructurePlan } from "../src/planning/source-sink-structure-plan.ts";
import type { RoomStampPlan } from "../src/planning/stamp-placement.ts";
import { installScreepsGlobals } from "../test/helpers/install-globals.ts";
import { loadBotarena212RoadPlanningFixture, type CachedStampPlanCase } from "../test/helpers/stamp-plan-fixture.ts";
import { installTestPathFinder } from "../test/helpers/test-pathfinder.ts";

type BenchmarkCase = {
  roomName: string;
  room: RoomPlanningRoomData;
  stampPlan: RoomStampPlan;
  roadPlan: RoadPlan;
};

type BenchmarkConfig = {
  warmupSweeps: number;
  samples: number;
  iterationsPerSample: number;
  perRoomIterations: number;
  topRooms: number;
  gcBetweenSamples: boolean;
  roomNames: string[];
};

const defaultConfig: BenchmarkConfig = {
  warmupSweeps: 0,
  samples: 1,
  iterationsPerSample: 1,
  perRoomIterations: 1,
  topRooms: 10,
  gcBetweenSamples: true,
  roomNames: []
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const fixture = loadBotarena212RoadPlanningFixture();

  installScreepsGlobals();
  installTestPathFinder(fixture.terrainByRoom);

  const cases = loadBenchmarkCases(fixture.cases, config.roomNames);
  if (cases.length === 0) {
    throw new Error("No benchmark rooms selected.");
  }

  process.stdout.write(`Source/sink structure benchmark rooms: ${cases.length}\n`);
  process.stdout.write("Inputs: cached stamp fixtures + precomputed road plans\n");
  process.stdout.write(`Warmup sweeps: ${config.warmupSweeps}\n`);
  process.stdout.write(`Samples: ${config.samples}\n`);
  process.stdout.write(`Iterations per sample: ${config.iterationsPerSample}\n`);
  process.stdout.write(`Per-room iterations: ${config.perRoomIterations}\n`);
  process.stdout.write(`GC between samples: ${config.gcBetweenSamples && getGlobalGc() ? "on" : "off"}\n\n`);

  let checksum = 0;
  for (let sweep = 0; sweep < config.warmupSweeps; sweep += 1) {
    checksum = runSweep(cases, checksum);
  }

  const sampleDurationsNs: bigint[] = [];
  for (let sample = 0; sample < config.samples; sample += 1) {
    maybeCollectGarbage(config.gcBetweenSamples);
    const start = process.hrtime.bigint();
    for (let iteration = 0; iteration < config.iterationsPerSample; iteration += 1) {
      checksum = runSweep(cases, checksum);
    }
    sampleDurationsNs.push(process.hrtime.bigint() - start);
  }

  const sweepStats = summarizeNs(sampleDurationsNs.map((duration) => duration / BigInt(config.iterationsPerSample)));
  const roomStats = summarizeNs(sampleDurationsNs.map((duration) => duration / BigInt(config.iterationsPerSample * cases.length)));

  process.stdout.write("Full sweep timing\n");
  process.stdout.write(`  min:    ${formatNs(sweepStats.min)}\n`);
  process.stdout.write(`  median: ${formatNs(sweepStats.median)}\n`);
  process.stdout.write(`  p95:    ${formatNs(sweepStats.p95)}\n`);
  process.stdout.write(`  max:    ${formatNs(sweepStats.max)}\n\n`);

  process.stdout.write("Per room timing\n");
  process.stdout.write(`  min:    ${formatNs(roomStats.min)}\n`);
  process.stdout.write(`  median: ${formatNs(roomStats.median)}\n`);
  process.stdout.write(`  p95:    ${formatNs(roomStats.p95)}\n`);
  process.stdout.write(`  max:    ${formatNs(roomStats.max)}\n\n`);

  const perRoomResults = measurePerRoom(cases, config, checksum);
  checksum = perRoomResults.checksum;

  process.stdout.write(`Slowest rooms (${Math.min(config.topRooms, perRoomResults.results.length)})\n`);
  for (const result of perRoomResults.results.slice(0, config.topRooms)) {
    process.stdout.write(
      `  ${result.roomName}: ${formatNs(result.averageNs)} avg`
      + ` | structures=${result.structures}`
      + ` | tiles=${result.structureTiles}`
      + ` | containers=${result.containers}`
      + ` | links=${result.links}`
      + ` | extractors=${result.extractors}\n`
    );
  }

  process.stdout.write(`\nChecksum: ${checksum}\n`);
}

function parseArgs(args: string[]): BenchmarkConfig {
  const config: BenchmarkConfig = {
    ...defaultConfig,
    roomNames: []
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
      case "warmup":
        config.warmupSweeps = readNumberFlag(key, inlineValue, args, index);
        if (inlineValue === null) {
          index += 1;
        }
        break;
      case "samples":
        config.samples = readNumberFlag(key, inlineValue, args, index);
        if (inlineValue === null) {
          index += 1;
        }
        break;
      case "iterations":
        config.iterationsPerSample = readNumberFlag(key, inlineValue, args, index);
        if (inlineValue === null) {
          index += 1;
        }
        break;
      case "per-room-iterations":
        config.perRoomIterations = readNumberFlag(key, inlineValue, args, index);
        if (inlineValue === null) {
          index += 1;
        }
        break;
      case "top":
        config.topRooms = readNumberFlag(key, inlineValue, args, index);
        if (inlineValue === null) {
          index += 1;
        }
        break;
      case "gc-between-samples":
        config.gcBetweenSamples = true;
        break;
      case "no-gc-between-samples":
        config.gcBetweenSamples = false;
        break;
      case "help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown flag '${arg}'.`);
    }
  }

  if (config.warmupSweeps < 0 || config.samples <= 0 || config.iterationsPerSample <= 0 || config.perRoomIterations <= 0 || config.topRooms <= 0) {
    throw new Error("Benchmark counts must be positive integers, with warmup >= 0.");
  }

  return config;
}

function loadBenchmarkCases(cases: CachedStampPlanCase[], requestedRoomNames: string[]): BenchmarkCase[] {
  return selectCases(cases, requestedRoomNames).map((testCase) => ({
    roomName: testCase.roomName,
    room: testCase.room,
    stampPlan: testCase.plan,
    roadPlan: planRoads(testCase.room, testCase.plan)
  }));
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

function runSweep(cases: BenchmarkCase[], seed: number): number {
  let checksum = seed;
  for (const testCase of cases) {
    checksum = runSingleCase(testCase, checksum);
  }
  return checksum;
}

function measurePerRoom(cases: BenchmarkCase[], config: BenchmarkConfig, seed: number): {
  results: Array<{
    roomName: string;
    averageNs: bigint;
    structures: number;
    structureTiles: number;
    containers: number;
    links: number;
    extractors: number;
  }>;
  checksum: number;
} {
  let checksum = seed;
  const results: Array<{
    roomName: string;
    averageNs: bigint;
    structures: number;
    structureTiles: number;
    containers: number;
    links: number;
    extractors: number;
  }> = [];

  for (const testCase of cases) {
    const plan = planSourceSinkStructures(testCase.room, testCase.stampPlan, testCase.roadPlan);
    checksum = updateChecksum(checksum, plan);
    maybeCollectGarbage(config.gcBetweenSamples);

    const start = process.hrtime.bigint();
    for (let iteration = 0; iteration < config.perRoomIterations; iteration += 1) {
      checksum = runSingleCase(testCase, checksum);
    }
    const duration = process.hrtime.bigint() - start;
    const counts = countByType(plan);
    results.push({
      roomName: testCase.roomName,
      averageNs: duration / BigInt(config.perRoomIterations),
      structures: plan.structures.length,
      structureTiles: plan.structureTiles.length,
      containers: counts.get("container") ?? 0,
      links: counts.get("link") ?? 0,
      extractors: counts.get("extractor") ?? 0
    });
  }

  results.sort((left, right) => right.averageNs > left.averageNs ? 1 : right.averageNs < left.averageNs ? -1 : left.roomName.localeCompare(right.roomName));
  return { results, checksum };
}

function runSingleCase(testCase: BenchmarkCase, seed: number): number {
  return updateChecksum(seed, planSourceSinkStructures(testCase.room, testCase.stampPlan, testCase.roadPlan));
}

function updateChecksum(seed: number, plan: SourceSinkStructurePlan): number {
  let checksum = (
    (seed * 33)
    ^ plan.structures.length
    ^ (plan.structureTiles.length << 2)
  ) >>> 0;

  for (const structure of plan.structures) {
    checksum = ((checksum * 33) ^ structure.tile ^ (structure.rcl << 8) ^ structure.type.charCodeAt(0)) >>> 0;
  }

  return checksum;
}

function countByType(plan: SourceSinkStructurePlan): Map<string, number> {
  const counts = new Map<string, number>();
  for (const structure of plan.structures) {
    counts.set(structure.type, (counts.get(structure.type) ?? 0) + 1);
  }
  return counts;
}

function maybeCollectGarbage(enabled: boolean): void {
  const gc = getGlobalGc();
  if (enabled && gc) {
    gc();
  }
}

function getGlobalGc(): (() => void) | null {
  const runtime = globalThis as typeof globalThis & { gc?: () => void };
  return typeof runtime.gc === "function" ? runtime.gc : null;
}

function summarizeNs(values: bigint[]): { min: bigint; median: bigint; p95: bigint; max: bigint } {
  const sorted = [...values].sort((left, right) => left > right ? 1 : left < right ? -1 : 0);
  return {
    min: sorted[0]!,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1]!
  };
}

function percentile(sorted: bigint[], fraction: number): bigint {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index]!;
}

function formatNs(ns: bigint): string {
  if (ns < 1_000n) {
    return `${ns} ns`;
  }
  if (ns < 1_000_000n) {
    return `${formatDecimal(ns, 1_000n)} us`;
  }
  if (ns < 1_000_000_000n) {
    return `${formatDecimal(ns, 1_000_000n)} ms`;
  }
  return `${formatDecimal(ns, 1_000_000_000n)} s`;
}

function formatDecimal(value: bigint, divisor: bigint): string {
  const whole = value / divisor;
  const tenths = value % divisor * 10n / divisor;
  return `${whole}.${tenths}`;
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

function printHelp(): void {
  process.stdout.write(`Usage: node scripts/benchmark-source-sink-structures.ts [options] [room...]

Options:
  --warmup <n>               Warmup sweeps, default ${defaultConfig.warmupSweeps}
  --samples <n>              Timed samples, default ${defaultConfig.samples}
  --iterations <n>           Sweeps per sample, default ${defaultConfig.iterationsPerSample}
  --per-room-iterations <n>  Iterations for slowest-room table, default ${defaultConfig.perRoomIterations}
  --top <n>                  Slowest rooms to print, default ${defaultConfig.topRooms}
  --gc-between-samples       Run global.gc() between samples when available
  --no-gc-between-samples    Do not run global.gc()
  --help                     Show this help
`);
}
