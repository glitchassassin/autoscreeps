import { createFloodFill, type FloodFillSeed } from "../src/planning/flood-fill.ts";
import { loadBotarena212RoomPlanningFixture } from "../test/helpers/room-planning-fixture.ts";

type SeedMode = "controller" | "sources" | "controller-and-sources";

type BenchmarkCase = {
  roomName: string;
  mask: Uint8Array;
  seeds: FloodFillSeed[];
};

type BenchmarkConfig = {
  warmupSweeps: number;
  samples: number;
  iterationsPerSample: number;
  perRoomIterations: number;
  topRooms: number;
  gcBetweenSamples: boolean;
  seedMode: SeedMode;
  roomNames: string[];
};

const roomArea = 50 * 50;
const roomAreaCenterIndex = 25 * 50 + 25;
const terrainMaskWall = 1;

const defaultConfig: BenchmarkConfig = {
  warmupSweeps: 100,
  samples: 40,
  iterationsPerSample: 10,
  perRoomIterations: 200,
  topRooms: 10,
  gcBetweenSamples: true,
  seedMode: "controller",
  roomNames: []
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const cases = loadBenchmarkCases(config.roomNames, config.seedMode);
  if (cases.length === 0) {
    throw new Error("No benchmark rooms selected.");
  }

  process.stdout.write(`Flood-fill benchmark rooms: ${cases.length}\n`);
  process.stdout.write(`Warmup sweeps: ${config.warmupSweeps}\n`);
  process.stdout.write(`Samples: ${config.samples}\n`);
  process.stdout.write(`Iterations per sample: ${config.iterationsPerSample}\n`);
  process.stdout.write(`Per-room iterations: ${config.perRoomIterations}\n`);
  process.stdout.write(`Mask: walkable terrain\n`);
  process.stdout.write(`Seeds: walkable range 1 around ${config.seedMode}\n`);
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

  const perRoomResults = measurePerRoom(cases, config.perRoomIterations, config.gcBetweenSamples, checksum);
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
      case "seeds": {
        const value = readStringFlag(key, inlineValue, args, index);
        if (inlineValue === null) {
          index += 1;
        }
        config.seedMode = parseSeedMode(value);
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

function loadBenchmarkCases(requestedRoomNames: string[], seedMode: SeedMode): BenchmarkCase[] {
  const fixture = loadBotarena212RoomPlanningFixture();
  const selectedRoomNames = requestedRoomNames.length > 0 ? requestedRoomNames : fixture.candidateRooms;
  const cases: BenchmarkCase[] = [];

  for (const roomName of selectedRoomNames) {
    const room = fixture.map.getRoom(roomName);
    if (room === null) {
      throw new Error(`Fixture room '${roomName}' not found.`);
    }

    const mask = createWalkableTerrainMask(room.terrain);
    const seeds = selectSeeds(room.objects, mask, seedMode);
    if (seeds.length === 0) {
      throw new Error(`Room '${roomName}' has no seeds for mode '${seedMode}'.`);
    }

    cases.push({
      roomName,
      mask,
      seeds
    });
  }

  return cases;
}

function createWalkableTerrainMask(terrain: string): Uint8Array {
  if (terrain.length !== roomArea) {
    throw new Error(`Expected terrain string length ${roomArea}, received ${terrain.length}.`);
  }

  const mask = new Uint8Array(roomArea);

  for (let index = 0; index < roomArea; index += 1) {
    const terrainCode = terrain.charCodeAt(index) - 48;
    if ((terrainCode & terrainMaskWall) === 0) {
      mask[index] = 1;
    }
  }

  return mask;
}

function selectSeeds(
  objects: Array<{ type: string; x: number; y: number }>,
  mask: Uint8Array,
  seedMode: SeedMode
): FloodFillSeed[] {
  const seeds: FloodFillSeed[] = [];
  const seen = new Uint8Array(roomArea);
  const targets = selectSeedObjects(objects, seedMode);

  for (const target of targets) {
    const minX = Math.max(0, target.x - 1);
    const maxX = Math.min(49, target.x + 1);
    const minY = Math.max(0, target.y - 1);
    const maxY = Math.min(49, target.y + 1);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const index = y * 50 + x;
        if (mask[index] === 0 || seen[index] !== 0) {
          continue;
        }

        seen[index] = 1;
        seeds.push({ x, y });
      }
    }
  }

  return seeds;
}

function selectSeedObjects(
  objects: Array<{ type: string; x: number; y: number }>,
  seedMode: SeedMode
): Array<{ type: string; x: number; y: number }> {
  switch (seedMode) {
    case "controller":
      return objects.filter((object) => object.type === "controller");
    case "sources":
      return objects.filter((object) => object.type === "source");
    case "controller-and-sources":
      return objects.filter((object) => object.type === "controller" || object.type === "source");
  }
}

function runSweep(cases: BenchmarkCase[], seed: number): number {
  let checksum = seed;

  for (const testCase of cases) {
    const fill = createFloodFill(testCase.mask, testCase.seeds);
    checksum = foldChecksum(fill.visited, fill.visitedCount, checksum);
  }

  return checksum;
}

function measurePerRoom(cases: BenchmarkCase[], iterations: number, gcBetweenSamples: boolean, seed: number): {
  results: Array<{ roomName: string; averageNs: bigint }>;
  checksum: number;
} {
  let checksum = seed;
  const results: Array<{ roomName: string; averageNs: bigint }> = [];

  for (const testCase of cases) {
    checksum = runSingleCase(testCase, checksum);
    maybeCollectGarbage(gcBetweenSamples);

    const start = process.hrtime.bigint();
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      checksum = runSingleCase(testCase, checksum);
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

function runSingleCase(testCase: BenchmarkCase, seed: number): number {
  const fill = createFloodFill(testCase.mask, testCase.seeds);
  return foldChecksum(fill.visited, fill.visitedCount, seed);
}

function foldChecksum(visited: Uint8Array, visitedCount: number, seed: number): number {
  return (
    (seed * 33)
    ^ visitedCount
    ^ visited[0]!
    ^ visited[roomAreaCenterIndex]!
    ^ visited[visited.length - 1]!
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

function parseSeedMode(value: string): SeedMode {
  if (value === "controller" || value === "sources" || value === "controller-and-sources") {
    return value;
  }

  throw new Error(`Flag '--seeds' expects one of: controller, sources, controller-and-sources.`);
}

function printHelp(): void {
  process.stdout.write(`Usage: npm run benchmark:flood-fill -- [room ...] [options]\n\n`);
  process.stdout.write(`Positional room names limit the benchmark to those rooms.\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --warmup <n>               Warmup full sweeps before sampling (default: 100)\n`);
  process.stdout.write(`  --samples <n>              Number of measured samples (default: 40)\n`);
  process.stdout.write(`  --iterations <n>           Full sweeps per measured sample (default: 10)\n`);
  process.stdout.write(`  --per-room-iterations <n>  Iterations for the slowest-room breakdown (default: 200)\n`);
  process.stdout.write(`  --top <n>                  Number of slowest rooms to print (default: 10)\n`);
  process.stdout.write(`  --seeds <mode>             Seed mode: controller, sources, controller-and-sources (default: controller)\n`);
  process.stdout.write(`  --gc-between-samples       Force GC between measured samples when available\n`);
  process.stdout.write(`  --no-gc-between-samples    Disable forced GC between measured samples\n`);
}
