import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planRoads, validateRoadPlan, type RoadPlan } from "../src/planning/road-plan.ts";
import type { RoomPlanningRoomData } from "../src/planning/room-plan.ts";
import type { RoomStampPlan } from "../src/planning/stamp-placement.ts";
import { installScreepsGlobals } from "../test/helpers/install-globals.ts";
import { loadBotarena212NormalStampPlanFixture, type CachedStampPlanCase } from "../test/helpers/stamp-plan-fixture.ts";
import { installTestPathFinder } from "../test/helpers/test-pathfinder.ts";

type PreviewConfig = {
  renderAll: boolean;
  roomNames: string[];
};

const roomSize = 50;
const terrainMaskWall = 1;
const terrainMaskSwamp = 2;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const fixture = loadBotarena212NormalStampPlanFixture();
  const config = parseArgs(process.argv.slice(2));
  const cases = selectCases(fixture.cases, config);
  const previewDir = path.join(scriptDirectory, "..", "test", "artifacts", "road-planning-preview");

  installScreepsGlobals();
  installTestPathFinder(fixture.terrainByRoom);
  mkdirSync(previewDir, { recursive: true });

  for (const testCase of cases) {
    let html: string;
    try {
      const roadPlan = planRoads(testCase.room, testCase.plan);
      const errors = validateRoadPlan(testCase.room, testCase.plan, roadPlan);
      html = renderPreviewHtml(testCase.room, testCase.plan, roadPlan, errors);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      html = renderPreviewHtml(testCase.room, testCase.plan, null, [message]);
    }
    const roomPath = path.join(previewDir, `${testCase.roomName}-normal.html`);
    writeFileSync(roomPath, html, "utf8");
    writeFileSync(path.join(previewDir, "latest.html"), html, "utf8");
    process.stdout.write(`Wrote road-planning preview for ${testCase.roomName} to ${roomPath}\n`);
  }

  process.stdout.write(`Preview directory: ${previewDir}\n`);
}

