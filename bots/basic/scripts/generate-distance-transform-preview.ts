import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTerrainDistanceTransform, type TerrainDistanceTransform } from "../src/planning/distance-transform.ts";
import { loadBotarena212RoomPlanningFixture } from "../test/helpers/room-planning-fixture.ts";

type DistanceTransformPreviewConfig = {
  renderAll: boolean;
  roomNames: string[];
};

type DistanceTransformHtmlMarker = {
  x: number;
  y: number;
  label: string;
  className?: string;
  title?: string;
};

type DistanceTransformHtmlInput = {
  title: string;
  roomName: string;
  terrain: string;
  transform: TerrainDistanceTransform;
  markers?: DistanceTransformHtmlMarker[];
};

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

const roomSize = 50;
const roomArea = roomSize * roomSize;
const terrainMaskWall = 1;
const terrainMaskSwamp = 2;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const heatStops: Array<{ at: number; color: RgbColor }> = [
  { at: 0, color: { r: 68, g: 1, b: 84 } },
  { at: 0.25, color: { r: 59, g: 82, b: 139 } },
  { at: 0.5, color: { r: 33, g: 145, b: 140 } },
  { at: 0.75, color: { r: 94, g: 201, b: 98 } },
  { at: 1, color: { r: 253, g: 231, b: 37 } }
];

async function main(): Promise<void> {
  const fixture = loadBotarena212RoomPlanningFixture();
  const config = parseArgs(process.argv.slice(2));
  const roomNames = config.renderAll
    ? fixture.candidateRooms
    : config.roomNames.length > 0
      ? config.roomNames
      : [fixture.candidateRooms[0] ?? "E11N1"];
  const previewDir = path.join(scriptDirectory, "..", "test", "artifacts", "distance-transform-preview");
  mkdirSync(previewDir, { recursive: true });

  for (const roomName of roomNames) {
    const room = fixture.map.getRoom(roomName);
    if (room === null) {
      throw new Error(`Fixture room '${roomName}' not found.`);
    }

    const transform = createTerrainDistanceTransform(room.terrain);
    const html = renderDistanceTransformHtml({
      title: `Distance transform preview for ${roomName}`,
      roomName,
      terrain: room.terrain,
      transform,
      markers: room.objects
        .filter((object) => object.type === "controller" || object.type === "source" || object.type === "mineral")
        .map((object) => ({
          x: object.x,
          y: object.y,
          label: object.type === "controller" ? "C" : object.type === "source" ? "S" : "M",
          className: object.type,
          title: `${object.type} (${object.x}, ${object.y})`
        }))
    });

    const roomPath = path.join(previewDir, `${roomName}.html`);
    writeFileSync(roomPath, html, "utf8");
    writeFileSync(path.join(previewDir, "latest.html"), html, "utf8");
    process.stdout.write(`Wrote distance-transform preview for ${roomName} to ${roomPath}\n`);
  }

  process.stdout.write(`Preview directory: ${previewDir}\n`);
}

