import { createDijkstraMap } from "../src/planning/dijkstra-map.ts";
import {
  blockRepairableDijkstraMap,
  blockRepairableDijkstraMapReadOnly,
  createRepairableDijkstraMap,
  createRepairableDijkstraScratch,
  getRepairedDijkstraDistance,
  type RepairableDijkstraMap,
  type RepairableDijkstraScratch
} from "../src/planning/repairable-dijkstra-map.ts";
import { getStampPathBlockedTiles } from "../src/planning/stamp-placement.ts";
import { loadBotarena212NormalStampPlanFixture } from "../test/helpers/stamp-plan-fixture.ts";

type BenchmarkCase = {
  roomName: string;
  terrain: string;
  goals: Array<{ x: number; y: number }>;
  repairedGoals: Array<{ x: number; y: number }>;
  baseBlockedTiles: number[];
  repairBlockedTiles: number[];
  combinedBlockedTiles: number[];
  targetTiles: number[];
  baseMap: RepairableDijkstraMap;
  repairScratch: RepairableDijkstraScratch;
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

type TimingResult = {
  sampleDurationsNs: bigint[];
  checksum: number;
};

const roomSize = 50;
const defaultConfig: BenchmarkConfig = {
  warmupSweeps: 100,
  samples: 40,
  iterationsPerSample: 10,
  perRoomIterations: 200,
  topRooms: 10,
  gcBetweenSamples: true,
  roomNames: []
};

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const cases = loadBenchmarkCases(config.roomNames);
  if (cases.length === 0) {
    throw new Error("No benchmark rooms selected.");
  }

  process.stdout.write(`Repairable-Dijkstra benchmark rooms: ${cases.length}\n`);
  process.stdout.write("Scenario: storage distance map after hub, then block first fastfiller path tiles\n");
  process.stdout.write("Base repairable maps are precomputed outside timed repair sweeps.\n");
  process.stdout.write(`Warmup sweeps: ${config.warmupSweeps}\n`);
  process.stdout.write(`Samples: ${config.samples}\n`);
  process.stdout.write(`Iterations per sample: ${config.iterationsPerSample}\n`);
  process.stdout.write(`Per-room iterations: ${config.perRoomIterations}\n`);
  process.stdout.write(`GC between samples: ${config.gcBetweenSamples && getGlobalGc() ? "on" : "off"}\n\n`);

  const averageStats = summarizeRepairStats(cases);
  process.stdout.write("Repair region\n");
  process.stdout.write(`  blocked tiles avg:     ${formatNumber(averageStats.blockedTiles)}\n`);
  process.stdout.write(`  invalidated tiles avg: ${formatNumber(averageStats.invalidatedTiles)}\n`);
  process.stdout.write(`  repaired tiles avg:    ${formatNumber(averageStats.repairedTiles)}\n\n`);

  const fullResult = measureSamples(cases, config, runFullRebuildSweep);
  const repairResult = measureSamples(cases, config, runRepairSweep);
  const readOnlyRepairResult = measureSamples(cases, config, runReadOnlyRepairSweep);
  const targetedRepairResult = measureSamples(cases, config, runTargetedRepairSweep);

  printTiming("Full rebuild timing", fullResult.sampleDurationsNs, config.iterationsPerSample, cases.length);
  printTiming("Repair timing", repairResult.sampleDurationsNs, config.iterationsPerSample, cases.length);
  printTiming("Read-only repair timing", readOnlyRepairResult.sampleDurationsNs, config.iterationsPerSample, cases.length);
  printTiming("Targeted repair timing", targetedRepairResult.sampleDurationsNs, config.iterationsPerSample, cases.length);

  const fullPerRoom = measurePerRoom(cases, config, runSingleFullRebuildCase, fullResult.checksum);
  const repairPerRoom = measurePerRoom(cases, config, runSingleRepairCase, repairResult.checksum);
  const readOnlyRepairPerRoom = measurePerRoom(cases, config, runSingleReadOnlyRepairCase, readOnlyRepairResult.checksum);
  const targetedRepairPerRoom = measurePerRoom(cases, config, runSingleTargetedRepairCase, targetedRepairResult.checksum);

  process.stdout.write(`Full rebuild slowest rooms (${Math.min(config.topRooms, fullPerRoom.results.length)})\n`);
  for (const result of fullPerRoom.results.slice(0, config.topRooms)) {
    process.stdout.write(`  ${result.roomName}: ${formatNs(result.averageNs)} avg\n`);
  }

  process.stdout.write(`\nRepair slowest rooms (${Math.min(config.topRooms, repairPerRoom.results.length)})\n`);
  for (const result of repairPerRoom.results.slice(0, config.topRooms)) {
    process.stdout.write(`  ${result.roomName}: ${formatNs(result.averageNs)} avg\n`);
  }

  process.stdout.write(`\nRead-only repair slowest rooms (${Math.min(config.topRooms, readOnlyRepairPerRoom.results.length)})\n`);
  for (const result of readOnlyRepairPerRoom.results.slice(0, config.topRooms)) {
    process.stdout.write(`  ${result.roomName}: ${formatNs(result.averageNs)} avg\n`);
  }

  process.stdout.write(`\nTargeted repair slowest rooms (${Math.min(config.topRooms, targetedRepairPerRoom.results.length)})\n`);
  for (const result of targetedRepairPerRoom.results.slice(0, config.topRooms)) {
    process.stdout.write(`  ${result.roomName}: ${formatNs(result.averageNs)} avg\n`);
  }

  process.stdout.write(
    `\nChecksums: full=${fullPerRoom.checksum} repair=${repairPerRoom.checksum} readOnlyRepair=${readOnlyRepairPerRoom.checksum} targetedRepair=${targetedRepairPerRoom.checksum}\n`
  );
}

