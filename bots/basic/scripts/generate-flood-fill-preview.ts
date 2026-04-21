import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FloodFillSeed } from "../src/planning/flood-fill.ts";
import { loadBotarena212RoomPlanningFixture } from "../test/helpers/room-planning-fixture.ts";
import type { RoomPlanningObject } from "../src/planning/room-plan.ts";

type SeedMode = "controller" | "sources" | "controller-and-sources";

type FloodFillPreviewConfig = {
  renderAll: boolean;
  roomNames: string[];
  seedMode: SeedMode;
};

type FloodFillTraceStep = {
  current: number;
  added: number[];
  stackSize: number;
  visitedCount: number;
  edgeFallback: boolean;
};

type FloodFillTrace = {
  seedIndexes: number[];
  visitFrames: Uint16Array;
  popFrames: Uint16Array;
  steps: FloodFillTraceStep[];
  visitedCount: number;
};

type FloodFillHtmlMarker = {
  x: number;
  y: number;
  label: string;
  className?: string;
  title?: string;
};

type FloodFillHtmlInput = {
  title: string;
  roomName: string;
  terrain: string;
  mask: Uint8Array;
  seedMode: SeedMode;
  seeds: FloodFillSeed[];
  trace: FloodFillTrace;
  markers?: FloodFillHtmlMarker[];
};

const roomSize = 50;
const roomArea = roomSize * roomSize;
const maxNeighbors = 8;
const terrainMaskWall = 1;
const terrainMaskSwamp = 2;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const fixture = loadBotarena212RoomPlanningFixture();
  const config = parseArgs(process.argv.slice(2));
  const roomNames = config.renderAll
    ? fixture.candidateRooms
    : config.roomNames.length > 0
      ? config.roomNames
      : [fixture.candidateRooms[0] ?? "E11N1"];
  const previewDir = path.join(scriptDirectory, "..", "test", "artifacts", "flood-fill-preview");
  mkdirSync(previewDir, { recursive: true });

  for (const roomName of roomNames) {
    const room = fixture.map.getRoom(roomName);
    if (room === null) {
      throw new Error(`Fixture room '${roomName}' not found.`);
    }

    const mask = createWalkableTerrainMask(room.terrain);
    const seeds = selectSeeds(room.objects, mask, config.seedMode);
    if (seeds.length === 0) {
      throw new Error(`Room '${roomName}' has no walkable seeds for mode '${config.seedMode}'.`);
    }

    const trace = traceFloodFill(mask, seeds);
    const html = renderFloodFillHtml({
      title: `Flood fill preview for ${roomName}`,
      roomName,
      terrain: room.terrain,
      mask,
      seedMode: config.seedMode,
      seeds,
      trace,
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
    process.stdout.write(`Wrote flood-fill preview for ${roomName} to ${roomPath}\n`);
  }

  process.stdout.write(`Preview directory: ${previewDir}\n`);
}

function parseArgs(args: string[]): FloodFillPreviewConfig {
  const config: FloodFillPreviewConfig = {
    renderAll: false,
    roomNames: [],
    seedMode: "controller"
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (!arg.startsWith("--")) {
      config.roomNames.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = splitFlag(arg);
    const key = rawKey.slice(2);

    switch (key) {
      case "all":
        config.renderAll = true;
        break;
      case "seeds": {
        const value = readStringFlag(key, inlineValue, args, index);
        if (inlineValue === null) {
          index += 1;
        }
        config.seedMode = parseSeedMode(value);
        break;
      }
      case "help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown flag '${arg}'.`);
    }
  }

  return config;
}

function createWalkableTerrainMask(terrain: string): Uint8Array {
  validateTerrain(terrain);
  const mask = new Uint8Array(roomArea);

  for (let index = 0; index < roomArea; index += 1) {
    const terrainCode = terrain.charCodeAt(index) - 48;
    if ((terrainCode & terrainMaskWall) === 0) {
      mask[index] = 1;
    }
  }

  return mask;
}

function selectSeeds(objects: RoomPlanningObject[], mask: Uint8Array, seedMode: SeedMode): FloodFillSeed[] {
  const seeds: FloodFillSeed[] = [];
  const seen = new Uint8Array(roomArea);
  const targets = selectSeedObjects(objects, seedMode);

  for (const target of targets) {
    const minX = Math.max(0, target.x - 1);
    const maxX = Math.min(roomSize - 1, target.x + 1);
    const minY = Math.max(0, target.y - 1);
    const maxY = Math.min(roomSize - 1, target.y + 1);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const index = toIndex(x, y);
        if (mask[index] === 0 || seen[index] !== 0) {
          continue;
        }

        seen[index] = 1;
        seeds.push({ x, y });
      }
    }
  }

  return seeds;
}

