import { beforeEach, describe, expect, it } from "vitest";
import { createEnergyLedgerState, createRunnerMovementState, createRunnerStateTicksState, ensureTelemetryState, recordBotError, recordBuiltEnergy, recordCreepDeath, recordHarvestedEnergy, recordRunnerMovementTick, recordRunnerState } from "../src/state/telemetry";
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
      energy: createEnergyLedgerState(),
      runnerStateTicks: createRunnerStateTicksState(),
      runnerMovement: createRunnerMovementState(),
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
    recordCreepDeath(1, 12);

    expect(ensureTelemetryState().creepDeaths).toBe(1);
    expect(ensureTelemetryState().energy?.lostOnCreepDeath).toBe(12);
  });

  it("records cumulative energy ledger values", () => {
    recordHarvestedEnergy("source-1", 4);
    recordHarvestedEnergy("source-1", 2);
    recordBuiltEnergy(5);

    expect(ensureTelemetryState().energy).toMatchObject({
      harvested: 6,
      harvestedBySourceId: {
        "source-1": 6
      },
      built: 5
    });
  });

  it("records runner state ticks", () => {
    recordRunnerState("movingToPickup");
    recordRunnerState("movingToPickup");
    recordRunnerState("transferSucceeded");

    expect(ensureTelemetryState().runnerStateTicks).toMatchObject({
      movingToPickup: 2,
      transferSucceeded: 1
    });
  });

  it("records runner movement ticks by phase and total", () => {
    recordRunnerMovementTick("pickup", "failedToPath");
    recordRunnerMovementTick("delivery", "tired");
    recordRunnerMovementTick("delivery", "stuck");

    expect(ensureTelemetryState().runnerMovement).toEqual({
      pickup: {
        failedToPath: 1,
        tired: 0,
        stuck: 0
      },
      delivery: {
        failedToPath: 0,
        tired: 1,
        stuck: 1
      },
      total: {
        failedToPath: 1,
        tired: 1,
        stuck: 1
      }
    });
  });
});