function measureSamples(
  cases: BenchmarkCase[],
  config: BenchmarkConfig,
  runSweep: (cases: BenchmarkCase[], seed: number) => number
): TimingResult {
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

  return { sampleDurationsNs, checksum };
}

function printTiming(title: string, sampleDurationsNs: bigint[], iterationsPerSample: number, roomCount: number): void {
  const sweepStats = summarizeNs(sampleDurationsNs.map((duration) => duration / BigInt(iterationsPerSample)));
  const roomStats = summarizeNs(sampleDurationsNs.map((duration) => duration / BigInt(iterationsPerSample * roomCount)));

  process.stdout.write(`${title}\n`);
  process.stdout.write("  Full sweep\n");
  process.stdout.write(`    min:    ${formatNs(sweepStats.min)}\n`);
  process.stdout.write(`    median: ${formatNs(sweepStats.median)}\n`);
  process.stdout.write(`    p95:    ${formatNs(sweepStats.p95)}\n`);
  process.stdout.write(`    max:    ${formatNs(sweepStats.max)}\n`);
  process.stdout.write("  Per room\n");
  process.stdout.write(`    min:    ${formatNs(roomStats.min)}\n`);
  process.stdout.write(`    median: ${formatNs(roomStats.median)}\n`);
  process.stdout.write(`    p95:    ${formatNs(roomStats.p95)}\n`);
  process.stdout.write(`    max:    ${formatNs(roomStats.max)}\n\n`);
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

function loadBenchmarkCases(requestedRoomNames: string[]): BenchmarkCase[] {
  const fixture = loadBotarena212NormalStampPlanFixture();
  const selectedCases = requestedRoomNames.length === 0
    ? fixture.cases
    : requestedRoomNames.map((roomName) => {
      const testCase = fixture.cases.find((candidate) => candidate.roomName === roomName);
      if (!testCase) {
        throw new Error(`Cached stamp fixture room '${roomName}' not found.`);
      }
      return testCase;
    });
  const cases: BenchmarkCase[] = [];

  for (const testCase of selectedCases) {
    const hub = testCase.plan.stamps.hub;
    const pod = testCase.plan.stamps.fastfillers[0];
    const storage = hub.anchors.storage ?? hub.anchor;
    const baseBlockedTiles = getStampPathBlockedTiles(hub);
    const repairBlockedTiles = getAddedPathBlockedTiles(pod);
    const combinedBlockedTiles = [...baseBlockedTiles, ...repairBlockedTiles];
    const goals = getOpenNeighbors(testCase.room.terrain, storage, baseBlockedTiles);
    const repairedGoals = getOpenNeighbors(testCase.room.terrain, storage, combinedBlockedTiles);
    if (goals.length === 0 || repairedGoals.length === 0) {
      continue;
    }

    cases.push({
      roomName: testCase.roomName,
      terrain: testCase.room.terrain,
      goals,
      repairedGoals,
      baseBlockedTiles,
      repairBlockedTiles,
      combinedBlockedTiles,
      targetTiles: [toIndex(pod.anchor.x, pod.anchor.y)],
      baseMap: createRepairableDijkstraMap(testCase.room.terrain, goals, {
        costMatrix: new BlockedCostMatrix(baseBlockedTiles)
      }),
      repairScratch: createRepairableDijkstraScratch()
    });
  }

  return cases;
}

function runFullRebuildSweep(cases: BenchmarkCase[], seed: number): number {
  let checksum = seed;
  for (const testCase of cases) {
    checksum = runSingleFullRebuildCase(testCase, checksum);
  }
  return checksum;
}

function runRepairSweep(cases: BenchmarkCase[], seed: number): number {
  let checksum = seed;
  for (const testCase of cases) {
    checksum = runSingleRepairCase(testCase, checksum);
  }
  return checksum;
}

function runReadOnlyRepairSweep(cases: BenchmarkCase[], seed: number): number {
  let checksum = seed;
  for (const testCase of cases) {
    checksum = runSingleReadOnlyRepairCase(testCase, checksum);
  }
  return checksum;
}

function runTargetedRepairSweep(cases: BenchmarkCase[], seed: number): number {
  let checksum = seed;
  for (const testCase of cases) {
    checksum = runSingleTargetedRepairCase(testCase, checksum);
  }
  return checksum;
}

function runSingleFullRebuildCase(testCase: BenchmarkCase, seed: number): number {
  const map = createDijkstraMap(testCase.terrain, testCase.repairedGoals, {
    costMatrix: new BlockedCostMatrix(testCase.combinedBlockedTiles)
  });
  return foldMapChecksum(map.distances, seed);
}

function runSingleRepairCase(testCase: BenchmarkCase, seed: number): number {
  const { map } = blockRepairableDijkstraMap(testCase.baseMap, testCase.repairBlockedTiles);
  return foldMapChecksum(map.distances, seed);
}

function runSingleReadOnlyRepairCase(testCase: BenchmarkCase, seed: number): number {
  const { map } = blockRepairableDijkstraMapReadOnly(testCase.baseMap, testCase.repairBlockedTiles);
  return foldMapChecksum(map.distances, seed);
}

function runSingleTargetedRepairCase(testCase: BenchmarkCase, seed: number): number {
  const { distance } = getRepairedDijkstraDistance(testCase.baseMap, testCase.repairBlockedTiles, testCase.targetTiles, testCase.repairScratch);
  return foldDistanceChecksum(distance, seed);
}

function measurePerRoom(
  cases: BenchmarkCase[],
  config: BenchmarkConfig,
  runSingleCase: (testCase: BenchmarkCase, seed: number) => number,
  seed: number
): {
  results: Array<{ roomName: string; averageNs: bigint }>;
  checksum: number;
} {
  let checksum = seed;
  const results: Array<{ roomName: string; averageNs: bigint }> = [];

  for (const testCase of cases) {
    checksum = runSingleCase(testCase, checksum);
    maybeCollectGarbage(config.gcBetweenSamples);

    const start = process.hrtime.bigint();
    for (let iteration = 0; iteration < config.perRoomIterations; iteration += 1) {
      checksum = runSingleCase(testCase, checksum);
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

function summarizeRepairStats(cases: BenchmarkCase[]): { blockedTiles: number; invalidatedTiles: number; repairedTiles: number } {
  let blockedTiles = 0;
  let invalidatedTiles = 0;
  let repairedTiles = 0;

  for (const testCase of cases) {
    const { stats } = blockRepairableDijkstraMap(testCase.baseMap, testCase.repairBlockedTiles);
    blockedTiles += stats.blockedTiles;
    invalidatedTiles += stats.invalidatedTiles;
    repairedTiles += stats.repairedTiles;
  }

  return {
    blockedTiles: blockedTiles / cases.length,
    invalidatedTiles: invalidatedTiles / cases.length,
    repairedTiles: repairedTiles / cases.length
  };
}

class BlockedCostMatrix implements Pick<PathFinder["CostMatrix"], "get"> {
  private readonly blocked = new Uint8Array(roomSize * roomSize);

  constructor(blockedTiles: readonly number[]) {
    for (const tile of blockedTiles) {
      if (tile >= 0 && tile < this.blocked.length) {
        this.blocked[tile] = 1;
      }
    }
  }

  get(x: number, y: number): number {
    return this.blocked[toIndex(x, y)] === 0 ? 0 : 255;
  }
}

function getOpenNeighbors(terrain: string, target: { x: number; y: number }, blockedTiles: readonly number[]): Array<{ x: number; y: number }> {
  const blocked = new Set(blockedTiles);
  const goals: Array<{ x: number; y: number }> = [];

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const x = target.x + dx;
      const y = target.y + dy;
      if (x < 0 || x >= roomSize || y < 0 || y >= roomSize) {
        continue;
      }
      const tile = toIndex(x, y);
      if (blocked.has(tile) || ((terrain.charCodeAt(tile) - 48) & 1) !== 0) {
        continue;
      }
      goals.push({ x, y });
    }
  }

  return goals;
}

function getAddedPathBlockedTiles(stamp: Parameters<typeof getStampPathBlockedTiles>[0]): number[] {
  const pathBlockedTiles = getStampPathBlockedTiles(stamp);
  if (stamp.kind !== "fastfiller") {
    return pathBlockedTiles;
  }

  const anchorTile = toIndex(stamp.anchor.x, stamp.anchor.y);
  return pathBlockedTiles.filter((tile) => tile !== anchorTile);
}

function foldMapChecksum(distances: Uint32Array, seed: number): number {
  let checksum = seed;
  for (let index = 0; index < distances.length; index += 97) {
    checksum = ((checksum * 33) ^ distances[index]!) >>> 0;
  }
  return checksum;
}

function foldDistanceChecksum(distance: number, seed: number): number {
  return ((seed * 33) ^ distance) >>> 0;
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

function formatNumber(value: number): string {
  return value.toFixed(2);
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
  process.stdout.write(`Usage: npm run benchmark:repairable-dijkstra -- [room ...] [options]

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

function toIndex(x: number, y: number): number {
  return y * roomSize + x;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
