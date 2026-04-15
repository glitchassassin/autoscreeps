import { describe, expect, it } from "vitest";
import { buildRunSummaryMetrics, shouldCaptureRunSample } from "../src/lib/run-samples.ts";

describe("run samples", () => {
  it("captures the initial tick and configured cadence", () => {
    expect(shouldCaptureRunSample(100, null, 100, 25)).toBe(true);
    expect(shouldCaptureRunSample(100, 100, 101, 25)).toBe(false);
    expect(shouldCaptureRunSample(100, 100, 125, 25)).toBe(true);
    expect(shouldCaptureRunSample(100, 125, 150, 25)).toBe(true);
  });

  it("captures once the poll loop crosses a sample interval", () => {
    expect(shouldCaptureRunSample(1, 1, 21, 25)).toBe(false);
    expect(shouldCaptureRunSample(1, 1, 26, 25)).toBe(true);
    expect(shouldCaptureRunSample(1, 26, 51, 25)).toBe(true);
    expect(shouldCaptureRunSample(1, 26, 49, 25)).toBe(false);
  });

  it("derives controller milestones and maxima from samples", () => {
    const summary = buildRunSummaryMetrics([
      {
        gameTime: 100,
        users: {
          baseline: {
            ownedControllers: 1,
            combinedRCL: 1,
            maxOwnedControllerLevel: 1,
            rcl: { "1": 1, "2": 0, "3": 0 }
          },
          candidate: {
            ownedControllers: 1,
            combinedRCL: 1,
            maxOwnedControllerLevel: 1,
            rcl: { "1": 1, "2": 0, "3": 0 }
          }
        },
        rooms: {
          baseline: {
            controllerLevel: 1,
            controllerProgress: 100,
            controllerProgressTotal: 200,
            extensions: 0
          },
          candidate: {
            controllerLevel: 1,
            controllerProgress: 50,
            controllerProgressTotal: 200,
            extensions: 0
          }
        },
        reports: {
          baseline: {
            schemaVersion: 15,
            gameTime: 100,
            errors: [],
            telemetry: {
              cpu: {
                used: 0.6,
                profile: [
                  { label: "observe", total: 0.2 },
                  { label: "creeps", total: 0.3 }
                ]
              }
            }
          },
          candidate: {
            schemaVersion: 15,
            gameTime: 100,
            errors: [],
            telemetry: {
              cpu: {
                used: 0.3,
                profile: [
                  { label: "observe", total: 0.1 }
                ]
              }
            }
          }
        }
      },
      {
        gameTime: 125,
        users: {
          baseline: {
            ownedControllers: 1,
            combinedRCL: 2,
            maxOwnedControllerLevel: 2,
            rcl: { "1": 0, "2": 1, "3": 0 }
          },
          candidate: {
            ownedControllers: 1,
            combinedRCL: 1,
            maxOwnedControllerLevel: 1,
            rcl: { "1": 1, "2": 0, "3": 0 }
          }
        },
        rooms: {
          baseline: {
            controllerLevel: 2,
            controllerProgress: 500,
            controllerProgressTotal: 45000,
            extensions: 1
          },
          candidate: {
            controllerLevel: 1,
            controllerProgress: 125,
            controllerProgressTotal: 200,
            extensions: 0
          }
        },
        reports: {
          baseline: {
            schemaVersion: 15,
            gameTime: 125,
            errors: [],
            telemetry: {
              cpu: {
                used: 0.9,
                profile: [
                  { label: "observe", total: 0.3 },
                  { label: "creeps", total: 0.4 }
                ]
              }
            }
          },
          candidate: {
            schemaVersion: 15,
            gameTime: 125,
            errors: [],
            telemetry: {
              cpu: {
                used: 0.5,
                profile: [
                  { label: "observe", total: 0.2 },
                  { label: "plan", total: 0.1 }
                ]
              }
            }
          }
        }
      },
      {
        gameTime: 150,
        users: {
          baseline: {
            ownedControllers: 1,
            combinedRCL: 3,
            maxOwnedControllerLevel: 3,
            rcl: { "1": 0, "2": 0, "3": 1 }
          },
          candidate: {
            ownedControllers: 2,
            combinedRCL: 2,
            maxOwnedControllerLevel: 1,
            rcl: { "1": 2, "2": 0, "3": 0 }
          }
        },
        rooms: {
          baseline: {
            controllerLevel: 3,
            controllerProgress: null,
            controllerProgressTotal: null,
            extensions: 5
          },
          candidate: {
            controllerLevel: 1,
            controllerProgress: 150,
            controllerProgressTotal: 200,
            extensions: 0
          }
        },
        reports: {
          candidate: {
            schemaVersion: 15,
            gameTime: 150,
            errors: [],
            telemetry: {
              cpu: {
                used: 0.7,
                profile: [
                  { label: "observe", total: 0.25 },
                  { label: "creeps", total: 0.2 }
                ]
              }
            }
          }
        }
      }
    ], 25);

    expect(summary.sampleEveryTicks).toBe(25);
    expect(summary.users.baseline?.sampleCount).toBe(3);
    expect(summary.users.baseline?.firstSeenGameTime).toBe(100);
    expect(summary.users.baseline?.controllerLevelMilestones["1"]).toBe(100);
    expect(summary.users.baseline?.controllerLevelMilestones["2"]).toBe(125);
    expect(summary.users.baseline?.controllerLevelMilestones["3"]).toBe(150);
    expect(summary.users.baseline?.controllerProgressToRCL3Pct).toBe(100);
    expect(summary.users.baseline?.maxCombinedRCL).toBe(3);
    expect(summary.users.baseline?.firstExtensionTick).toBe(125);
    expect(summary.users.baseline?.allRcl2ExtensionsTick).toBe(150);
    expect(summary.users.baseline?.cpu).toEqual({
      observedTickCount: 2,
      avgUsedPerTick: 0.75,
      peakUsedPerTick: 0.9,
      topLevelAvgPerTick: {
        creeps: 0.35,
        observe: 0.25
      },
      topLevelPeakPerTick: {
        creeps: 0.4,
        observe: 0.3
      }
    });
    expect(summary.users.candidate?.controllerLevelMilestones["2"]).toBeNull();
    expect(summary.users.candidate?.controllerProgressToRCL3Pct).toBeCloseTo(0.33, 2);
    expect(summary.users.candidate?.maxOwnedControllers).toBe(2);
    expect(summary.users.candidate?.firstExtensionTick).toBeNull();
    expect(summary.users.candidate?.allRcl2ExtensionsTick).toBeNull();
    expect(summary.users.candidate?.cpu).toEqual({
      observedTickCount: 3,
      avgUsedPerTick: 0.5,
      peakUsedPerTick: 0.7,
      topLevelAvgPerTick: {
        creeps: 0.067,
        observe: 0.183,
        plan: 0.033
      },
      topLevelPeakPerTick: {
        creeps: 0.2,
        observe: 0.25,
        plan: 0.1
      }
    });
  });
});
