import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createInteractiveStampPlacementDebug,
  createStampPlacementCandidateTreeDebug,
  planRoomStamps,
  type RoomStampPlan,
  type StampPlacementInteractiveDebug
} from "../src/planning/stamp-placement.ts";
import type { RoomPlanningPolicy, RoomPlanningRoomData } from "../src/planning/room-plan.ts";
import { loadBotarena212RoomPlanningFixture } from "../test/helpers/room-planning-fixture.ts";

type PreviewConfig = {
  renderAll: boolean;
  policy: RoomPlanningPolicy;
  topK: number | null;
  roomNames: string[];
};

type PreviewObject = {
  type: "controller" | "source" | "mineral";
  x: number;
  y: number;
};

type PreviewData = {
  roomName: string;
  policy: RoomPlanningPolicy;
  topK: number;
  score: number[];
  terrain: string;
  objects: PreviewObject[];
  tree: StampPlacementInteractiveDebug["tree"];
  selectedPath: string[];
  error: string | null;
};

const roomSize = 50;
const terrainMaskWall = 1;
const terrainMaskSwamp = 2;
const controllerStampReserveRange = 3;
const sourceStampReserveRange = 2;
const edgeStampReserveRange = 2;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const fixture = loadBotarena212RoomPlanningFixture();
  const config = parseArgs(process.argv.slice(2));
  const roomNames = config.renderAll
    ? fixture.candidateRooms
    : config.roomNames.length > 0
      ? config.roomNames
      : [fixture.candidateRooms[0] ?? "E11N1"];
  const previewDir = path.join(scriptDirectory, "..", "test", "artifacts", "stamp-placement-preview");
  mkdirSync(previewDir, { recursive: true });

  for (const roomName of roomNames) {
    const room = fixture.map.getRoom(roomName);
    if (room === null) {
      throw new Error(`Fixture room '${roomName}' not found.`);
    }

    const options = config.topK === null ? {} : { topK: config.topK };
    let html: string;
    try {
      const plan = planRoomStamps(room, config.policy, options);
      const debug = createInteractiveStampPlacementDebug(room, config.policy, plan, options);
      html = renderPreviewHtml(room, config.policy, plan, debug, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureOptions = config.topK === null ? { topK: 8 } : options;
      const debug = createStampPlacementCandidateTreeDebug(room, config.policy, failureOptions);
      html = renderPreviewHtml(room, config.policy, null, debug, message);
    }
    const roomPath = path.join(previewDir, `${roomName}-${config.policy}.html`);
    writeFileSync(roomPath, html, "utf8");
    writeFileSync(path.join(previewDir, "latest.html"), html, "utf8");
    process.stdout.write(`Wrote stamp-placement preview for ${roomName} to ${roomPath}\n`);
  }

  process.stdout.write(`Preview directory: ${previewDir}\n`);
}

function parseArgs(args: string[]): PreviewConfig {
  const config: PreviewConfig = {
    renderAll: false,
    policy: "normal",
    topK: null,
    roomNames: []
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
      case "policy": {
        const value = inlineValue ?? args[index + 1];
        if (inlineValue === null) {
          index += 1;
        }
        if (value !== "normal" && value !== "temple") {
          throw new Error("--policy must be 'normal' or 'temple'.");
        }
        config.policy = value;
        break;
      }
      case "top-k":
        config.topK = readNumberFlag(key, inlineValue, args, index);
        if (inlineValue === null) {
          index += 1;
        }
        break;
      case "help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown flag '${arg}'.`);
    }
  }

  return config;
}

