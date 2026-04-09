import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadScenario } from "../src/lib/scenario.ts";

const tempPaths: string[] = [];

describe("loadScenario", () => {
  afterEach(async () => {
    await Promise.all(tempPaths.map((tempPath) => fs.rm(tempPath, { recursive: true, force: true })));
    tempPaths.length = 0;
  });

  it("parses a duel scenario with defaults", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-scenario-"));
    tempPaths.push(tempDir);
    const scenarioPath = path.join(tempDir, "scenario.yaml");

    await fs.writeFile(
      scenarioPath,
      [
        "version: 1",
        "name: basic-duel",
        "mapGenerator:",
        "  type: mirrored-random-1x1",
        "run:",
        "  maxTicks: 200",
        "  terminalConditions:",
        "    win:",
        "      - type: any-owned-controller-level-at-least",
        "        level: 2",
        "    fail:",
        "      - type: no-owned-controllers"
      ].join("\n"),
      "utf8"
    );

    const scenario = await loadScenario(scenarioPath);

    expect(scenario.config.name).toBe("basic-duel");
    expect(scenario.config.mapGenerator?.type).toBe("mirrored-random-1x1");
    expect(scenario.config.reset).toBe("full");
    expect(scenario.config.run.tickDuration).toBe(250);
    expect(scenario.config.run.sampleEveryTicks).toBe(25);
    expect(scenario.config.run.terminalConditions).toEqual({
      win: [{ type: "any-owned-controller-level-at-least", level: 2 }],
      fail: [{ type: "no-owned-controllers" }]
    });
    expect(scenario.config.server.httpUrl).toBe("http://127.0.0.1:21025");
  });

  it("parses an explicit sourceMapId for deterministic generation", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-scenario-"));
    tempPaths.push(tempDir);
    const scenarioPath = path.join(tempDir, "scenario.yaml");

    await fs.writeFile(
      scenarioPath,
      [
        "version: 1",
        "name: deterministic-duel",
        "mapGenerator:",
        "  type: mirrored-random-1x1",
        "  sourceMapId: shard3-e0s0",
        "run:",
        "  maxTicks: 200",
        "  terminalConditions:",
        "    win:",
        "      - type: any-owned-controller-level-at-least",
        "        level: 2"
      ].join("\n"),
      "utf8"
    );

    const scenario = await loadScenario(scenarioPath);

    expect(scenario.config.mapGenerator).toEqual({
      type: "mirrored-random-1x1",
      sourceMapId: "shard3-e0s0"
    });
  });

  it("rejects empty terminal conditions", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-scenario-"));
    tempPaths.push(tempDir);
    const scenarioPath = path.join(tempDir, "scenario.yaml");

    await fs.writeFile(
      scenarioPath,
      [
        "version: 1",
        "name: basic-duel",
        "mapGenerator:",
        "  type: mirrored-random-1x1",
        "run:",
        "  maxTicks: 200",
        "  terminalConditions:",
        "    win: []",
        "    fail: []"
      ].join("\n"),
      "utf8"
    );

    await expect(loadScenario(scenarioPath)).rejects.toThrow("terminalConditions must declare at least one win or fail condition");
  });

  it("parses room mutations", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-scenario-"));
    tempPaths.push(tempDir);
    const scenarioPath = path.join(tempDir, "scenario.yaml");

    await fs.writeFile(
      scenarioPath,
      [
        "version: 1",
        "name: room-mutation-duel",
        "mapGenerator:",
        "  type: mirrored-random-1x1",
        "roomMutations:",
        "  - type: grant-completed-extension-on-controller-level",
        "    role: candidate",
        "    level: 2",
        "run:",
        "  maxTicks: 200"
      ].join("\n"),
      "utf8"
    );

    const scenario = await loadScenario(scenarioPath);

    expect(scenario.config.roomMutations).toEqual([
      {
        type: "grant-completed-extension-on-controller-level",
        role: "candidate",
        level: 2,
        count: 1
      }
    ]);
  });
});
