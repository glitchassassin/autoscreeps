import { createDijkstraMap, type DijkstraMapOptions, type DijkstraGoal } from "../src/planning/dijkstra-map.ts";
import { loadBotarena212RoomPlanningFixture } from "../test/helpers/room-planning-fixture.ts";

type BenchmarkCase = {
  roomName: string;
  terrain: string;
  goals: DijkstraGoal[];
};

type BenchmarkConfig = {
  warmupSweeps: number;
  samples: number;
  iterationsPerSample: number;
  perRoomIterations: number;
  topRooms: number;
  gcBetweenSamples: boolean;
  dijkstraOptions: DijkstraMapOptions;
  roomNames: string[];
};

const roomAreaCenterIndex = 25 * 50 + 25;

const defaultConfig: BenchmarkConfig = {
  warmupSweeps: 100,
  samples: 40,
  iterationsPerSample: 10,
  perRoomIterations: 200,
  topRooms: 10,
  gcBetweenSamples: true,
  dijkstraOptions: {
    plainCost: 2,
    swampCost: 10,
    wallCost: null,
    costMatrix: null
  },
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

  process.stdout.write(`Dijkstra benchmark rooms: ${cases.length}\n`);
  process.stdout.write(`Warmup sweeps: ${config.warmupSweeps}\n`);
  process.stdout.write(`Samples: ${config.samples}\n`);
  process.stdout.write(`Iterations per sample: ${config.iterationsPerSample}\n`);
  process.stdout.write(`Per-room iterations: ${config.perRoomIterations}\n`);
  process.stdout.write(`Costs: plain=${config.dijkstraOptions.plainCost ?? 2}, swamp=${config.dijkstraOptions.swampCost ?? 10}, wall=${config.dijkstraOptions.wallCost ?? "blocked"}\n`);
  process.stdout.write(`GC between samples: ${config.gcBetweenSamples && getGlobalGc() ? "on" : "off"}\n\n`);

  let checksum = 0;

  for (let sweep = 0; sweep < config.warmupSweeps; sweep += 1) {
    checksum = runSweep(cases, config.dijkstraOptions, checksum);
  }

  const sampleDurationsNs: bigint[] = [];

  for (let sample = 0; sample < config.samples; sample += 1) {
    maybeCollectGarbage(config.gcBetweenSamples);
    const start = process.hrtime.bigint();

    for (let iteration = 0; iteration < config.iterationsPerSample; iteration += 1) {
      checksum = runSweep(cases, config.dijkstraOptions, checksum);
    }

    const duration = process.hrtime.bigint() - start;
    sampleDurationsNs.push(duration);
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

  const perRoomResults = measurePerRoom(cases, config.perRoomIterations, config.dijkstraOptions, config.gcBetweenSamples, checksum);
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
    dijkstraOptions: { ...defaultConfig.dijkstraOptions },
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
      case "plain-cost":
        config.dijkstraOptions.plainCost = readNumberFlag(key, inlineValue, args, index);
        if (inlineValue === null) {
          index += 1;
        }
        break;
      case "swamp-cost":
        config.dijkstraOptions.swampCost = readNumberFlag(key, inlineValue, args, index);
        if (inlineValue === null) {
          index += 1;
        }
        break;
      case "wall-cost": {
        const value = readStringFlag(key, inlineValue, args, index);
        if (inlineValue === null) {
          index += 1;
        }
        config.dijkstraOptions.wallCost = value === "blocked" ? null : parseIntegerFlag(key, value);
        break;
      }
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
  const cases: BenchmarkCase[] = [];

  for (const roomName of selectedRoomNames) {
    const room = fixture.map.getRoom(roomName);
    if (room === null) {
      throw new Error(`Fixture room '${roomName}' not found.`);
    }

    const controller = room.objects.find((object) => object.type === "controller");
    if (!controller) {
      throw new Error(`Fixture room '${roomName}' is missing a controller.`);
    }

    cases.push({
      roomName,
      terrain: room.terrain,
      goals: [{ x: controller.x, y: controller.y }]
    });
  }

  return cases;
}

function runSweep(cases: BenchmarkCase[], options: DijkstraMapOptions, seed: number): number {
  let checksum = seed;

  for (const testCase of cases) {
    const map = createDijkstraMap(testCase.terrain, testCase.goals, options);
    checksum = foldMapChecksum(map.distances, checksum);
  }

  return checksum;
}

function measurePerRoom(cases: BenchmarkCase[], iterations: number, options: DijkstraMapOptions, gcBetweenSamples: boolean, seed: number): {
  results: Array<{ roomName: string; averageNs: bigint }>;
  checksum: number;
} {
  let checksum = seed;
  const results: Array<{ roomName: string; averageNs: bigint }> = [];

  for (const testCase of cases) {
    checksum = runSingleCase(testCase, options, checksum);
    maybeCollectGarbage(gcBetweenSamples);

    const start = process.hrtime.bigint();
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      checksum = runSingleCase(testCase, options, checksum);
    }
    const duration = process.hrtime.bigint() - start;

    results.push({
      roomName: testCase.roomName,
      averageNs: duration / BigInt(iterations)
    });
  }

  results.sort((left, right) => right.averageNs > left.averageNs ? 1 : right.averageNs < left.averageNs ? -1 : left.roomName.localeCompare(right.roomName));
  return { results, checksum };
}

