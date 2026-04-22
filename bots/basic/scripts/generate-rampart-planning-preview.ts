import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planRamparts, validateRampartPlan, type RampartPlan } from "../src/planning/rampart-plan.ts";
import { planRoads, validateRoadPlan, type RoadPlan } from "../src/planning/road-plan.ts";
import type { RoomPlanningRoomData } from "../src/planning/room-plan.ts";
import type { RoomStampPlan } from "../src/planning/stamp-placement.ts";
import { installScreepsGlobals } from "../test/helpers/install-globals.ts";
import { loadBotarena212RoadPlanningFixture, type CachedStampPlanCase } from "../test/helpers/stamp-plan-fixture.ts";
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
  const fixture = loadBotarena212RoadPlanningFixture();
  const config = parseArgs(process.argv.slice(2));
  const cases = selectCases(fixture.cases, config);
  const previewDir = path.join(scriptDirectory, "..", "test", "artifacts", "rampart-planning-preview");

  installScreepsGlobals();
  installTestPathFinder(fixture.terrainByRoom);
  mkdirSync(previewDir, { recursive: true });

  for (const testCase of cases) {
    let html: string;
    try {
      const roadPlan = planRoads(testCase.room, testCase.plan);
      const roadErrors = validateRoadPlan(testCase.room, testCase.plan, roadPlan);
      const rampartPlan = planRamparts(testCase.room, testCase.plan, roadPlan);
      const rampartErrors = validateRampartPlan(testCase.room, testCase.plan, roadPlan, rampartPlan);
      html = renderPreviewHtml(testCase.room, testCase.plan, roadPlan, rampartPlan, [...roadErrors, ...rampartErrors]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      html = renderPreviewHtml(testCase.room, testCase.plan, null, null, [message]);
    }

    const roomPath = path.join(previewDir, `${testCase.roomName}-normal.html`);
    writeFileSync(roomPath, html, "utf8");
    writeFileSync(path.join(previewDir, "latest.html"), html, "utf8");
    process.stdout.write(`Wrote rampart-planning preview for ${testCase.roomName} to ${roomPath}\n`);
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
      throw new Error(`Cached road-planning fixture room '${roomName}' not found.`);
    }
    return testCase;
  });
}

