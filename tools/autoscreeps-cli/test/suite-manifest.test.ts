import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSuiteManifest, resolveSuiteCaseScenario } from "../src/lib/suite-manifest.ts";

const tempPaths: string[] = [];

describe("suite manifests", () => {
  afterEach(async () => {
    await Promise.all(tempPaths.map((tempPath) => fs.rm(tempPath, { recursive: true, force: true })));
    tempPaths.length = 0;
  });

  it("loads suite defaults and resolves case scenario overrides", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-suite-"));
    tempPaths.push(tempDir);

    const scenariosDir = path.join(tempDir, "scenarios");
    await fs.mkdir(scenariosDir, { recursive: true });
    await fs.writeFile(path.join(scenariosDir, "duel-basic.yaml"), [
      "version: 1",
      "name: duel-basic",
      "mapGenerator:",
      "  type: mirrored-random-1x1",
      "roomMutations:",
      "  - type: grant-completed-extension-on-controller-level",
      "    role: candidate",
      "    level: 2",
      "run:",
      "  maxTicks: 200"
    ].join("\n"), "utf8");

    const manifestPath = path.join(tempDir, "suite.yaml");
    await fs.writeFile(manifestPath, [
      "version: 1",
      "name: opener-suite",
      "run:",
      "  tickDuration: 25",
      "cases:",
      "  - id: train-a",
      "    scenario: ./scenarios/duel-basic.yaml",
      "    overrides:",
      "      mapGenerator:",
      "        sourceMapId: fixed-map",
      "      run:",
      "        maxTicks: 2000"
    ].join("\n"), "utf8");

    const manifest = await loadSuiteManifest(manifestPath);
    const scenario = await resolveSuiteCaseScenario(manifest, manifest.config.cases[0]!);

    expect(manifest.config.gates.training.minImprovedPrimaryMetrics).toBe(2);
    expect(manifest.config.cases[0]?.cohort).toBe("train");
    expect(scenario.path).toBe(path.join(scenariosDir, "duel-basic.yaml"));
    expect(scenario.config.name).toBe("opener-suite:train-a");
    expect(scenario.config.mapGenerator).toEqual({
      type: "mirrored-random-1x1",
      sourceMapId: "fixed-map"
    });
    expect(scenario.config.roomMutations).toEqual([
      {
        type: "grant-completed-extension-on-controller-level",
        role: "candidate",
        level: 2,
        count: 1
      }
    ]);
    expect(scenario.config.run.tickDuration).toBe(25);
    expect(scenario.config.run.maxTicks).toBe(2000);
    expect(scenario.config.run.sampleEveryTicks).toBe(25);
  });

  it("rejects duplicate case ids", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoscreeps-suite-"));
    tempPaths.push(tempDir);

    const manifestPath = path.join(tempDir, "suite.yaml");
    await fs.writeFile(manifestPath, [
      "version: 1",
      "name: broken-suite",
      "cases:",
      "  - id: duplicate",
      "    scenario: ./scenario-a.yaml",
      "  - id: duplicate",
      "    scenario: ./scenario-b.yaml"
    ].join("\n"), "utf8");

    await expect(loadSuiteManifest(manifestPath)).rejects.toThrow("Duplicate suite case id 'duplicate'");
  });
});
