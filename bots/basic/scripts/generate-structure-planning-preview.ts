import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planRamparts, validateRampartPlan, type RampartPlan } from "../src/planning/rampart-plan.ts";
import { planRoads, validateRoadPlan, type RoadPlan } from "../src/planning/road-plan.ts";
import type { RoomPlanningRoomData } from "../src/planning/room-plan.ts";
import { planRoomStructures, validateRoomStructurePlan, type RoomStructurePlan } from "../src/planning/structure-plan.ts";
import type { PlannedStructurePlacement, PlannedStructureType } from "../src/planning/structure-layout.ts";
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
  const previewDir = path.join(scriptDirectory, "..", "test", "artifacts", "structure-planning-preview");

  installScreepsGlobals();
  installTestPathFinder(fixture.terrainByRoom);
  mkdirSync(previewDir, { recursive: true });

  for (const testCase of cases) {
    const errors: string[] = [];
    let roadPlan: RoadPlan | null = null;
    let rampartPlan: RampartPlan | null = null;
    let structurePlan: RoomStructurePlan | null = null;

    try {
      roadPlan = planRoads(testCase.room, testCase.plan);
      errors.push(...validateRoadPlan(testCase.room, testCase.plan, roadPlan));
      rampartPlan = planRamparts(testCase.room, testCase.plan, roadPlan);
      errors.push(...validateRampartPlan(testCase.room, testCase.plan, roadPlan, rampartPlan));
      structurePlan = planRoomStructures(testCase.room, testCase.plan, roadPlan, rampartPlan);
      errors.push(...validateRoomStructurePlan(testCase.room, testCase.plan, roadPlan, rampartPlan, structurePlan));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    const html = renderPreviewHtml(testCase.room, testCase.plan, roadPlan, rampartPlan, structurePlan, errors);
    const roomPath = path.join(previewDir, `${testCase.roomName}-normal.html`);
    writeFileSync(roomPath, html, "utf8");
    writeFileSync(path.join(previewDir, "latest.html"), html, "utf8");
    process.stdout.write(`Wrote structure-planning preview for ${testCase.roomName} to ${roomPath}\n`);
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
  structurePlan: RoomStructurePlan | null,
  errors: string[]
): string {
  const structures = [...(structurePlan?.structures ?? [])].sort(compareStructureDrawOrder);
  const counts = countStructures(structures);
  const svg = renderRoomSvg(room, structures);
  const summaryRows = [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([type, count]) => `<tr>
    <td>${escapeHtml(type)}</td>
    <td>${count}</td>
  </tr>`).join("");
  const errorBlock = errors.length === 0
    ? ""
    : `<div class="error">${errors.map(escapeHtml).join("<br>")}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Structure planning preview for ${escapeHtml(room.roomName)}</title>
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
      grid-template-columns: minmax(620px, 820px) minmax(320px, 1fr);
      gap: 18px;
      align-items: start;
    }
    .room-visual {
      width: min(82vw, 820px);
      max-width: 820px;
      aspect-ratio: 1;
      background: #06080b;
      border: 1px solid #2f343c;
    }
    .terrain-plain { fill: #b6aa8d; }
    .terrain-swamp { fill: #597d34; }
    .terrain-wall { fill: #111827; }
    .grid-line { stroke: rgba(6, 8, 11, 0.55); stroke-width: 0.02; }
    .object-source { fill: #f59e0b; stroke: #78350f; stroke-width: 0.08; }
    .object-mineral { fill: #a78bfa; stroke: #4c1d95; stroke-width: 0.08; }
    .object-controller { fill: #38bdf8; stroke: #082f49; stroke-width: 0.08; }
    .structure-base { stroke-linejoin: round; stroke-linecap: round; }
    .panel {
      max-width: 720px;
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
  <h1>${escapeHtml(room.roomName)} Structure Planning</h1>
  <div class="summary">
    <span>policy: ${escapeHtml(stampPlan.policy)}</span>
    <span>structures: ${structurePlan?.structures.length ?? 0}</span>
    <span>roads: ${roadPlan?.roadTiles.length ?? 0}</span>
    <span>ramparts: ${rampartPlan?.rampartTiles.length ?? 0}</span>
    <span>towers: ${rampartPlan?.towers.length ?? 0}</span>
    <span>nuker: ${rampartPlan?.nuker ? 1 : 0}</span>
    <span>observer: ${rampartPlan?.observer ? 1 : 0}</span>
  </div>
  <div class="legend">
    <span>Shapes follow Screeps RoomVisual structure silhouettes.</span>
    <span>Hover a shape for type, label, RCL, and coordinate.</span>
  </div>
  ${errorBlock}
  <div class="layout">
    ${svg}
    <div class="panel">
      <h2>Structure Counts</h2>
      <table>
        <thead><tr><th>type</th><th>count</th></tr></thead>
        <tbody>${summaryRows}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

function renderRoomSvg(room: RoomPlanningRoomData, structures: PlannedStructurePlacement[]): string {
  const terrainTiles: string[] = [];
  for (let y = 0; y < roomSize; y += 1) {
    for (let x = 0; x < roomSize; x += 1) {
      const index = toIndex(x, y);
      const terrainCode = room.terrain.charCodeAt(index) - 48;
      const terrainClass = (terrainCode & terrainMaskWall) !== 0
        ? "terrain-wall"
        : (terrainCode & terrainMaskSwamp) !== 0
          ? "terrain-swamp"
          : "terrain-plain";
      terrainTiles.push(`<rect class="${terrainClass}" x="${x}" y="${y}" width="1" height="1"></rect>`);
    }
  }

  const gridLines: string[] = [];
  for (let value = 0; value <= roomSize; value += 1) {
    gridLines.push(`<line class="grid-line" x1="${value}" y1="0" x2="${value}" y2="${roomSize}"></line>`);
    gridLines.push(`<line class="grid-line" x1="0" y1="${value}" x2="${roomSize}" y2="${value}"></line>`);
  }

  const objectShapes = room.objects.map((object) => {
    const cx = object.x + 0.5;
    const cy = object.y + 0.5;
    const className = object.type === "source"
      ? "object-source"
      : object.type === "mineral"
        ? "object-mineral"
        : object.type === "controller"
          ? "object-controller"
          : "object-mineral";
    return `<g>
      <title>${escapeHtml(`${object.type} ${object.id} @ ${object.x},${object.y}`)}</title>
      <circle class="${className}" cx="${cx}" cy="${cy}" r="0.36"></circle>
    </g>`;
  });

  const structureShapes = structures.map((structure) => renderStructureShape(structure));

  return `<svg class="room-visual" viewBox="0 0 ${roomSize} ${roomSize}" role="img" aria-label="Resolved room structure plan">
    ${terrainTiles.join("")}
    ${gridLines.join("")}
    ${objectShapes.join("")}
    ${structureShapes.join("")}
  </svg>`;
}

function renderStructureShape(structure: PlannedStructurePlacement): string {
  const x = structure.x + 0.5;
  const y = structure.y + 0.5;
  const title = `${structure.type} ${structure.label} @ ${structure.x},${structure.y} RCL${structure.rcl}${structure.removeAtRcl ? ` remove RCL${structure.removeAtRcl}` : ""}`;
  return `<g class="structure-base structure-${escapeHtml(structure.type)}">
    <title>${escapeHtml(title)}</title>
    ${renderStructureBody(x, y, structure.type)}
  </g>`;
}

function renderStructureBody(x: number, y: number, type: PlannedStructureType): string {
  const dark = "#181818";
  const gray = "#555555";
  const light = "#AAAAAA";
  const outline = "#8FBB93";
  const road = "#666666";

  switch (type) {
    case "road":
      return `<circle cx="${x}" cy="${y}" r="0.24" fill="${road}" opacity="0.82"></circle>`;
    case "rampart":
      return `<rect x="${x - 0.46}" y="${y - 0.46}" width="0.92" height="0.92" rx="0.16" fill="#16a34a" opacity="0.22" stroke="#86efac" stroke-width="0.06"></rect>`;
    case "extension":
      return `<circle cx="${x}" cy="${y}" r="0.5" fill="${dark}" stroke="${outline}" stroke-width="0.05"></circle>
        <circle cx="${x}" cy="${y}" r="0.35" fill="${gray}"></circle>`;
    case "spawn":
      return `<circle cx="${x}" cy="${y}" r="0.7" fill="${dark}" stroke="#CCCCCC" stroke-width="0.1"></circle>
        <circle cx="${x}" cy="${y}" r="0.32" fill="${gray}" stroke="${light}" stroke-width="0.06"></circle>`;
    case "link":
      return `<polygon points="${points(x, y, [[0, -0.5], [0.4, 0], [0, 0.5], [-0.4, 0]])}" fill="${dark}" stroke="${outline}" stroke-width="0.05"></polygon>
        <polygon points="${points(x, y, [[0, -0.3], [0.25, 0], [0, 0.3], [-0.25, 0]])}" fill="${gray}"></polygon>`;
    case "terminal":
      return `<polygon points="${points(x, y, [[0, -0.8], [0.55, -0.55], [0.8, 0], [0.55, 0.55], [0, 0.8], [-0.55, 0.55], [-0.8, 0], [-0.55, -0.55]])}" fill="${dark}" stroke="${outline}" stroke-width="0.05"></polygon>
        <polygon points="${points(x, y, [[0, -0.65], [0.45, -0.45], [0.65, 0], [0.45, 0.45], [0, 0.65], [-0.45, 0.45], [-0.65, 0], [-0.45, -0.45]])}" fill="${light}"></polygon>
        <rect x="${x - 0.45}" y="${y - 0.45}" width="0.9" height="0.9" fill="${gray}" stroke="${dark}" stroke-width="0.1"></rect>`;
    case "lab":
      return `<circle cx="${x}" cy="${y - 0.025}" r="0.55" fill="${dark}" stroke="${outline}" stroke-width="0.05"></circle>
        <circle cx="${x}" cy="${y - 0.025}" r="0.4" fill="${gray}"></circle>
        <rect x="${x - 0.45}" y="${y + 0.3}" width="0.9" height="0.25" fill="${dark}"></rect>
        <polyline points="${points(x, y, [[-0.45, 0.3], [-0.45, 0.55], [0.45, 0.55], [0.45, 0.3]])}" fill="none" stroke="${outline}" stroke-width="0.05"></polyline>`;
    case "tower":
      return `<circle cx="${x}" cy="${y}" r="0.6" fill="${dark}" stroke="${outline}" stroke-width="0.05"></circle>
        <rect x="${x - 0.4}" y="${y - 0.3}" width="0.8" height="0.6" fill="${gray}"></rect>
        <rect x="${x - 0.2}" y="${y - 0.9}" width="0.4" height="0.5" fill="${light}" stroke="${dark}" stroke-width="0.07"></rect>`;
    case "container":
      return `<rect x="${x - 0.3}" y="${y - 0.45}" width="0.6" height="0.9" rx="0.07" fill="#7c4a24" stroke="#fcd34d" stroke-width="0.06"></rect>
        <line x1="${x}" y1="${y - 0.32}" x2="${x}" y2="${y + 0.32}" stroke="#fcd34d" stroke-width="0.05"></line>`;
    case "storage":
      return `<rect x="${x - 0.62}" y="${y - 0.62}" width="1.24" height="1.24" rx="0.12" fill="${dark}" stroke="${outline}" stroke-width="0.06"></rect>
        <rect x="${x - 0.42}" y="${y - 0.35}" width="0.84" height="0.7" rx="0.08" fill="${gray}" stroke="${light}" stroke-width="0.05"></rect>`;
    case "factory":
      return `<polygon points="${points(x, y, [[-0.58, -0.42], [-0.18, -0.42], [-0.18, -0.08], [0.18, -0.42], [0.58, -0.42], [0.58, 0.5], [-0.58, 0.5]])}" fill="${dark}" stroke="${outline}" stroke-width="0.06"></polygon>
        <rect x="${x - 0.38}" y="${y + 0.05}" width="0.22" height="0.28" fill="${gray}"></rect>
        <rect x="${x - 0.06}" y="${y + 0.05}" width="0.22" height="0.28" fill="${gray}"></rect>
        <rect x="${x + 0.26}" y="${y + 0.05}" width="0.22" height="0.28" fill="${gray}"></rect>`;
    case "powerSpawn":
      return `<circle cx="${x}" cy="${y}" r="0.66" fill="${dark}" stroke="#f97316" stroke-width="0.08"></circle>
        <circle cx="${x}" cy="${y}" r="0.38" fill="#f59e0b" opacity="0.86"></circle>
        <path d="M ${x - 0.12} ${y + 0.34} L ${x + 0.05} ${y + 0.04} L ${x - 0.14} ${y + 0.04} L ${x + 0.14} ${y - 0.34} L ${x + 0.02} ${y - 0.08} L ${x + 0.2} ${y - 0.08} Z" fill="#fff7ed"></path>`;
    case "nuker":
      return `<polygon points="${points(x, y, [[0, -0.72], [0.42, 0.16], [0.24, 0.58], [-0.24, 0.58], [-0.42, 0.16]])}" fill="${dark}" stroke="#fb7185" stroke-width="0.08"></polygon>
        <circle cx="${x}" cy="${y + 0.08}" r="0.22" fill="#fb7185"></circle>`;
    case "observer":
      return `<circle cx="${x}" cy="${y}" r="0.5" fill="${dark}" stroke="#34d399" stroke-width="0.06"></circle>
        <ellipse cx="${x}" cy="${y}" rx="0.34" ry="0.2" fill="${gray}" stroke="#a7f3d0" stroke-width="0.05"></ellipse>
        <circle cx="${x}" cy="${y}" r="0.11" fill="#a7f3d0"></circle>`;
    case "extractor":
      return `<circle cx="${x}" cy="${y}" r="0.48" fill="transparent" stroke="#c084fc" stroke-width="0.08"></circle>
        <path d="M ${x - 0.32} ${y} H ${x + 0.32} M ${x} ${y - 0.32} V ${y + 0.32}" stroke="#ddd6fe" stroke-width="0.08"></path>`;
  }
}

function points(x: number, y: number, offsets: Array<[number, number]>): string {
  return offsets.map(([dx, dy]) => `${formatCoord(x + dx)},${formatCoord(y + dy)}`).join(" ");
}

function formatCoord(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function compareStructureDrawOrder(left: PlannedStructurePlacement, right: PlannedStructurePlacement): number {
  const priorityDiff = structurePriority(left.type) - structurePriority(right.type);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  if (left.tile !== right.tile) {
    return left.tile - right.tile;
  }
  return left.type.localeCompare(right.type);
}

function structurePriority(type: PlannedStructureType): number {
  switch (type) {
    case "road":
      return 0;
    case "rampart":
      return 1;
    case "container":
    case "extractor":
      return 2;
    case "extension":
      return 3;
    case "link":
      return 4;
    case "tower":
      return 5;
    case "spawn":
    case "storage":
    case "terminal":
    case "lab":
    case "factory":
    case "powerSpawn":
      return 6;
    case "nuker":
    case "observer":
      return 7;
  }
}

function countStructures(structures: PlannedStructurePlacement[]): Map<PlannedStructureType, number> {
  const counts = new Map<PlannedStructureType, number>();
  for (const structure of structures) {
    counts.set(structure.type, (counts.get(structure.type) ?? 0) + 1);
  }
  return counts;
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
  process.stdout.write(`Usage: node scripts/generate-structure-planning-preview.ts [options] [room...]

Options:
  --all   Render every cached road-planning fixture room
  --help  Show this help
`);
}
