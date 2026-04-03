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
        "map: random_1x2",
        "rooms:",
        "  - W5N5",
        "  - W6N5",
        "run:",
        "  maxTicks: 200"
      ].join("\n"),
      "utf8"
    );

    const scenario = await loadScenario(scenarioPath);

    expect(scenario.config.name).toBe("basic-duel");
    expect(scenario.config.reset).toBe("full");
    expect(scenario.config.run.tickDuration).toBe(250);
    expect(scenario.config.server.httpUrl).toBe("http://127.0.0.1:21025");
  });
});
