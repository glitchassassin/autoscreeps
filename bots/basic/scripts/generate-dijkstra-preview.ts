import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDijkstraMap, dijkstraUnreachable, type DijkstraMap } from "../src/planning/dijkstra-map.ts";
import { loadBotarena212RoomPlanningFixture } from "../test/helpers/room-planning-fixture.ts";

const roomSize = 50;
const roomArea = roomSize * roomSize;
const terrainMaskWall = 1;
const terrainMaskSwamp = 2;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const fixture = loadBotarena212RoomPlanningFixture();
  const args = process.argv.slice(2);
  const renderAll = args.includes("--all");
  const requestedRooms = args.filter((arg) => arg !== "--all");
  const roomNames = renderAll
    ? fixture.candidateRooms
    : requestedRooms.length > 0
      ? requestedRooms
      : [fixture.candidateRooms[0] ?? "E11N1"];
  const previewDir = path.join(scriptDirectory, "..", "test", "artifacts", "dijkstra-preview");
  mkdirSync(previewDir, { recursive: true });

  for (const roomName of roomNames) {
    const room = fixture.map.getRoom(roomName);
    if (room === null) {
      throw new Error(`Fixture room '${roomName}' not found.`);
    }

    const controller = room.objects.find((object) => object.type === "controller");
    if (!controller) {
      throw new Error(`Fixture room '${roomName}' is missing a controller.`);
    }

    const map = createDijkstraMap(room.terrain, [{ x: controller.x, y: controller.y }]);
    const html = renderDijkstraMapHtml({
      title: `Dijkstra preview for ${roomName}`,
      roomName,
      terrain: room.terrain,
      map,
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
    process.stdout.write(`Wrote Dijkstra preview for ${roomName} to ${roomPath}\n`);
  }

  process.stdout.write(`Preview directory: ${previewDir}\n`);
}

type DijkstraMapHtmlMarker = {
  x: number;
  y: number;
  label: string;
  className?: string;
  title?: string;
};

type DijkstraMapHtmlInput = {
  title: string;
  roomName: string;
  terrain: string;
  map: DijkstraMap;
  markers?: DijkstraMapHtmlMarker[];
};

function renderDijkstraMapHtml(input: DijkstraMapHtmlInput): string {
  validateTerrain(input.terrain);

  const maxDistance = findMaxFiniteDistance(input.map.distances);
  const width = Math.max(2, Math.ceil(Math.log(Math.max(1, maxDistance + 1)) / Math.log(36)));
  const markersByIndex = new Map<number, DijkstraMapHtmlMarker[]>();

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
      const terrainCode = Number(input.terrain[index] ?? "0");
      const distance = input.map.distances[index];
      const movementCost = input.map.movementCosts[index];
      const terrainClass = (terrainCode & terrainMaskWall) !== 0
        ? "terrain-wall"
        : (terrainCode & terrainMaskSwamp) !== 0
          ? "terrain-swamp"
          : "terrain-plain";
      const stateClass = movementCost === dijkstraUnreachable
        ? "tile-blocked"
        : distance === dijkstraUnreachable
          ? "tile-unreachable"
          : "tile-reachable";
      const markers = markersByIndex.get(index) ?? [];
      const markerLabels = markers.map((marker) => escapeHtml(marker.label)).join("");
      const markerClasses = markers.map((marker) => marker.className?.trim()).filter((value): value is string => Boolean(value)).join(" ");
      const distanceLabel = distance === dijkstraUnreachable ? "" : distance.toString(36).padStart(width, "0");
      const title = [
        `${input.roomName} (${x},${y})`,
        `terrain: ${describeTerrain(terrainCode)}`,
        movementCost === dijkstraUnreachable ? "movement: blocked" : `movement: ${movementCost}`,
        distance === dijkstraUnreachable ? "distance: unreachable" : `distance: ${distance}`,
        ...markers.map((marker) => marker.title ?? `marker: ${marker.label}`)
      ].join("\n");

      tiles.push(
        `<div class="tile ${terrainClass} ${stateClass}" title="${escapeHtml(title)}">`
          + `<span class="distance">${escapeHtml(distanceLabel)}</span>`
          + (markerLabels.length > 0 ? `<span class="markers ${markerClasses}">${markerLabels}</span>` : "")
          + `</div>`
      );
    }
  }

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
      background: #111827;
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
      border: 1px solid rgba(255, 255, 255, 0.12);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(${roomSize}, 20px);
      gap: 1px;
      width: max-content;
      padding: 1px;
      background: #0b1220;
      border: 1px solid #1f2937;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35);
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
    .terrain-plain {
      background: #d6c6a5;
      color: #1f2937;
    }
    .terrain-swamp {
      background: #4d7c0f;
      color: #f7fee7;
    }
    .terrain-wall {
      background: #111827;
      color: #9ca3af;
    }
    .tile-unreachable {
      outline: 1px solid rgba(239, 68, 68, 0.45);
    }
    .tile-blocked {
      opacity: 0.95;
    }
    .distance {
      display: block;
      letter-spacing: -0.4px;
    }
    .markers {
      position: absolute;
      top: 1px;
      right: 1px;
      display: inline-flex;
      gap: 1px;
      padding: 0 2px;
      border-radius: 999px;
      background: rgba(17, 24, 39, 0.88);
      color: #f9fafb;
      font-size: 8px;
      line-height: 10px;
    }
    .footer {
      margin-top: 16px;
      color: #9ca3af;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(input.title)}</h1>
  <p>Room ${escapeHtml(input.roomName)}. Distances are base-36. Hover a tile for coordinates, terrain, movement cost, and exact distance.</p>
  <div class="legend">
    <span class="legend-item"><span class="legend-swatch" style="background:#d6c6a5"></span>Plain</span>
    <span class="legend-item"><span class="legend-swatch" style="background:#4d7c0f"></span>Swamp</span>
    <span class="legend-item"><span class="legend-swatch" style="background:#111827"></span>Wall</span>
    <span class="legend-item"><span class="legend-swatch" style="background:#d6c6a5; outline: 1px solid rgba(239,68,68,.45)"></span>Unreachable</span>
  </div>
  <div class="grid">
    ${tiles.join("\n    ")}
  </div>
  <p class="footer">Markers: C = controller, S = source, M = mineral.</p>
</body>
</html>
`;
}

function findMaxFiniteDistance(distances: Uint32Array): number {
  let maxDistance = 0;

  for (const distance of distances) {
    if (distance !== dijkstraUnreachable && distance > maxDistance) {
      maxDistance = distance;
    }
  }

  return maxDistance;
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

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