function selectSeedObjects(objects: RoomPlanningObject[], seedMode: SeedMode): RoomPlanningObject[] {
  switch (seedMode) {
    case "controller":
      return objects.filter((object) => object.type === "controller");
    case "sources":
      return objects.filter((object) => object.type === "source");
    case "controller-and-sources":
      return objects.filter((object) => object.type === "controller" || object.type === "source");
  }
}

function traceFloodFill(mask: Uint8Array, seeds: FloodFillSeed[]): FloodFillTrace {
  const visited = new Uint8Array(roomArea);
  const visitFrames = new Uint16Array(roomArea);
  const popFrames = new Uint16Array(roomArea);
  const stack = new Uint16Array(roomArea);
  const steps: FloodFillTraceStep[] = [];
  const seedIndexes: number[] = [];
  let stackSize = 0;
  let visitedCount = 0;

  for (const seed of seeds) {
    const index = toIndex(seed.x, seed.y);
    if (mask[index] === 0 || visited[index] !== 0) {
      continue;
    }

    visited[index] = 1;
    visitedCount += 1;
    seedIndexes.push(index);
    stack[stackSize] = index;
    stackSize += 1;
  }

  while (stackSize > 0) {
    stackSize -= 1;
    const index = stack[stackSize]!;
    const stepFrame = steps.length + 1;
    const added: number[] = [];
    popFrames[index] = stepFrame;

    if (interiorTiles[index] !== 0) {
      stackSize = visitNeighbor(index + 1, mask, visited, visitFrames, stack, stackSize, stepFrame, added);
      stackSize = visitNeighbor(index - 1, mask, visited, visitFrames, stack, stackSize, stepFrame, added);
      stackSize = visitNeighbor(index + roomSize, mask, visited, visitFrames, stack, stackSize, stepFrame, added);
      stackSize = visitNeighbor(index - roomSize, mask, visited, visitFrames, stack, stackSize, stepFrame, added);
      stackSize = visitNeighbor(index + roomSize + 1, mask, visited, visitFrames, stack, stackSize, stepFrame, added);
      stackSize = visitNeighbor(index - roomSize + 1, mask, visited, visitFrames, stack, stackSize, stepFrame, added);
      stackSize = visitNeighbor(index + roomSize - 1, mask, visited, visitFrames, stack, stackSize, stepFrame, added);
      stackSize = visitNeighbor(index - roomSize - 1, mask, visited, visitFrames, stack, stackSize, stepFrame, added);
    } else {
      const neighborOffset = index * maxNeighbors;
      const neighborCount = neighborCounts[index]!;

      for (let neighborIndexOffset = 0; neighborIndexOffset < neighborCount; neighborIndexOffset += 1) {
        stackSize = visitNeighbor(
          neighborIndexes[neighborOffset + neighborIndexOffset]!,
          mask,
          visited,
          visitFrames,
          stack,
          stackSize,
          stepFrame,
          added
        );
      }
    }

    visitedCount += added.length;
    steps.push({
      current: index,
      added,
      stackSize,
      visitedCount,
      edgeFallback: interiorTiles[index] === 0
    });
  }

  return {
    seedIndexes,
    visitFrames,
    popFrames,
    steps,
    visitedCount
  };
}