function runSingleCase(testCase: BenchmarkCase, options: DijkstraMapOptions, seed: number): number {
  const map = createDijkstraMap(testCase.terrain, testCase.goals, options);
  return foldMapChecksum(map.distances, seed);
}

function foldMapChecksum(distances: Uint32Array, seed: number): number {
  return (
    (seed * 33)
    ^ distances[0]!
    ^ distances[roomAreaCenterIndex]!
    ^ distances[distances.length - 1]!
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

function percentile(sorted: bigint[], ratio: number): bigint {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index]!;
}

function formatNs(value: bigint): string {
  const valueNumber = Number(value);
  if (valueNumber >= 1_000_000) {
    return `${(valueNumber / 1_000_000).toFixed(3)} ms`;
  }

  if (valueNumber >= 1_000) {
    return `${(valueNumber / 1_000).toFixed(3)} us`;
  }

  return `${valueNumber} ns`;
}

function splitFlag(flag: string): [string, string | null] {
  const equalsIndex = flag.indexOf("=");
  if (equalsIndex === -1) {
    return [flag, null];
  }

  return [flag.slice(0, equalsIndex), flag.slice(equalsIndex + 1)];
}

function readNumberFlag(name: string, inlineValue: string | null, args: string[], index: number): number {
  return parseIntegerFlag(name, readStringFlag(name, inlineValue, args, index));
}

function parseIntegerFlag(name: string, value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Flag '--${name}' expects an integer value.`);
  }

  return parsed;
}

function readStringFlag(name: string, inlineValue: string | null, args: string[], index: number): string {
  if (inlineValue !== null) {
    return inlineValue;
  }

  const nextValue = args[index + 1];
  if (!nextValue || nextValue.startsWith("--")) {
    throw new Error(`Flag '--${name}' expects a value.`);
  }

  return nextValue;
}

function printHelp(): void {
  process.stdout.write(`Usage: npm run benchmark:dijkstra -- [room ...] [options]\n\n`);
  process.stdout.write(`Positional room names limit the benchmark to those rooms.\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --warmup <n>               Warmup full sweeps before sampling (default: 100)\n`);
  process.stdout.write(`  --samples <n>              Number of measured samples (default: 40)\n`);
  process.stdout.write(`  --iterations <n>           Full sweeps per measured sample (default: 10)\n`);
  process.stdout.write(`  --per-room-iterations <n>  Iterations for the slowest-room breakdown (default: 200)\n`);
  process.stdout.write(`  --top <n>                  Number of slowest rooms to print (default: 10)\n`);
  process.stdout.write(`  --plain-cost <n>           Plain terrain cost (default: 2)\n`);
  process.stdout.write(`  --swamp-cost <n>           Swamp terrain cost (default: 10)\n`);
  process.stdout.write(`  --wall-cost <n|blocked>    Wall movement cost or blocked (default: blocked)\n`);
  process.stdout.write(`  --gc-between-samples       Force GC between measured samples when available\n`);
  process.stdout.write(`  --no-gc-between-samples    Disable forced GC between measured samples\n`);
}
