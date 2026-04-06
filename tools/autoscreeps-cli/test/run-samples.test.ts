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
        telemetry: {
          baseline: {
            schemaVersion: 4,
            gameTime: 100,
            spawn: {
              queueDepth: 1,
              isSpawning: false,
              nextRole: "harvester",
              unmetDemand: { harvester: 1 }
            },
            sources: {
              total: 2,
              staffed: 1,
              assignments: { sourceA: 1 },
              harvestingStaffed: 1,
              harvestingAssignments: { sourceA: 1 },
              activeHarvestingStaffed: 1,
              activeHarvestingAssignments: { sourceA: 1 }
            }
          },
          candidate: null
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
        telemetry: {
          baseline: {
            schemaVersion: 4,
            gameTime: 125,
            spawn: {
              queueDepth: 1,
              isSpawning: true,
              nextRole: "upgrader",
              unmetDemand: { upgrader: 1 }
            },
            sources: {
              total: 2,
              staffed: 2,
              assignments: { sourceA: 1, sourceB: 1 },
              harvestingStaffed: 1,
              harvestingAssignments: { sourceA: 1 },
              activeHarvestingStaffed: 0,
              activeHarvestingAssignments: {}
            }
          },
          candidate: null
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
        telemetry: {
          baseline: {
            schemaVersion: 4,
            gameTime: 150,
            spawn: {
              queueDepth: 0,
              isSpawning: false,
              nextRole: null,
              unmetDemand: { harvester: 0, upgrader: 0 }
            },
            sources: {
              total: 2,
              staffed: 2,
              assignments: { sourceA: 2, sourceB: 1 },
              harvestingStaffed: 0,
              harvestingAssignments: {},
              activeHarvestingStaffed: 0,
              activeHarvestingAssignments: {}
            }
          },
          candidate: null
        }
      }
    ], 25);

    expect(summary.sampleEveryTicks).toBe(25);
    expect(summary.users.baseline.sampleCount).toBe(3);
    expect(summary.users.baseline.firstSeenGameTime).toBe(100);
    expect(summary.users.baseline.controllerLevelMilestones["1"]).toBe(100);
    expect(summary.users.baseline.controllerLevelMilestones["2"]).toBe(125);
    expect(summary.users.baseline.controllerLevelMilestones["3"]).toBe(150);
    expect(summary.users.baseline.controllerProgressToRCL3Pct).toBe(100);
    expect(summary.users.baseline.maxCombinedRCL).toBe(3);
    expect(summary.users.baseline.telemetrySampleCount).toBe(3);
    expect(summary.users.baseline.firstExtensionTick).toBe(125);
    expect(summary.users.baseline.allRcl2ExtensionsTick).toBe(150);
    expect(summary.users.baseline.spawnIdlePct).toBeCloseTo(33.33, 2);
    expect(summary.users.baseline.sourceCoveragePct).toBeCloseTo(83.33, 2);
    expect(summary.users.baseline.sourceUptimePct).toBeCloseTo(66.67, 2);
    expect(summary.users.baseline.harvestingSourceCoveragePct).toBeCloseTo(33.33, 2);
    expect(summary.users.baseline.harvestingSourceUptimePct).toBe(0);
    expect(summary.users.baseline.activeHarvestingSourceCoveragePct).toBeCloseTo(16.67, 2);
    expect(summary.users.baseline.activeHarvestingSourceUptimePct).toBe(0);
    expect(summary.users.candidate.controllerLevelMilestones["2"]).toBeNull();
    expect(summary.users.candidate.controllerProgressToRCL3Pct).toBeCloseTo(0.33, 2);
    expect(summary.users.candidate.maxOwnedControllers).toBe(2);
    expect(summary.users.candidate.firstExtensionTick).toBeNull();
    expect(summary.users.candidate.allRcl2ExtensionsTick).toBeNull();
    expect(summary.users.candidate.telemetrySampleCount).toBe(0);
    expect(summary.users.candidate.spawnIdlePct).toBeNull();
    expect(summary.users.candidate.sourceCoveragePct).toBeNull();
    expect(summary.users.candidate.sourceUptimePct).toBeNull();
    expect(summary.users.candidate.harvestingSourceCoveragePct).toBeNull();
    expect(summary.users.candidate.harvestingSourceUptimePct).toBeNull();
    expect(summary.users.candidate.activeHarvestingSourceCoveragePct).toBeNull();
    expect(summary.users.candidate.activeHarvestingSourceUptimePct).toBeNull();
  });
});