function parseArgs(args: string[]): DistanceTransformPreviewConfig {
  const config: DistanceTransformPreviewConfig = {
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

function renderDistanceTransformHtml(input: DistanceTransformHtmlInput): string {
  validateTerrain(input.terrain);

  const markersByIndex = new Map<number, DistanceTransformHtmlMarker[]>();
  for (const marker of input.markers ?? []) {
    validateCoordinate(marker.x, marker.y);
    const index = toIndex(marker.x, marker.y);
    const existing = markersByIndex.get(index);
    if (existing) {
      existing.push(marker);
    } else {
      markersByIndex.set(index, [marker]);
    }
  }

  const tiles: string[] = [];

  for (let y = 0; y < roomSize; y += 1) {
    for (let x = 0; x < roomSize; x += 1) {
      const index = toIndex(x, y);
      const terrainCode = input.terrain.charCodeAt(index) - 48;
      const distance = input.transform.distances[index]!;
      const isWall = (terrainCode & terrainMaskWall) !== 0;
      const terrainClass = isWall
        ? "terrain-wall"
        : (terrainCode & terrainMaskSwamp) !== 0
          ? "terrain-swamp"
          : "terrain-plain";
      const markers = markersByIndex.get(index) ?? [];
      const markerLabels = markers.map((marker) => escapeHtml(marker.label)).join("");
      const markerClasses = markers.map((marker) => marker.className?.trim()).filter((value): value is string => Boolean(value)).join(" ");
      const heatColor = isWall ? { r: 17, g: 24, b: 39 } : interpolateHeatColor(distance, input.transform.maxDistance);
      const title = [
        `${input.roomName} (${x},${y})`,
        `terrain: ${describeTerrain(terrainCode)}`,
        `clearance: ${distance}`,
        ...markers.map((marker) => marker.title ?? `marker: ${marker.label}`)
      ].join("\n");

      tiles.push(
        `<div class="tile ${terrainClass}" style="background:${formatRgb(heatColor)}; color:${textColorFor(heatColor)}" title="${escapeHtml(title)}">`
          + `<span class="distance">${distance === 0 ? "" : distance.toString(10)}</span>`
          + (markerLabels.length > 0 ? `<span class="markers ${markerClasses}">${markerLabels}</span>` : "")
          + `</div>`
      );
    }
  }

  const legendStops = heatStops.map((stop) => {
    const color = formatRgb(stop.color);
    const label = Math.round(stop.at * input.transform.maxDistance);
    return `<span class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${label}</span>`;
  }).join("\n    ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    body {
      margin: 0;
      padding: 24px;
      background: #101114;
      color: #e5e7eb;
    }
    h1, p {
      margin: 0 0 12px;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin: 0 0 16px;
      font-size: 14px;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .legend-swatch {
      width: 16px;
      height: 16px;
      border: 1px solid rgba(255, 255, 255, 0.16);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(${roomSize}, 20px);
      gap: 1px;
      width: max-content;
      padding: 1px;
      background: #0b0d10;
      border: 1px solid #2f343c;
    }
    .tile {
      position: relative;
      width: 20px;
      height: 20px;
      overflow: hidden;
      font-size: 10px;
      line-height: 20px;
      text-align: center;
    }
    .terrain-wall {
      color: #6b7280;
    }
    .terrain-swamp {
      box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.35);
    }
    .distance {
      display: block;
    }
    .markers {
      position: absolute;
      top: 1px;
      right: 1px;
      display: inline-flex;
      gap: 1px;
      padding: 0 2px;
      border-radius: 4px;
      background: rgba(17, 24, 39, 0.88);
      color: #f9fafb;
      font-size: 8px;
      line-height: 10px;
    }
    .footer {
      margin-top: 16px;
      color: #a7b0bc;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(input.title)}</h1>
  <p>Room ${escapeHtml(input.roomName)}. Max clearance: ${input.transform.maxDistance}.</p>
  <div class="legend">
    <span class="legend-item"><span class="legend-swatch" style="background:#111827"></span>Wall</span>
    ${legendStops}
  </div>
  <div class="grid">
    ${tiles.join("\n    ")}
  </div>
  <p class="footer">Markers: C = controller, S = source, M = mineral.</p>
</body>
</html>
`;
}

function interpolateHeatColor(distance: number, maxDistance: number): RgbColor {
  if (maxDistance <= 0) {
    return heatStops[0]!.color;
  }

  const ratio = Math.min(1, Math.max(0, distance / maxDistance));

  for (let index = 1; index < heatStops.length; index += 1) {
    const right = heatStops[index]!;
    if (ratio > right.at) {
      continue;
    }

    const left = heatStops[index - 1]!;
    const span = right.at - left.at;
    const localRatio = span <= 0 ? 0 : (ratio - left.at) / span;
    return {
      r: interpolateChannel(left.color.r, right.color.r, localRatio),
      g: interpolateChannel(left.color.g, right.color.g, localRatio),
      b: interpolateChannel(left.color.b, right.color.b, localRatio)
    };
  }

  return heatStops[heatStops.length - 1]!.color;
}

function interpolateChannel(left: number, right: number, ratio: number): number {
  return Math.round(left + (right - left) * ratio);
}

function formatRgb(color: RgbColor): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function textColorFor(color: RgbColor): string {
  const luminance = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
  return luminance > 0.55 ? "#111827" : "#f9fafb";
}

function validateTerrain(terrain: string): void {
  if (terrain.length !== roomArea) {
    throw new Error(`Expected terrain string length ${roomArea}, received ${terrain.length}.`);
  }
}

function validateCoordinate(x: number, y: number): void {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= roomSize || y < 0 || y >= roomSize) {
    throw new Error(`Invalid room coordinate (${x}, ${y}).`);
  }
}

function toIndex(x: number, y: number): number {
  return y * roomSize + x;
}

function describeTerrain(terrainCode: number): string {
  if ((terrainCode & terrainMaskWall) !== 0) {
    return "wall";
  }

  if ((terrainCode & terrainMaskSwamp) !== 0) {
    return "swamp";
  }

  return "plain";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function printHelp(): void {
  process.stdout.write(`Usage: npm run preview:distance-transform -- [room ...] [options]\n\n`);
  process.stdout.write(`Positional room names render previews for specific rooms.\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --all   Render all viable botarena-212 planning rooms\n`);
  process.stdout.write(`  --help  Print this help text\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
