import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginCpuSpan, createCpuProfiler, endCpuSpan, snapshotCpuProfiler } from "../src/telemetry/cpu-profiler";
import { installScreepsGlobals } from "./helpers/install-globals";

describe("cpu profiler", () => {
  let cpuUsed = 0;

  beforeEach(() => {
    installScreepsGlobals();
    cpuUsed = 0;

    (globalThis as typeof globalThis & { Game: Game }).Game = {
      creeps: {},
      constructionSites: {},
      rooms: {},
      spawns: {},
      cpu: {
        limit: 20,
        tickLimit: 500,
        bucket: 10000,
        getUsed: vi.fn(() => cpuUsed)
      },
      time: 1
    } as unknown as Game;
  });

  it("captures completed nested spans", () => {
    const profiler = createCpuProfiler();

    const outer = beginCpuSpan(profiler, "outer");
    cpuUsed = 2;
    const inner = beginCpuSpan(profiler, "inner");
    cpuUsed = 5;
    endCpuSpan(profiler, inner);
    cpuUsed = 7;
    endCpuSpan(profiler, outer);

    expect(snapshotCpuProfiler(profiler)).toEqual({
      used: 7,
      limit: 20,
      tickLimit: 500,
      bucket: 10000,
      profile: [
        {
          label: "outer",
          total: 7,
          self: 4,
          calls: 1,
          children: [
            {
              label: "inner",
              total: 3,
              self: 3,
              calls: 1,
              children: []
            }
          ]
        }
      ]
    });
  });

  it("includes active spans in the current snapshot", () => {
    const profiler = createCpuProfiler();

    const outer = beginCpuSpan(profiler, "outer");
    cpuUsed = 3;
    const inner = beginCpuSpan(profiler, "inner");
    cpuUsed = 6;

    expect(snapshotCpuProfiler(profiler)).toEqual({
      used: 6,
      limit: 20,
      tickLimit: 500,
      bucket: 10000,
      profile: [
        {
          label: "outer",
          total: 6,
          self: 3,
          calls: 1,
          children: [
            {
              label: "inner",
              total: 3,
              self: 3,
              calls: 1,
              children: []
            }
          ]
        }
      ]
    });

    endCpuSpan(profiler, inner);
    endCpuSpan(profiler, outer);
  });
});
