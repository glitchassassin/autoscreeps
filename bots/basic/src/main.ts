import { runTick } from "./core/run-tick";
import type { WorldSnapshot } from "./core/types";
import { recordBotError } from "./state/telemetry";
import { recordTelemetry } from "./telemetry/report";
import { observeWorld } from "./world/observe";

export const loop = (): void => {
  let world: WorldSnapshot | null = null;

  try {
    world = runTick().world;
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    recordBotError(message);
  }

  world ??= observeWorld();
  recordTelemetry(world);
};