function visitNeighbor(
  index: number,
  mask: Uint8Array,
  visited: Uint8Array,
  visitFrames: Uint16Array,
  stack: Uint16Array,
  stackSize: number,
  stepFrame: number,
  added: number[]
): number {
  if (mask[index] === 0 || visited[index] !== 0) {
    return stackSize;
  }

  visited[index] = 1;
  visitFrames[index] = stepFrame;
  added.push(index);
  stack[stackSize] = index;
  return stackSize + 1;
}

function renderFloodFillHtml(input: FloodFillHtmlInput): string {
  validateTerrain(input.terrain);

  const markersByIndex = new Map<number, FloodFillHtmlMarker[]>();
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

  const seedSet = new Set(input.trace.seedIndexes);
  const tiles: string[] = [];

  for (let y = 0; y < roomSize; y += 1) {
    for (let x = 0; x < roomSize; x += 1) {
      const index = toIndex(x, y);
      const terrainCode = input.terrain.charCodeAt(index) - 48;
      const terrainClass = (terrainCode & terrainMaskWall) !== 0
        ? "terrain-wall"
        : (terrainCode & terrainMaskSwamp) !== 0
          ? "terrain-swamp"
          : "terrain-plain";
      const markers = markersByIndex.get(index) ?? [];
      const markerLabels = markers.map((marker) => escapeHtml(marker.label)).join("");
      const markerClasses = markers.map((marker) => marker.className?.trim()).filter((value): value is string => Boolean(value)).join(" ");
      const seedLabel = seedSet.has(index) ? "•" : "";
      const title = [
        `${input.roomName} (${x},${y})`,
        `terrain: ${describeTerrain(terrainCode)}`,
        input.mask[index] === 0 ? "mask: blocked" : "mask: walkable",
        seedSet.has(index) ? "seed: yes" : "seed: no",
        ...markers.map((marker) => marker.title ?? `marker: ${marker.label}`)
      ].join("\n");

      tiles.push(
        `<div class="tile ${terrainClass}" data-index="${index}" title="${escapeHtml(title)}">`
          + `<span class="seed">${seedLabel}</span>`
          + (markerLabels.length > 0 ? `<span class="markers ${markerClasses}">${markerLabels}</span>` : "")
          + `</div>`
      );
    }
  }

  const steps = input.trace.steps.map((step) => ({
    current: step.current,
    added: step.added,
    stackSize: step.stackSize,
    visitedCount: step.visitedCount,
    edgeFallback: step.edgeFallback
  }));

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
      --bg: #10151f;
      --panel: #172033;
      --ink: #e5edf8;
      --muted: #97a6ba;
      --plain: #d6c6a5;
      --swamp: #4d7c0f;
      --wall: #0b1020;
      --processed: #334155;
      --frontier: #2563eb;
      --current: #f97316;
      --added: #14b8a6;
      --seed: #facc15;
    }
    body {
      margin: 0;
      padding: 24px;
      background:
        radial-gradient(circle at top left, rgba(20, 184, 166, 0.16), transparent 34rem),
        linear-gradient(135deg, #0b1020 0%, var(--bg) 52%, #111827 100%);
      color: var(--ink);
    }
    h1, p {
      margin: 0 0 12px;
    }
    .layout {
      display: grid;
      grid-template-columns: max-content minmax(280px, 420px);
      gap: 24px;
      align-items: start;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(${roomSize}, 15px);
      gap: 1px;
      width: max-content;
      padding: 1px;
      background: #060a12;
      border: 1px solid rgba(148, 163, 184, 0.24);
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.35);
    }
    .tile {
      position: relative;
      width: 15px;
      height: 15px;
      overflow: hidden;
      font-size: 8px;
      line-height: 15px;
      text-align: center;
      color: #0f172a;
      transition: background-color 80ms linear, box-shadow 80ms linear, transform 80ms linear;
    }
    .terrain-plain {
      background: color-mix(in srgb, var(--plain) 68%, #0f172a 32%);
    }
    .terrain-swamp {
      background: color-mix(in srgb, var(--swamp) 72%, #0f172a 28%);
      color: #ecfccb;
    }
    .terrain-wall {
      background: var(--wall);
      color: #64748b;
    }
    .tile.processed {
      background: var(--processed);
      color: #dbeafe;
    }
    .tile.frontier {
      background: var(--frontier);
      color: #eff6ff;
      box-shadow: inset 0 0 0 1px rgba(219, 234, 254, 0.35);
    }
    .tile.added {
      background: var(--added);
      color: #042f2e;
      transform: scale(1.08);
      z-index: 2;
    }
    .tile.current {
      background: var(--current);
      color: #431407;
      transform: scale(1.18);
      z-index: 3;
      box-shadow: 0 0 0 2px rgba(254, 215, 170, 0.75);
    }
    .seed {
      position: absolute;
      left: 2px;
      bottom: 0;
      color: var(--seed);
      font-size: 12px;
      line-height: 12px;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    }
    .markers {
      position: absolute;
      top: 1px;
      right: 1px;
      display: inline-flex;
      gap: 1px;
      padding: 0 2px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.88);
      color: #f8fafc;
      font-size: 7px;
      line-height: 9px;
    }
    .panel {
      padding: 18px;
      background: color-mix(in srgb, var(--panel) 88%, transparent);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 18px;
      box-shadow: 0 20px 36px rgba(0, 0, 0, 0.28);
    }
    .controls {
      display: grid;
      gap: 12px;
      margin: 16px 0;
    }
    .button-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    button {
      appearance: none;
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 999px;
      padding: 8px 12px;
      background: #0f172a;
      color: var(--ink);
      font: inherit;
      cursor: pointer;
    }
    button:hover {
      background: #1e293b;
    }
    input[type="range"] {
      width: 100%;
    }
    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 13px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 12px;
    }
    .stat {
      padding: 10px;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid rgba(148, 163, 184, 0.14);
    }
    .stat b {
      display: block;
      color: var(--muted);
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .stat span {
      display: block;
      margin-top: 4px;
      font-size: 16px;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 16px;
      color: var(--muted);
      font-size: 12px;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .legend-swatch {
      width: 14px;
      height: 14px;
      border: 1px solid rgba(255, 255, 255, 0.14);
    }
    .footer {
      margin-top: 16px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    @media (max-width: 1180px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .grid {
        grid-template-columns: repeat(${roomSize}, minmax(9px, 1fr));
        width: 100%;
      }
      .tile {
        width: auto;
        aspect-ratio: 1;
        height: auto;
        line-height: 1;
      }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(input.title)}</h1>
  <p>Room ${escapeHtml(input.roomName)}. Animated stack-based 8-way flood fill seeded from walkable range 1 tiles around <code>${escapeHtml(input.seedMode)}</code>.</p>
  <div class="layout">
    <div class="grid" id="grid">
      ${tiles.join("\n      ")}
    </div>
    <aside class="panel">
      <h2>Trace Controls</h2>
      <p>Frame 0 shows only seeds on the frontier. Each following frame pops one tile from the stack and pushes any newly discovered neighbors.</p>
      <div class="controls">
        <div class="button-row">
          <button id="play">Play</button>
          <button id="back">Step Back</button>
          <button id="next">Step Forward</button>
          <button id="reset">Reset</button>
          <button id="end">End</button>
        </div>
        <label>
          Frame
          <input id="frame" type="range" min="0" max="${steps.length}" value="0">
        </label>
        <label>
          Delay: <span id="delay-label">25 ms</span>
          <input id="delay" type="range" min="0" max="250" step="5" value="25">
        </label>
      </div>
      <div class="stats">
        <div class="stat"><b>Frame</b><span id="frame-stat">0 / ${steps.length}</span></div>
        <div class="stat"><b>Visited</b><span id="visited-stat">${input.trace.seedIndexes.length} / ${input.trace.visitedCount}</span></div>
        <div class="stat"><b>Frontier</b><span id="frontier-stat">${input.trace.seedIndexes.length}</span></div>
        <div class="stat"><b>Added This Step</b><span id="added-stat">0</span></div>
        <div class="stat"><b>Current Tile</b><span id="current-stat">none</span></div>
        <div class="stat"><b>Path</b><span id="path-stat">seed</span></div>
      </div>
      <div class="legend">
        <span class="legend-item"><span class="legend-swatch" style="background:var(--plain)"></span>Plain</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--swamp)"></span>Swamp</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--wall)"></span>Wall</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--frontier)"></span>Frontier</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--processed)"></span>Processed</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--added)"></span>New</span>
        <span class="legend-item"><span class="legend-swatch" style="background:var(--current)"></span>Current</span>
      </div>
      <p class="footer">Markers: C = controller, S = source, M = mineral. Yellow dots mark initial seed tiles.</p>
    </aside>
  </div>
  <script>
    const steps = ${JSON.stringify(steps)};
    const visitFrames = ${JSON.stringify(Array.from(input.trace.visitFrames))};
    const popFrames = ${JSON.stringify(Array.from(input.trace.popFrames))};
    const seedIndexes = new Set(${JSON.stringify(input.trace.seedIndexes)});
    const maxFrame = steps.length;
    const tiles = Array.from(document.querySelectorAll(".tile"));
    const frameInput = document.getElementById("frame");
    const delayInput = document.getElementById("delay");
    const delayLabel = document.getElementById("delay-label");
    const playButton = document.getElementById("play");
    const frameStat = document.getElementById("frame-stat");
    const visitedStat = document.getElementById("visited-stat");
    const frontierStat = document.getElementById("frontier-stat");
    const addedStat = document.getElementById("added-stat");
    const currentStat = document.getElementById("current-stat");
    const pathStat = document.getElementById("path-stat");
    let frame = 0;
    let timer = null;

    function coordinates(index) {
      return "(" + (index % ${roomSize}) + "," + Math.floor(index / ${roomSize}) + ")";
    }

    function render(nextFrame) {
      frame = Math.max(0, Math.min(maxFrame, nextFrame));
      frameInput.value = String(frame);
      const step = frame > 0 ? steps[frame - 1] : null;
      const current = step ? step.current : -1;
      const added = new Set(step ? step.added : []);
      let frontierCount = 0;

      for (let index = 0; index < tiles.length; index += 1) {
        const tile = tiles[index];
        tile.classList.remove("processed", "frontier", "current", "added");
        const visitFrame = seedIndexes.has(index) ? 0 : visitFrames[index];
        const popFrame = popFrames[index];
        const hasBeenVisited = seedIndexes.has(index) || (visitFrame > 0 && visitFrame <= frame);

        if (!hasBeenVisited) {
          continue;
        }

        if (index === current) {
          tile.classList.add("current");
          continue;
        }

        if (added.has(index)) {
          tile.classList.add("added");
          frontierCount += 1;
          continue;
        }

        if (popFrame > 0 && popFrame <= frame) {
          tile.classList.add("processed");
          continue;
        }

        tile.classList.add("frontier");
        frontierCount += 1;
      }

      frameStat.textContent = frame + " / " + maxFrame;
      visitedStat.textContent = (step ? step.visitedCount : seedIndexes.size) + " / ${input.trace.visitedCount}";
      frontierStat.textContent = String(step ? step.stackSize : seedIndexes.size);
      addedStat.textContent = String(step ? step.added.length : 0);
      currentStat.textContent = step ? coordinates(step.current) : "none";
      pathStat.textContent = step ? (step.edgeFallback ? "edge lookup fallback" : "interior fast path") : "seed";
      if (frame >= maxFrame) {
        stop();
      }
    }

    function play() {
      if (timer !== null) {
        stop();
        return;
      }

      playButton.textContent = "Pause";
      timer = window.setInterval(() => {
        if (frame >= maxFrame) {
          stop();
          return;
        }
        render(frame + 1);
      }, Number(delayInput.value));
    }

    function stop() {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
      playButton.textContent = "Play";
    }

    playButton.addEventListener("click", play);
    document.getElementById("back").addEventListener("click", () => {
      stop();
      render(frame - 1);
    });
    document.getElementById("next").addEventListener("click", () => {
      stop();
      render(frame + 1);
    });
    document.getElementById("reset").addEventListener("click", () => {
      stop();
      render(0);
    });
    document.getElementById("end").addEventListener("click", () => {
      stop();
      render(maxFrame);
    });
    frameInput.addEventListener("input", () => {
      stop();
      render(Number(frameInput.value));
    });
    delayInput.addEventListener("input", () => {
      delayLabel.textContent = delayInput.value + " ms";
      if (timer !== null) {
        stop();
        play();
      }
    });

    render(0);
  </script>
