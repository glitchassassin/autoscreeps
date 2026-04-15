import { runTick } from "./core/run-tick";
import type { TickResult, WorldSnapshot } from "./core/types";
import { recordBotError } from "./state/telemetry";
import { createCpuProfiler, measureCpu } from "./telemetry/cpu-profiler";
import { recordTelemetry } from "./telemetry/report";
import { observeWorld } from "./world/observe";

export const loop = (): void => {
  let result: TickResult | null = null;
  let world: WorldSnapshot | null = null;
  const profiler = createCpuProfiler();

  try {
    result = runTick(profiler);
    world = result.world;
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    recordBotError(message);
  }

  world ??= measureCpu(profiler, "observeFallback", () => observeWorld());
  recordTelemetry(world, result?.plan, result?.execution, profiler);
};
