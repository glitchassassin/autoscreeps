import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

export const scenarioSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  description: z.string().optional(),
  reset: z.enum(["full"]).default("full"),
  map: z.string().min(1).optional(),
  rooms: z.tuple([z.string().min(1), z.string().min(1)]),
  run: z.object({
    tickDuration: z.number().int().positive().default(250),
    maxTicks: z.number().int().positive(),
    pollIntervalMs: z.number().int().positive().default(1000),
    maxWallClockMs: z.number().int().positive().default(300000),
    maxStalledPolls: z.number().int().positive().default(30)
  }),
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
});

export type ScenarioConfig = z.infer<typeof scenarioSchema>;

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