function parseArgs(args: string[]): PreviewConfig {
  const config: PreviewConfig = {
    renderAll: false,
    roomNames: []
  };

  for (const arg of args) {
    if (!arg.startsWith("--")) {
      config.roomNames.push(arg);
      continue;
    }

    switch (arg) {
      case "--all":
        config.renderAll = true;
        break;
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown flag '${arg}'.`);
    }
  }

  return config;
}

function selectCases(cases: CachedStampPlanCase[], config: PreviewConfig): CachedStampPlanCase[] {
  if (config.renderAll) {
    return cases;
  }
  if (config.roomNames.length === 0) {
    return [cases[0]!];
  }

  const byName = new Map(cases.map((testCase) => [testCase.roomName, testCase]));
  return config.roomNames.map((roomName) => {
    const testCase = byName.get(roomName);
    if (!testCase) {
      throw new Error(`Cached stamp plan room '${roomName}' not found.`);
    }
    return testCase;
  });
}

function renderPreviewHtml(room: RoomPlanningRoomData, stampPlan: RoomStampPlan, roadPlan: RoadPlan | null, errors: string[]): string {
  const stampTiles = createStampTileMap(stampPlan);
  const roadTiles = new Set(roadPlan?.roadTiles ?? []);
  const pathLabels = roadPlan === null ? new Map<number, string>() : createPathLabelMap(roadPlan);
  const objectTiles = new Map(room.objects.map((object) => [toIndex(object.x, object.y), object.type]));
  const gridTiles: string[] = [];

  for (let y = 0; y < roomSize; y += 1) {
    for (let x = 0; x < roomSize; x += 1) {
      const index = toIndex(x, y);
      const terrainCode = room.terrain.charCodeAt(index) - 48;
      const terrainClass = (terrainCode & terrainMaskWall) !== 0
        ? "terrain-wall"
        : (terrainCode & terrainMaskSwamp) !== 0
          ? "terrain-swamp"
          : "terrain-plain";
      const stampClass = stampTiles.get(index);
      const objectType = objectTiles.get(index);
      const roadClass = roadTiles.has(index) ? " road" : "";
      const label = objectType ? objectType[0]?.toUpperCase() ?? "" : roadTiles.has(index) ? "." : stampClass ? stampClass[0]?.toUpperCase() ?? "" : "";
      const title = [
        `${x},${y}`,
        objectType ? `object: ${objectType}` : null,
        stampClass ? `stamp: ${stampClass}` : null,
        roadTiles.has(index) ? "road" : null,
        pathLabels.get(index) ?? null
      ].filter((value): value is string => value !== null).join(" | ");

      gridTiles.push(`<div class="tile ${terrainClass}${stampClass ? ` stamp stamp-${stampClass}` : ""}${roadClass}" title="${escapeHtml(title)}">${escapeHtml(label)}</div>`);
    }
  }

  const pathRows = (roadPlan?.paths ?? []).map((path) => {
    const finalTile = path.tiles.at(-1) ?? path.origin;
    return `<tr>
      <td>${escapeHtml(path.kind)}</td>
      <td>${escapeHtml(path.origin.label)}</td>
      <td>${escapeHtml(path.target.label)} r${path.target.range}</td>
      <td>${path.roadTiles.length}</td>
      <td>${path.cost}</td>
      <td>${path.ops}</td>
      <td>${finalTile.x},${finalTile.y}</td>
    </tr>`;
  }).join("");
  const errorBlock = errors.length === 0
    ? ""
    : `<div class="error">${errors.map(escapeHtml).join("<br>")}</div>`;
  const roadCount = roadPlan?.roadTiles.length ?? 0;
  const pathCount = roadPlan?.paths.length ?? 0;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Road planning preview for ${escapeHtml(room.roomName)}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: #111318;
      color: #e5e7eb;
    }
    body {
      margin: 0;
      padding: 24px;
      background: #111318;
    }
    h1, h2, p {
      margin: 0 0 12px;
    }
    .summary, .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 14px;
      color: #cbd5e1;
      font-size: 13px;
    }
    .layout {
      display: grid;
      grid-template-columns: max-content minmax(420px, 1fr);
      gap: 18px;
      align-items: start;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(${roomSize}, 15px);
      gap: 1px;
      width: max-content;
      padding: 1px;
      background: #06080b;
      border: 1px solid #2f343c;
    }
    .tile {
      width: 15px;
      height: 15px;
      box-sizing: border-box;
      overflow: hidden;
      font-size: 8px;
      line-height: 15px;
      text-align: center;
    }
    .terrain-plain { background: #b6aa8d; color: #172033; }
    .terrain-swamp { background: #597d34; color: #f7fee7; }
    .terrain-wall { background: #111827; color: #94a3b8; }
    .stamp-hub { box-shadow: inset 0 0 0 2px rgba(59, 130, 246, 0.85); }
    .stamp-fastfiller { box-shadow: inset 0 0 0 2px rgba(234, 179, 8, 0.9); }
    .stamp-labs { box-shadow: inset 0 0 0 2px rgba(168, 85, 247, 0.85); }
    .road {
      background: #f8fafc;
      color: #0f172a;
      box-shadow: inset 0 0 0 2px #0f172a;
    }
    .panel {
      max-width: 720px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 12px;
    }
    th, td {
      border-bottom: 1px solid #2f343c;
      padding: 6px 8px;
      text-align: left;
      white-space: nowrap;
    }
    th {
      color: #cbd5e1;
      font-weight: 600;
    }
    .error {
      border: 1px solid rgba(248, 113, 113, 0.7);
      background: rgba(127, 29, 29, 0.32);
      color: #fecaca;
      padding: 8px 10px;
      margin-bottom: 14px;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(room.roomName)} Road Planning</h1>
  <div class="summary">
    <span>policy: ${escapeHtml(stampPlan.policy)}</span>
    <span>roads: ${roadCount}</span>
    <span>paths: ${pathCount}</span>
  </div>
  <div class="legend">
    <span>white: road</span>
    <span>blue: hub stamp</span>
    <span>yellow: fastfiller stamp</span>
    <span>purple: lab stamp</span>
    <span>C/S/M: controller/source/mineral</span>
  </div>
  ${errorBlock}
  <div class="layout">
    <div class="grid">${gridTiles.join("")}</div>
    <div class="panel">
      <h2>Paths</h2>
      <table>
        <thead>
          <tr><th>kind</th><th>from</th><th>to</th><th>tiles</th><th>cost</th><th>ops</th><th>end</th></tr>
        </thead>
        <tbody>${pathRows}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

function createStampTileMap(stampPlan: RoomStampPlan): Map<number, string> {
  const stamps = [
    stampPlan.stamps.hub,
    ...stampPlan.stamps.fastfillers,
    ...(stampPlan.stamps.labs ? [stampPlan.stamps.labs] : [])
  ];
  const tiles = new Map<number, string>();
  for (const stamp of stamps) {
    for (const tile of stamp.blockedTiles) {
      tiles.set(tile, stamp.kind);
    }
  }
  return tiles;
}

function createPathLabelMap(roadPlan: RoadPlan): Map<number, string> {
  const labels = new Map<number, string[]>();
  for (const path of roadPlan.paths) {
    for (const tile of path.roadTiles) {
      const existing = labels.get(tile) ?? [];
      existing.push(path.kind);
      labels.set(tile, existing);
    }
  }

  return new Map([...labels.entries()].map(([tile, values]) => [tile, `paths: ${values.join(", ")}`]));
}

function toIndex(x: number, y: number): number {
  return y * roomSize + x;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function printHelp(): void {
  process.stdout.write(`Usage: node scripts/generate-road-planning-preview.ts [options] [room...]

Options:
  --all   Render every cached road-planning fixture room
  --help  Show this help
`);
}
