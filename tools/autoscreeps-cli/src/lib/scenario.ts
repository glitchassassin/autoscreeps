import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

export const roomSelectionStrategySchema = z.object({
  type: z.enum(["max-plains-two-sources", "center-most-controller"])
});

export const mapGeneratorSchema = z.object({
  type: z.literal("mirrored-random-1x1"),
  sourceMapId: z.string().min(1).optional(),
  roomSelectionStrategy: roomSelectionStrategySchema.optional()
});

export const terminalConditionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("any-owned-controller-level-at-least"),
    level: z.number().int().min(1).max(8)
  }),
  z.object({
    type: z.literal("no-owned-controllers")
  })
]);

export const terminalConditionSetSchema = z.object({
  win: z.array(terminalConditionSchema).default([]),
  fail: z.array(terminalConditionSchema).default([])
}).refine((value) => value.win.length > 0 || value.fail.length > 0, {
  message: "terminalConditions must declare at least one win or fail condition."
});

export const scenarioRoomMutationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("grant-completed-extension-on-controller-level"),
    role: z.enum(["baseline", "candidate"]),
    level: z.number().int().min(1).max(8),
    count: z.number().int().positive().default(1)
  })
]);

export const scenarioRunSchema = z.object({
  tickDuration: z.number().int().positive().default(250),
  maxTicks: z.number().int().positive(),
  sampleEveryTicks: z.number().int().positive().default(25),
  pollIntervalMs: z.number().int().positive().default(1000),
  maxWallClockMs: z.number().int().positive().default(300000),
  maxStalledPolls: z.number().int().positive().default(30),
  terminalConditions: terminalConditionSetSchema.optional()
});

export const scenarioSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  description: z.string().optional(),
  reset: z.enum(["full"]).default("full"),
  map: z.string().min(1).optional(),
  mapGenerator: mapGeneratorSchema.optional(),
  rooms: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
  roomMutations: z.array(scenarioRoomMutationSchema).default([]),
  run: scenarioRunSchema,
  server: z
    .object({
      httpUrl: z.string().url().default("http://127.0.0.1:21025"),
      cliHost: z.string().min(1).default("127.0.0.1"),
      cliPort: z.number().int().positive().default(21026)
    })
    .default({
      httpUrl: "http://127.0.0.1:21025",
      cliHost: "127.0.0.1",
      cliPort: 21026
    })
}).superRefine((value, context) => {
  if (!value.map && !value.mapGenerator) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A scenario must declare either map or mapGenerator.",
      path: ["map"]
    });
  }

  if (!value.rooms && !value.mapGenerator) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A scenario without mapGenerator must declare explicit rooms.",
      path: ["rooms"]
    });
  }
});

export type ScenarioConfig = z.infer<typeof scenarioSchema>;
export type ScenarioRoomMutation = z.infer<typeof scenarioRoomMutationSchema>;
export type TerminalCondition = z.infer<typeof terminalConditionSchema>;
export type TerminalConditionSet = z.infer<typeof terminalConditionSetSchema>;

export async function loadScenario(filePath: string): Promise<{ path: string; config: ScenarioConfig }> {
  const absolutePath = path.resolve(filePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = YAML.parse(raw);
  const config = scenarioSchema.parse(parsed);

  return {
    path: absolutePath,
    config
  };
}