</body>
</html>
`;
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

function splitFlag(flag: string): [string, string | null] {
  const equalsIndex = flag.indexOf("=");
  if (equalsIndex === -1) {
    return [flag, null];
  }

  return [flag.slice(0, equalsIndex), flag.slice(equalsIndex + 1)];
}

function readStringFlag(name: string, inlineValue: string | null, args: string[], index: number): string {
  if (inlineValue !== null) {
    return inlineValue;
  }

  const nextValue = args[index + 1];
  if (!nextValue || nextValue.startsWith("--")) {
    throw new Error(`Flag '--${name}' expects a value.`);
  }

  return nextValue;
}

function parseSeedMode(value: string): SeedMode {
  if (value === "controller" || value === "sources" || value === "controller-and-sources") {
    return value;
  }

  throw new Error(`Flag '--seeds' expects one of: controller, sources, controller-and-sources.`);
}

function printHelp(): void {
  process.stdout.write(`Usage: npm run preview:flood-fill -- [room ...] [options]\n\n`);
  process.stdout.write(`Positional room names limit the preview to those rooms.\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --all                      Render every planner-candidate room\n`);
  process.stdout.write(`  --seeds <mode>             Seed mode: controller, sources, controller-and-sources (default: controller)\n`);
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

const { neighborCounts, neighborIndexes } = createNeighborLookup();
const interiorTiles = createInteriorTiles();

function createNeighborLookup(): { neighborCounts: Uint8Array; neighborIndexes: Int16Array } {
  const counts = new Uint8Array(roomArea);
  const indexes = new Int16Array(roomArea * maxNeighbors);

  for (let index = 0; index < roomArea; index += 1) {
    const x = index % roomSize;
    const hasWest = x > 0;
    const hasEast = x < roomSize - 1;
    const hasNorth = index >= roomSize;
    const hasSouth = index < roomArea - roomSize;
    const offset = index * maxNeighbors;
    let count = 0;

    if (hasEast) {
      indexes[offset + count] = index + 1;
      count += 1;
    }
    if (hasWest) {
      indexes[offset + count] = index - 1;
      count += 1;
    }
    if (hasSouth) {
      indexes[offset + count] = index + roomSize;
      count += 1;
    }
    if (hasNorth) {
      indexes[offset + count] = index - roomSize;
      count += 1;
    }
    if (hasEast && hasSouth) {
      indexes[offset + count] = index + roomSize + 1;
      count += 1;
    }
    if (hasEast && hasNorth) {
      indexes[offset + count] = index - roomSize + 1;
      count += 1;
    }
    if (hasWest && hasSouth) {
      indexes[offset + count] = index + roomSize - 1;
      count += 1;
    }
    if (hasWest && hasNorth) {
      indexes[offset + count] = index - roomSize - 1;
      count += 1;
    }

    counts[index] = count;
  }

  return {
    neighborCounts: counts,
    neighborIndexes: indexes
  };
}

function createInteriorTiles(): Uint8Array {
  const tiles = new Uint8Array(roomArea);

  for (let y = 1; y < roomSize - 1; y += 1) {
    const rowOffset = y * roomSize;
    for (let x = 1; x < roomSize - 1; x += 1) {
      tiles[rowOffset + x] = 1;
    }
  }

  return tiles;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
