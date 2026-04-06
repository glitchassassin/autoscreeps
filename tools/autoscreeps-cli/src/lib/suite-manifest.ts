import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { loadScenario, mapGeneratorSchema, roomSelectionStrategySchema, scenarioRunSchema, scenarioSchema, type ScenarioConfig } from "./scenario.ts";

export const suitePrimaryMetricSchema = z.enum([
  "T_RCL2",
  "T_RCL3",
  "controllerProgressToRCL3Pct",
  "spawnIdlePct",
  "sourceCoveragePct",
  "sourceUptimePct"
]);

const mapGeneratorOverrideSchema = z.object({
  type: z.literal("mirrored-random-1x1").optional(),
  sourceMapId: z.string().min(1).optional(),
  roomSelectionStrategy: roomSelectionStrategySchema.optional()
});

const suiteCaseOverrideSchema = z.object({
  map: z.string().min(1).optional(),
  mapGenerator: mapGeneratorOverrideSchema.optional(),
  rooms: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
  run: scenarioRunSchema.partial().optional()
});

const suiteCaseSchema = z.object({
  id: z.string().min(1),
  cohort: z.enum(["train", "holdout"]).default("train"),
  scenario: z.string().min(1),
  overrides: suiteCaseOverrideSchema.optional(),
  tags: z.array(z.string().min(1)).default([])
});

const suiteGatesSchema = z.object({
  primaryMetrics: z.array(suitePrimaryMetricSchema).min(1).default([
    "T_RCL2",
    "T_RCL3",
    "spawnIdlePct",
    "sourceCoveragePct",
    "sourceUptimePct"
  ]),
  training: z.object({
    minImprovedPrimaryMetrics: z.number().int().nonnegative().default(2)
  }).default({
    minImprovedPrimaryMetrics: 2
  }),
  holdout: z.object({
    maxRegressionPct: z.number().nonnegative().default(5)
  }).default({
    maxRegressionPct: 5
  })
}).default({
  primaryMetrics: ["T_RCL2", "T_RCL3", "spawnIdlePct", "sourceCoveragePct", "sourceUptimePct"],
  training: { minImprovedPrimaryMetrics: 2 },
  holdout: { maxRegressionPct: 5 }
});

export const suiteManifestSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  description: z.string().optional(),
  gates: suiteGatesSchema.default({
    primaryMetrics: ["T_RCL2", "T_RCL3", "spawnIdlePct", "sourceCoveragePct", "sourceUptimePct"],
    training: { minImprovedPrimaryMetrics: 2 },
    holdout: { maxRegressionPct: 5 }
  }),
  cases: z.array(suiteCaseSchema).min(1)
}).superRefine((value, context) => {
  const seen = new Set<string>();

  for (const testCase of value.cases) {
    if (seen.has(testCase.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate suite case id '${testCase.id}'.`,
        path: ["cases"]
      });
    }
    seen.add(testCase.id);
  }
});

export type SuitePrimaryMetric = z.infer<typeof suitePrimaryMetricSchema>;
export type SuiteManifest = z.infer<typeof suiteManifestSchema>;
export type SuiteCase = SuiteManifest["cases"][number];
export type LoadedSuiteManifest = { path: string; config: SuiteManifest };

export async function loadSuiteManifest(filePath: string): Promise<LoadedSuiteManifest> {
  const absolutePath = path.resolve(filePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = YAML.parse(raw);
  const config = suiteManifestSchema.parse(parsed);

  return {
    path: absolutePath,
    config
  };
}

export async function resolveSuiteCaseScenario(manifest: LoadedSuiteManifest, testCase: SuiteCase): Promise<{ path: string; config: ScenarioConfig }> {
  const baseScenarioPath = path.resolve(path.dirname(manifest.path), testCase.scenario);
  const loadedScenario = await loadScenario(baseScenarioPath);

  const resolvedConfig = scenarioSchema.parse({
    ...loadedScenario.config,
    name: `${manifest.config.name}:${testCase.id}`,
    description: loadedScenario.config.description ?? manifest.config.description,
    map: testCase.overrides?.map ?? loadedScenario.config.map,
    mapGenerator: mergeMapGenerator(loadedScenario.config.mapGenerator, testCase.overrides?.mapGenerator),
    rooms: testCase.overrides?.rooms ?? loadedScenario.config.rooms,
    run: {
      ...loadedScenario.config.run,
      ...(testCase.overrides?.run ?? {})
    }
  });

  return {
    path: loadedScenario.path,
    config: resolvedConfig
  };
}

function mergeMapGenerator(base: ScenarioConfig["mapGenerator"], override: z.infer<typeof mapGeneratorOverrideSchema> | undefined) {
  if (!base && !override) {
    return undefined;
  }

  if (!base && override) {
    return mapGeneratorSchema.parse({
      type: override.type ?? "mirrored-random-1x1",
      sourceMapId: override.sourceMapId,
      roomSelectionStrategy: override.roomSelectionStrategy
    });
  }

  if (!override) {
    return base;
  }

  return mapGeneratorSchema.parse({
    ...base,
    ...override,
    type: override.type ?? base?.type ?? "mirrored-random-1x1"
  });
}
