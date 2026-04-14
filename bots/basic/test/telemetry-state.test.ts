import { beforeEach, describe, expect, it } from "vitest";
import { ensureTelemetryState, recordBotError, recordCreepDeath } from "../src/telemetry-state";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("telemetry state", () => {
  beforeEach(() => {
    installScreepsGlobals();
    const testGlobal = globalThis as typeof globalThis & { Memory: Memory };

    testGlobal.Memory = {
      creeps: {}
    } as Memory;
  });

  it("initializes telemetry memory", () => {
    expect(ensureTelemetryState()).toEqual({
      creepDeaths: 0,
      firstOwnedSpawnTick: null,
      rcl2Tick: null,
      rcl3Tick: null,
      errors: []
    });
  });

  it("records bot errors", () => {
    recordBotError("oops");

    expect(ensureTelemetryState().errors).toEqual(["oops"]);
  });

  it("records creep deaths", () => {
    recordCreepDeath();

    expect(ensureTelemetryState().creepDeaths).toBe(1);
  });
});