function renderPreviewHtml(
  room: RoomPlanningRoomData,
  stampPlan: RoomStampPlan,
  roadPlan: RoadPlan | null,
  rampartPlan: RampartPlan | null,
  errors: string[]
): string {
  const stampTiles = createStampTileMap(stampPlan);
  const roadTiles = new Set(roadPlan?.roadTiles ?? []);
  const rampartTiles = new Set(rampartPlan?.rampartTiles ?? []);
  const extensionTiles = new Set(rampartPlan?.preRampartStructures.extensions.map((placement) => placement.tile) ?? []);
  const towerTiles = new Set(rampartPlan?.preRampartStructures.towers.map((placement) => placement.tile) ?? []);
  const outsideTiles = new Set(rampartPlan?.outsideTiles ?? []);
  const defendedTiles = new Set(rampartPlan?.defendedTiles ?? []);
  const optionalTiles = createOptionalTileMap(rampartPlan);
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
      const optional = optionalTiles.get(index);
      const classes = [
        "tile",
        terrainClass,
        outsideTiles.has(index) ? "outside" : "",
        defendedTiles.has(index) ? "defended" : "",
        roadTiles.has(index) ? "road" : "",
        extensionTiles.has(index) ? "extension" : "",
        towerTiles.has(index) ? "tower" : "",
        stampClass ? `stamp stamp-${stampClass}` : "",
        optional ? `optional-${optional}` : "",
        rampartTiles.has(index) ? "rampart" : ""
      ].filter(Boolean).join(" ");
      const label = rampartTiles.has(index)
        ? "R"
        : towerTiles.has(index)
          ? "T"
          : extensionTiles.has(index)
            ? "E"
            : objectType
              ? objectType[0]?.toUpperCase() ?? ""
              : optional
                ? optional === "source1" ? "1" : "2"
                : roadTiles.has(index)
                  ? "."
                  : stampClass
                    ? stampClass[0]?.toUpperCase() ?? ""
                    : "";
      const title = [
        `${x},${y}`,
        terrainLabel(terrainCode),
        outsideTiles.has(index) ? "outside" : null,
        defendedTiles.has(index) ? "defended" : null,
        rampartTiles.has(index) ? "rampart" : null,
        towerTiles.has(index) ? "tower" : null,
        extensionTiles.has(index) ? "extension" : null,
        roadTiles.has(index) ? "road" : null,
        stampClass ? `stamp: ${stampClass}` : null,
        optional ? `optional region: ${optional}` : null,
        objectType ? `object: ${objectType}` : null
      ].filter((value): value is string => value !== null).join(" | ");

      gridTiles.push(`<div class="${classes}" title="${escapeHtml(title)}">${escapeHtml(label)}</div>`);
    }
  }

  const optionalRows = (rampartPlan?.optionalRegions ?? []).map((region) => `<tr>
    <td>${escapeHtml(region.key)}</td>
    <td>${region.protected ? "yes" : "no"}</td>
    <td>${region.tiles.length}</td>
    <td>${region.penalty}</td>
  </tr>`).join("");
  const score = rampartPlan?.score ?? null;
  const errorBlock = errors.length === 0
    ? ""
    : `<div class="error">${errors.map(escapeHtml).join("<br>")}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rampart planning preview for ${escapeHtml(room.roomName)}</title>
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
    .outside { filter: saturate(0.72) brightness(0.72); }
    .defended { box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.8); }
    .road {
      background: #f8fafc;
      color: #0f172a;
      box-shadow: inset 0 0 0 2px #0f172a;
    }
    .extension {
      background: #38bdf8;
      color: #082f49;
      font-weight: 700;
      filter: none;
    }
    .tower {
      background: #facc15;
      color: #422006;
      font-weight: 700;
      filter: none;
    }
    .stamp-hub { outline: 1px solid rgba(59, 130, 246, 0.95); }
    .stamp-fastfiller { outline: 1px solid rgba(234, 179, 8, 0.95); }
    .stamp-labs { outline: 1px solid rgba(168, 85, 247, 0.95); }
    .optional-source1 { box-shadow: inset 0 0 0 2px rgba(20, 184, 166, 0.95); }
    .optional-source2 { box-shadow: inset 0 0 0 2px rgba(244, 114, 182, 0.95); }
    .rampart {
      background: #ef4444;
      color: #fff7ed;
      font-weight: 700;
      box-shadow: inset 0 0 0 2px #7f1d1d;
      filter: none;
    }
    .panel {
      max-width: 760px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 12px;
      margin-bottom: 16px;
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
  <h1>${escapeHtml(room.roomName)} Rampart Planning</h1>
  <div class="summary">
    <span>policy: ${escapeHtml(stampPlan.policy)}</span>
    <span>ramparts: ${rampartPlan?.rampartTiles.length ?? 0}</span>
    <span>extensions: ${rampartPlan?.preRampartStructures.extensions.length ?? 0}</span>
    <span>towers: ${rampartPlan?.preRampartStructures.towers.length ?? 0}</span>
    <span>roads: ${roadPlan?.roadTiles.length ?? 0}</span>
    <span>outside: ${rampartPlan?.outsideTiles.length ?? 0}</span>
    <span>defended: ${rampartPlan?.defendedTiles.length ?? 0}</span>
  </div>
  <div class="legend">
    <span>R/red: rampart cut</span>
    <span>E: pre-cut extension</span>
    <span>T: pre-cut tower</span>
    <span>dim: exit-reachable outside</span>
    <span>green outline: defended interior</span>
    <span>white: primary road</span>
    <span>cyan/pink: optional source regions</span>
    <span>C/S/M: controller/source/mineral</span>
  </div>
  ${errorBlock}
  <div class="layout">
    <div class="grid">${gridTiles.join("")}</div>
    <div class="panel">
      <h2>Score</h2>
      <table>
        <tbody>
          <tr><th>rampart count</th><td>${score?.rampartCount ?? 0}</td></tr>
          <tr><th>rampart base cost</th><td>${score?.rampartBaseCost ?? 0}</td></tr>
          <tr><th>distance cost</th><td>${score?.rampartDistanceCost ?? 0}</td></tr>
          <tr><th>optional penalty</th><td>${score?.optionalPenalty ?? 0}</td></tr>
          <tr><th>total cut cost</th><td>${score?.totalCost ?? 0}</td></tr>
        </tbody>
      </table>
      <h2>Optional Regions</h2>
      <table>
        <thead><tr><th>region</th><th>protected</th><th>tiles</th><th>penalty</th></tr></thead>
        <tbody>${optionalRows}</tbody>
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

function createOptionalTileMap(rampartPlan: RampartPlan | null): Map<number, string> {
  const tiles = new Map<number, string>();
  for (const region of rampartPlan?.optionalRegions ?? []) {
    for (const tile of region.tiles) {
      tiles.set(tile, region.key);
    }
  }
  return tiles;
}

function terrainLabel(code: number): string {
  if ((code & terrainMaskWall) !== 0) {
    return "terrain: wall";
  }
  if ((code & terrainMaskSwamp) !== 0) {
    return "terrain: swamp";
  }
  return "terrain: plain";
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
  process.stdout.write(`Usage: node scripts/generate-rampart-planning-preview.ts [options] [room...]

Options:
  --all   Render every cached road-planning fixture room
  --help  Show this help
`);
}