function renderPreviewHtml(
  room: RoomPlanningRoomData,
  policy: RoomPlanningPolicy,
  plan: RoomStampPlan | null,
  debug: StampPlacementInteractiveDebug,
  error: string | null
): string {
  const data: PreviewData = {
    roomName: room.roomName,
    policy,
    topK: plan?.topK ?? debug.topK,
    score: plan?.score ?? debug.score,
    terrain: room.terrain,
    objects: room.objects
      .filter((object): object is RoomPlanningRoomData["objects"][number] & PreviewObject => (
        object.type === "controller" || object.type === "source" || object.type === "mineral"
      ))
      .map((object) => ({
        type: object.type,
        x: object.x,
        y: object.y
      })),
    tree: debug.tree,
    selectedPath: debug.selectedPath,
    error
  };
  const scoreSummary = data.score.length > 0 ? formatScore(data.score) : "n/a";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stamp placement preview for ${escapeHtml(room.roomName)}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: #101114;
      color: #e5e7eb;
    }
    body {
      margin: 0;
      padding: 24px;
      background: #101114;
    }
    h1, h2, p {
      margin: 0 0 12px;
    }
    button {
      font: inherit;
    }
    .summary, .breadcrumb, .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 14px;
      color: #cbd5e1;
      font-size: 13px;
    }
    .error {
      border: 1px solid rgba(248, 113, 113, 0.7);
      background: rgba(127, 29, 29, 0.32);
      color: #fecaca;
      padding: 8px 10px;
      margin-bottom: 14px;
      font-size: 13px;
    }
    .breadcrumb button, .candidate-button {
      border: 1px solid #374151;
      background: #1f2937;
      color: #e5e7eb;
      padding: 5px 8px;
      cursor: pointer;
    }
    .breadcrumb button.active, .candidate-button.selected {
      border-color: #f8fafc;
      background: #2563eb;
      color: #eff6ff;
    }
    .layout {
      display: grid;
      grid-template-columns: max-content minmax(280px, 440px);
      gap: 18px;
      align-items: start;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(${roomSize}, 16px);
      gap: 1px;
      width: max-content;
      padding: 1px;
      background: #06080b;
      border: 1px solid #2f343c;
    }
    .tile {
      appearance: none;
      position: relative;
      width: 16px;
      height: 16px;
      margin: 0;
      padding: 0;
      border: 0;
      overflow: hidden;
      box-sizing: border-box;
      font-size: 8px;
      line-height: 16px;
      text-align: center;
    }
    .tile.clickable {
      cursor: pointer;
      outline: 1px solid rgba(248, 250, 252, 0.65);
    }
    .terrain-plain { background: #b6aa8d; color: #172033; }
    .terrain-swamp { background: #577a30; color: #f7fee7; }
    .terrain-wall { background: #111827; color: #94a3b8; }
    .reserved-mask {
      background-image: repeating-linear-gradient(
        -45deg,
        rgba(248, 113, 113, 0.45) 0,
        rgba(248, 113, 113, 0.45) 2px,
        rgba(127, 29, 29, 0.16) 2px,
        rgba(127, 29, 29, 0.16) 5px
      );
      box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.42);
    }
    .candidate-mask { box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.8); }
    .current-mask { background: #2563eb; color: #eff6ff; }
    .hub-mask { background: #7c3aed; color: #f5f3ff; }
    .pod1-mask { background: #0891b2; color: #ecfeff; }
    .pod2-mask { background: #16a34a; color: #f0fdf4; }
    .lab-mask { background: #ca8a04; color: #fefce8; }
    .anchor-label, .object-marker {
      position: absolute;
      padding: 0 1px;
      line-height: 8px;
      font-size: 7px;
      font-weight: 700;
    }
    .anchor-label {
      left: 1px;
      top: 1px;
      background: rgba(248, 250, 252, 0.92);
      color: #0f172a;
    }
    .object-marker {
      right: 1px;
      bottom: 1px;
      background: rgba(15, 23, 42, 0.9);
      color: #fff;
    }
    .panel {
      border: 1px solid #2f343c;
      background: #151922;
      padding: 12px;
    }
    .candidate-list {
      display: grid;
      gap: 8px;
    }
    .candidate-button {
      text-align: left;
      width: 100%;
      line-height: 1.35;
    }
    .candidate-button small {
      display: block;
      color: #a7b0bc;
      margin-top: 2px;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .swatch {
      width: 14px;
      height: 14px;
      border: 1px solid rgba(255,255,255,0.24);
    }
    .footer {
      margin-top: 18px;
      color: #94a3b8;
      font-size: 12px;
    }
    @media (max-width: 1150px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <h1>Stamp placement preview for ${escapeHtml(room.roomName)}</h1>
  <div class="summary">
    <span>policy: ${escapeHtml(policy)}</span>
    <span>topK: ${data.topK}</span>
    <span>winning score: ${escapeHtml(scoreSummary)}</span>
  </div>
  ${error === null ? "" : `<div class="error">Planner failure: ${escapeHtml(error)}</div>`}
  <div class="legend">
    <span class="legend-item"><span class="swatch terrain-plain"></span>Plain</span>
    <span class="legend-item"><span class="swatch terrain-swamp"></span>Swamp</span>
    <span class="legend-item"><span class="swatch terrain-wall"></span>Wall</span>
    <span class="legend-item"><span class="swatch reserved-mask"></span>Reserved space</span>
    <span class="legend-item"><span class="swatch candidate-mask"></span>Clickable candidates</span>
    <span class="legend-item"><span class="swatch current-mask"></span>Current stage mask</span>
  </div>
  <div id="breadcrumb" class="breadcrumb"></div>
  <div class="layout">
    <div id="grid" class="grid"></div>
    <aside class="panel">
      <h2 id="stage-title">Hub Candidates</h2>
      <p id="stage-help"></p>
      <div id="candidate-list" class="candidate-list"></div>
    </aside>
  </div>
  <p class="footer">Click a candidate mask, anchor label, or list item to lock that choice and reveal the next candidate set.</p>
  <script id="preview-data" type="application/json">${serializeJsonForScript(data)}</script>
  <script>
${clientScript()}
  </script>
</body>
</html>`;
}

function clientScript(): string {
  return String.raw`
const data = JSON.parse(document.getElementById("preview-data").textContent);
const roomSize = 50;
const terrainMaskWall = 1;
const terrainMaskSwamp = 2;
const controllerStampReserveRange = ${controllerStampReserveRange};
const sourceStampReserveRange = ${sourceStampReserveRange};
const edgeStampReserveRange = ${edgeStampReserveRange};
const stages = data.policy === "normal" ? ["hub", "pod1", "pod2", "labs", "final"] : ["hub", "pod1", "pod2", "final"];
const stageLabels = {
  hub: "Hub Candidates",
  pod1: "Pod1 Candidates",
  pod2: "Pod2 Candidates",
  labs: "Lab Candidates",
  final: "Selected Layout"
};
const state = {
  stage: "hub",
  path: []
};

const grid = document.getElementById("grid");
for (let index = 0; index < roomSize * roomSize; index += 1) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "tile";
  tile.dataset.index = String(index);
  grid.appendChild(tile);
}

render();

function render() {
  const stage = currentStage();
  document.getElementById("stage-title").textContent = stageLabels[stage];
  document.getElementById("stage-help").textContent = helpText(stage);
  renderBreadcrumb(stage);
  renderGrid(stage);
  renderCandidateList(stage);
}

function currentStage() {
  return stages[Math.min(state.path.length, stages.length - 1)];
}

function currentCandidates() {
  if (state.path.length === 0) {
    return data.tree;
  }
  const current = state.path[state.path.length - 1];
  return current ? current.children : [];
}

function selectedPlacements() {
  return state.path.map((node, index) => ({
    node,
    className: index === 0 ? "hub-mask" : index === 1 ? "pod1-mask" : index === 2 ? "pod2-mask" : "lab-mask",
    label: index === 0 ? "H" : index === 1 ? "P1" : index === 2 ? "P2" : "L"
  }));
}

function renderGrid(stage) {
  const tiles = Array.from(grid.children);
  const overlays = Array.from({ length: roomSize * roomSize }, () => ({
    classes: [],
    labels: [],
    titles: [],
    clickNode: null
  }));

  for (let index = 0; index < overlays.length; index += 1) {
    const coord = fromIndex(index);
    const reservedReason = getReservedStampTileReason(coord.x, coord.y);
    if (reservedReason !== null) {
      overlays[index].classes.push("reserved-mask");
      overlays[index].titles.push("reserved: " + reservedReason);
    }
  }

  for (const object of data.objects) {
    const index = toIndex(object.x, object.y);
    overlays[index].labels.push(object.type === "controller" ? "C" : object.type === "source" ? "S" : "M");
    overlays[index].titles.push(object.type + " " + object.x + "," + object.y);
  }

  for (const selected of selectedPlacements()) {
    for (const tile of selected.node.candidate.blockedTiles) {
      if (tile < 0 || tile >= overlays.length) continue;
      overlays[tile].classes.push(selected.className);
      overlays[tile].titles.push(selected.label + ": " + selected.node.candidate.label);
    }
    const anchorIndex = toIndex(selected.node.candidate.anchor.x, selected.node.candidate.anchor.y);
    overlays[anchorIndex].labels.push(selected.label);
  }

  if (stage !== "final") {
    for (const node of currentCandidates()) {
      for (const tile of node.candidate.blockedTiles) {
        if (tile < 0 || tile >= overlays.length) continue;
        overlays[tile].classes.push("candidate-mask");
        overlays[tile].titles.push("#" + node.candidate.rank + " " + node.candidate.label + " score " + formatScore(node.candidate.score));
        if (!overlays[tile].clickNode) overlays[tile].clickNode = node;
      }
      const anchorIndex = toIndex(node.candidate.anchor.x, node.candidate.anchor.y);
      overlays[anchorIndex].classes.push("current-mask");
      overlays[anchorIndex].labels.push(String(node.candidate.rank));
      overlays[anchorIndex].clickNode = node;
    }
  }

  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index];
    const terrainCode = data.terrain.charCodeAt(index) - 48;
    const terrainClass = (terrainCode & terrainMaskWall) !== 0
      ? "terrain-wall"
      : (terrainCode & terrainMaskSwamp) !== 0
        ? "terrain-swamp"
        : "terrain-plain";
    const overlay = overlays[index];
    tile.className = ["tile", terrainClass, ...overlay.classes, overlay.clickNode ? "clickable" : ""].join(" ");
    tile.title = [data.roomName + " " + fromIndexLabel(index), terrainLabel(terrainCode), ...overlay.titles].join("\\n");
    tile.innerHTML = overlay.labels.length > 0 ? '<span class="anchor-label">' + escapeHtml(overlay.labels.join(",")) + "</span>" : "";
    tile.onclick = overlay.clickNode ? () => chooseNode(overlay.clickNode) : null;
  }
}

function renderCandidateList(stage) {
  const list = document.getElementById("candidate-list");
  list.innerHTML = "";

  if (stage === "final") {
    const score = state.path[state.path.length - 1]?.completeScore ?? data.score;
    const item = document.createElement("p");
    item.textContent = score.length > 0 ? "Complete layout score: " + formatScore(score) : "No complete layout score.";
    list.appendChild(item);
    return;
  }

  const candidates = currentCandidates();
  if (candidates.length === 0) {
    const item = document.createElement("p");
    item.textContent = "No candidates for this stage.";
    list.appendChild(item);
    return;
  }

  for (const node of candidates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "candidate-button" + (node.selected ? " selected" : "");
    button.innerHTML = "#" + node.candidate.rank + " " + escapeHtml(node.candidate.kind)
      + " at " + node.candidate.anchor.x + "," + node.candidate.anchor.y
      + " <small>rotation " + node.candidate.rotation + " | score " + escapeHtml(formatScore(node.candidate.score)) + "</small>";
    button.onclick = () => chooseNode(node);
    list.appendChild(button);
  }
}

function renderBreadcrumb(stage) {
  const breadcrumb = document.getElementById("breadcrumb");
  breadcrumb.innerHTML = "";
  const root = document.createElement("button");
  root.type = "button";
  root.textContent = "Hub";
  root.className = stage === "hub" ? "active" : "";
  root.onclick = () => {
    state.path = [];
    render();
  };
  breadcrumb.appendChild(root);

  for (let index = 0; index < state.path.length; index += 1) {
    const node = state.path[index];
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = (index === 0 ? "Hub " : index === 1 ? "Pod1 " : index === 2 ? "Pod2 " : "Labs ") + node.candidate.rank;
    button.className = index === state.path.length - 1 && stage !== "final" ? "active" : "";
    button.onclick = () => {
      state.path = state.path.slice(0, index + 1);
      render();
    };
    breadcrumb.appendChild(button);
  }

  if (stage === "final") {
    const final = document.createElement("button");
    final.type = "button";
    final.textContent = "Final";
    final.className = "active";
    breadcrumb.appendChild(final);
  }
}

function chooseNode(node) {
  const stage = currentStage();
  if (stage === "final") return;
  state.path.push(node);
  if (node.children.length === 0) {
    while (currentStage() !== "final") {
      state.path.push({ candidate: node.candidate, children: [], completeScore: node.completeScore, selected: node.selected });
    }
  }
  render();
}

function helpText(stage) {
  if (stage === "hub") return "Click a hub anchor or mask to lock the hub and display pod1 candidates for that hub.";
  if (stage === "pod1") return "Click a pod1 candidate to recompute and display pod2 candidates around the chosen hub and pod1.";
  if (stage === "pod2") return data.policy === "normal"
    ? "Click a pod2 candidate to display lab candidates for this hub + pod pair."
    : "Click a pod2 candidate to complete the temple stamp layout.";
  if (stage === "labs") return "Click a lab candidate to complete this normal-room stamp layout.";
  return "Selected opaque masks and anchors for this complete layout.";
}

function toIndex(x, y) {
  return y * roomSize + x;
}

function fromIndex(index) {
  return {
    x: index % roomSize,
    y: Math.floor(index / roomSize)
  };
}

function fromIndexLabel(index) {
  return "(" + (index % roomSize) + "," + Math.floor(index / roomSize) + ")";
}

function getReservedStampTileReason(x, y) {
  if (x <= edgeStampReserveRange || y <= edgeStampReserveRange
    || x >= roomSize - 1 - edgeStampReserveRange || y >= roomSize - 1 - edgeStampReserveRange) {
    return "edge range " + edgeStampReserveRange;
  }

  for (const object of data.objects) {
    const objectRange = range({ x, y }, object);
    if (object.type === "controller" && objectRange <= controllerStampReserveRange) {
      return "controller range " + controllerStampReserveRange;
    }
    if (object.type === "source" && objectRange <= sourceStampReserveRange) {
      return "source range " + sourceStampReserveRange;
    }
  }

  return null;
}

function range(left, right) {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
}

function terrainLabel(code) {
  if ((code & terrainMaskWall) !== 0) return "terrain: wall";
  if ((code & terrainMaskSwamp) !== 0) return "terrain: swamp";
  return "terrain: plain";
}

function formatScore(score) {
  return "[" + score.join(", ") + "]";
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
`;
}

function formatScore(score: number[]): string {
  return `[${score.join(", ")}]`;
}

function serializeJsonForScript(input: unknown): string {
  return JSON.stringify(input)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function splitFlag(arg: string): [string, string | null] {
  const equalsIndex = arg.indexOf("=");
  if (equalsIndex === -1) {
    return [arg, null];
  }
  return [arg.slice(0, equalsIndex), arg.slice(equalsIndex + 1)];
}

function readNumberFlag(key: string, inlineValue: string | null, args: string[], index: number): number {
  const value = inlineValue ?? args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`--${key} requires a numeric value.`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${key} must be a positive integer.`);
  }
  return parsed;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function printHelp(): void {
  process.stdout.write(`Usage: node scripts/generate-stamp-placement-preview.ts [options] [room...]

Options:
  --all                 Render every fixture candidate room
  --policy <policy>     normal or temple, default normal
  --top-k <n>           Disable adaptive search and force top K
  --help                Show this help
`);
}
