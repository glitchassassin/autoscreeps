import { describe, expect, it } from "vitest";
import { buildReportsByRole, inspectBotReport, inspectReportsByRole, parseBotReport } from "../src/lib/bot-telemetry.ts";

describe("bot report", () => {
  it("parses a valid report payload with opaque telemetry", () => {
    const raw = JSON.stringify({
      schemaVersion: 11,
      gameTime: 250,
      errors: [],
      telemetry: {
        colonyMode: "normal",
        loop: { phaseTicks: { "worker.upgrade": 10 } }
      }
    });

    expect(parseBotReport(raw)).toEqual({
      schemaVersion: 11,
      gameTime: 250,
      errors: [],
      telemetry: {
        colonyMode: "normal",
        loop: { phaseTicks: { "worker.upgrade": 10 } }
      }
    });
    expect(inspectBotReport(raw)).toEqual({
      snapshot: {
        schemaVersion: 11,
        gameTime: 250,
        errors: [],
        telemetry: {
          colonyMode: "normal",
          loop: { phaseTicks: { "worker.upgrade": 10 } }
        }
      },
      health: {
        status: "ok",
        message: null
      }
    });
  });

  it("classifies malformed and missing report health", () => {
    expect(parseBotReport("{bad json")).toBeNull();
    expect(parseBotReport(JSON.stringify({ schemaVersion: "1", gameTime: 25, errors: [] }))).toBeNull();
    expect(parseBotReport(JSON.stringify({ schemaVersion: 1, gameTime: 25, errors: [1] }))).toBeNull();
    expect(inspectBotReport("{bad json")).toMatchObject({
      snapshot: null,
      health: {
        status: "parse_error"
      }
    });
    expect(inspectBotReport(null)).toEqual({
      snapshot: null,
      health: {
        status: "missing",
        message: null
      }
    });
  });

  it("preserves reported bot errors without treating them as parse failures", () => {
    expect(inspectBotReport(JSON.stringify({
      schemaVersion: 5,
      gameTime: 250,
      errors: ["spawn queue invariant violated"]
    }))).toEqual({
      snapshot: {
        schemaVersion: 5,
        gameTime: 250,
        errors: ["spawn queue invariant violated"]
      },
      health: {
        status: "ok",
        message: null
      }
    });
  });

  it("builds report and health maps by role", () => {
    expect(buildReportsByRole({
      baseline: JSON.stringify({ schemaVersion: 1, gameTime: 25, errors: [] }),
      candidate: null
    })).toEqual({
      baseline: { schemaVersion: 1, gameTime: 25, errors: [] },
      candidate: null
    });

    expect(inspectReportsByRole({
      baseline: JSON.stringify({ schemaVersion: 1, gameTime: 25, errors: [] }),
      candidate: null
    })).toEqual({
      baseline: {
        snapshot: { schemaVersion: 1, gameTime: 25, errors: [] },
        health: {
          status: "ok",
          message: null
        }
      },
      candidate: {
        snapshot: null,
        health: {
          status: "missing",
          message: null
        }
      }
    });
  });
});
