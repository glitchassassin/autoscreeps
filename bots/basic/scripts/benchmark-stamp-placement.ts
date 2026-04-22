import { planRoomStamps } from "../src/planning/stamp-placement.ts";
import { loadBotarena212RoomPlanningFixture } from "../test/helpers/room-planning-fixture.ts";
import type { RoomPlanningRoomData } from "../src/planning/room-plan.ts";

type BenchmarkCase = {
  roomName: string;
  room: RoomPlanningRoomData;
};

type BenchmarkConfig = {
  warmupSweeps: number;
  samples: number;
  iterationsPerSample: number;
  perRoomIterations: number;
  topRooms: number;
  gcBetweenSamples: boolean;
  topK: number | null;
  roomNames: string[];
};

const defaultConfig: BenchmarkConfig = {
  warmupSweeps: 0,
  samples: 1,
  iterationsPerSample: 1,
  perRoomIterations: 1,
  topRooms: 10,
  gcBetweenSamples: true,
  topK: null,
  roomNames: []
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const cases = loadBenchmarkCases(config.roomNames);
  if (cases.length === 0) {
    throw new Error("No benchmark rooms selected.");
  }

  process.stdout.write(`Stamp-placement benchmark rooms: ${cases.length}\n`);
  process.stdout.write(`Warmup sweeps: ${config.warmupSweeps}\n`);
  process.stdout.write(`Samples: ${config.samples}\n`);
  process.stdout.write(`Iterations per sample: ${config.iterationsPerSample}\n`);
  process.stdout.write(`Per-room iterations: ${config.perRoomIterations}\n`);
  process.stdout.write(`topK: ${config.topK === null ? "adaptive" : config.topK}\n`);
  process.stdout.write(`GC between samples: ${config.gcBetweenSamples && getGlobalGc() ? "on" : "off"}\n\n`);

  let checksum = 0;
  for (let sweep = 0; sweep < config.warmupSweeps; sweep += 1) {
    checksum = runSweep(cases, config, checksum);
  }

  const sampleDurationsNs: bigint[] = [];
  for (let sample = 0; sample < config.samples; sample += 1) {
    maybeCollectGarbage(config.gcBetweenSamples);
    const start = process.hrtime.bigint();
    for (let iteration = 0; iteration < config.iterationsPerSample; iteration += 1) {
      checksum = runSweep(cases, config, checksum);
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
    process.stdout.write(`  ${result.roomName}: ${formatNs(result.averageNs)} avg\n`);
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
      case "top-k":
        config.topK = readNumberFlag(key, inlineValue, args, index);
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

function loadBenchmarkCases(requestedRoomNames: string[]): BenchmarkCase[] {
  const fixture = loadBotarena212RoomPlanningFixture();
  const selectedRoomNames = requestedRoomNames.length > 0 ? requestedRoomNames : fixture.candidateRooms;
  return selectedRoomNames.map((roomName) => {
    const room = fixture.map.getRoom(roomName);
    if (room === null) {
      throw new Error(`Fixture room '${roomName}' not found.`);
    }
    return { roomName, room };
  });
}

function runSweep(cases: BenchmarkCase[], config: BenchmarkConfig, seed: number): number {
  let checksum = seed;
  for (const testCase of cases) {
    checksum = runSingleCase(testCase, config, checksum);
  }
  return checksum;
}

function measurePerRoom(cases: BenchmarkCase[], config: BenchmarkConfig, seed: number): {
  results: Array<{ roomName: string; averageNs: bigint }>;
  checksum: number;
} {
  let checksum = seed;
  const results: Array<{ roomName: string; averageNs: bigint }> = [];

  for (const testCase of cases) {
    checksum = runSingleCase(testCase, config, checksum);
    maybeCollectGarbage(config.gcBetweenSamples);

    const start = process.hrtime.bigint();
    for (let iteration = 0; iteration < config.perRoomIterations; iteration += 1) {
      checksum = runSingleCase(testCase, config, checksum);
    }
    const duration = process.hrtime.bigint() - start;
    results.push({
      roomName: testCase.roomName,
      averageNs: duration / BigInt(config.perRoomIterations)
    });
  }

  results.sort((left, right) => right.averageNs > left.averageNs ? 1 : right.averageNs < left.averageNs ? -1 : left.roomName.localeCompare(right.roomName));
  return { results, checksum };
}

function runSingleCase(testCase: BenchmarkCase, config: BenchmarkConfig, seed: number): number {
  const options = config.topK === null ? {} : { topK: config.topK };
  const plan = planRoomStamps(testCase.room, "normal", options);
  const hub = plan.stamps.hub.anchor;
  const pod1 = plan.stamps.fastfillers[0].anchor;
  const pod2 = plan.stamps.fastfillers[1].anchor;
  const labs = plan.stamps.labs?.anchor ?? { x: 0, y: 0 };
  return (
    (seed * 33)
    ^ plan.topK
    ^ hub.x ^ (hub.y << 1)
    ^ (pod1.x << 2) ^ (pod1.y << 3)
    ^ (pod2.x << 4) ^ (pod2.y << 5)
    ^ (labs.x << 6) ^ (labs.y << 7)
  ) >>> 0;
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
  process.stdout.write(`Usage: node scripts/benchmark-stamp-placement.ts [options] [room...]

Options:
  --warmup <n>               Warmup sweeps, default ${defaultConfig.warmupSweeps}
  --samples <n>              Timed samples, default ${defaultConfig.samples}
  --iterations <n>           Sweeps per sample, default ${defaultConfig.iterationsPerSample}
  --per-room-iterations <n>  Iterations for slowest-room table, default ${defaultConfig.perRoomIterations}
  --top <n>                  Slowest rooms to print, default ${defaultConfig.topRooms}
  --top-k <n>                Disable adaptive search and force top K
  --gc-between-samples       Run global.gc() between samples when available
  --no-gc-between-samples    Do not run global.gc()
  --help                     Show this help
`);
}
