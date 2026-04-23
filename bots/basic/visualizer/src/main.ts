import type {
  RoomPlanningCandidate,
  RoomPlanningLayer,
  RoomPlanningVisualization,
  RoomPlanningVisualizationStep
} from "../../src/planning/room-planning-visualization.ts";
import type { RoomPlanningPolicy, RoomPlanningRoomData } from "../../src/planning/room-plan.ts";
import { compareStructureDrawOrder, renderPlannedStructureSvg } from "../../src/planning/structure-svg.ts";
import type { PlannedStructurePlacement } from "../../src/planning/structure-layout.ts";
import { loadBrowserPlanningFixture, type BrowserPlanningFixture } from "./fixture.ts";
import type { PlannerWorkerRequest, PlannerWorkerResponse } from "./planner-worker.ts";
import "./styles.css";

const roomSize = 50;
const terrainMaskWall = 1;
const terrainMaskSwamp = 2;

type AppState = {
  fixture: BrowserPlanningFixture | null;
  room: RoomPlanningRoomData | null;
  visualization: RoomPlanningVisualization | null;
  activeStepIndex: number;
  layerVisibility: Map<string, boolean>;
  hoveredCandidateId: string | null;
  loading: boolean;
  error: string | null;
};

const state: AppState = {
  fixture: null,
  room: null,
  visualization: null,
  activeStepIndex: 0,
  layerVisibility: new Map(),
  hoveredCandidateId: null,
  loading: false,
  error: null
};

const worker = new Worker(new URL("./planner-worker.ts", import.meta.url), { type: "module" });

const roomSelect = getElement<HTMLSelectElement>("room-select");
const policySelect = getElement<HTMLSelectElement>("policy-select");
const topKSelect = getElement<HTMLSelectElement>("top-k-select");
const previousButton = getElement<HTMLButtonElement>("previous-step");
const nextButton = getElement<HTMLButtonElement>("next-step");
const statusText = getElement<HTMLElement>("status-text");
const roomFacts = getElement<HTMLElement>("room-facts");
const roomSvg = getElement<SVGSVGElement>("room-svg");
const tileInspector = getElement<HTMLElement>("tile-inspector");
const stepTimeline = getElement<HTMLElement>("step-timeline");
const stepTitle = getElement<HTMLElement>("step-title");
const stepSummary = getElement<HTMLElement>("step-summary");
const stepMetrics = getElement<HTMLElement>("step-metrics");
const candidateList = getElement<HTMLElement>("candidate-list");
const layerList = getElement<HTMLElement>("layer-list");
const validationList = getElement<HTMLElement>("validation-list");

worker.addEventListener("message", (event: MessageEvent<PlannerWorkerResponse>) => {
  state.loading = false;
  if (!event.data.ok) {
    state.visualization = null;
    state.error = event.data.error;
    render();
    return;
  }

  state.visualization = event.data.visualization;
  state.activeStepIndex = getDefaultStepIndex(event.data.visualization);
  state.layerVisibility = new Map();
  state.hoveredCandidateId = null;
  state.error = null;
  state.room = state.fixture?.map.getRoom(event.data.visualization.roomName) ?? null;
  render();
});

roomSelect.addEventListener("change", () => {
  state.room = state.fixture?.map.getRoom(roomSelect.value) ?? null;
  requestPlan();
});

policySelect.addEventListener("change", () => {
  requestPlan();
});

topKSelect.addEventListener("change", () => {
  requestPlan();
});

previousButton.addEventListener("click", () => {
  if (!state.visualization) {
    return;
  }
  state.activeStepIndex = Math.max(0, state.activeStepIndex - 1);
  state.hoveredCandidateId = null;
  render();
});

nextButton.addEventListener("click", () => {
  if (!state.visualization) {
    return;
  }
  state.activeStepIndex = Math.min(state.visualization.steps.length - 1, state.activeStepIndex + 1);
  state.hoveredCandidateId = null;
  render();
});

roomSvg.addEventListener("mousemove", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const tileElement = target.closest("[data-tile]");
  const rawTile = tileElement?.getAttribute("data-tile");
  if (rawTile === null || rawTile === undefined) {
    return;
  }
  renderTileInspector(Number(rawTile));
});

roomSvg.addEventListener("mouseleave", () => {
  renderTileInspector(null);
});

layerList.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  const layerId = target.dataset.layerId;
  if (!layerId) {
    return;
  }
  state.layerVisibility.set(layerId, target.checked);
  renderRoomSvg();
});

void init();

async function init(): Promise<void> {
  try {
    setLoading("Loading bundled room fixture");
    const fixture = await loadBrowserPlanningFixture();
    state.fixture = fixture;
    roomSelect.innerHTML = fixture.candidateRooms
      .map((roomName) => `<option value="${escapeAttr(roomName)}">${escapeHtml(roomName)}</option>`)
      .join("");
    roomSelect.value = fixture.candidateRooms[0] ?? "";
    state.room = fixture.map.getRoom(roomSelect.value);
    requestPlan();
  } catch (error) {
    state.loading = false;
    state.error = error instanceof Error ? error.stack ?? error.message : String(error);
    render();
  }
}

function requestPlan(): void {
  const roomName = roomSelect.value;
  const policy = policySelect.value as RoomPlanningPolicy;
  const topK = parseTopK(topKSelect.value);
  state.room = state.fixture?.map.getRoom(roomName) ?? null;
  state.loading = true;
  state.error = null;
  state.visualization = null;
  render();

  const request: PlannerWorkerRequest = {
    roomName,
    policy,
    topK: Number.isFinite(topK) ? topK : undefined
  };
  worker.postMessage(request);
}

function parseTopK(value: string): number | undefined {
  if (value === "") {
    return undefined;
  }
  const topK = Number(value);
  return Number.isFinite(topK) ? topK : undefined;
}

function render(): void {
  renderStatus();
  renderRoomFacts();
  renderTimeline();
  renderStepInspector();
  renderValidationList();
  renderRoomSvg();
}

function renderStatus(): void {
  roomSelect.disabled = state.loading || state.fixture === null;
  policySelect.disabled = state.loading;
  topKSelect.disabled = state.loading;

  if (state.loading) {
    statusText.textContent = "Planning...";
    return;
  }
  if (state.error) {
    statusText.textContent = "Plan failed";
    return;
  }
  if (state.visualization) {
    statusText.textContent = state.visualization.error
      ? `${state.visualization.roomName} / ${state.visualization.policy} / incomplete`
      : `${state.visualization.roomName} / ${state.visualization.policy}`;
    return;
  }
  statusText.textContent = "Ready";
}

function getDefaultStepIndex(visualization: RoomPlanningVisualization): number {
  const errorIndex = visualization.steps.findIndex((step) => step.status === "error");
  if (errorIndex >= 0) {
    return errorIndex;
  }
  for (let index = visualization.steps.length - 1; index >= 0; index -= 1) {
    if (visualization.steps[index]?.status === "complete") {
      return index;
    }
  }
  return 0;
}

function renderRoomFacts(): void {
  const room = state.room;
  if (!room) {
    roomFacts.innerHTML = "";
    return;
  }
  const counts = countObjects(room);
  const plainCount = countTerrain(room, "plain");
  const swampCount = countTerrain(room, "swamp");
  const wallCount = countTerrain(room, "wall");
  roomFacts.innerHTML = [
    fact("Room", room.roomName),
    fact("Sources", String(counts.source ?? 0)),
    fact("Minerals", String(counts.mineral ?? 0)),
    fact("Controller", String(counts.controller ?? 0)),
    fact("Plain", String(plainCount)),
    fact("Swamp", String(swampCount)),
    fact("Wall", String(wallCount))
  ].join("");
}

function renderTimeline(): void {
  const visualization = state.visualization;
  if (!visualization) {
    stepTimeline.innerHTML = "";
    previousButton.disabled = true;
    nextButton.disabled = true;
    return;
  }

  previousButton.disabled = state.loading || state.activeStepIndex === 0;
  nextButton.disabled = state.loading || state.activeStepIndex >= visualization.steps.length - 1;
  stepTimeline.innerHTML = visualization.steps.map((step, index) => `
    <button class="step-button ${index === state.activeStepIndex ? "active" : ""} ${step.status}" data-step-index="${index}">
      <span>${index + 1}</span>
      ${escapeHtml(step.title)}
    </button>
  `).join("");

  for (const button of stepTimeline.querySelectorAll<HTMLButtonElement>("[data-step-index]")) {
    button.addEventListener("click", () => {
      state.activeStepIndex = Number(button.dataset.stepIndex ?? "0");
      state.hoveredCandidateId = null;
      render();
    });
  }

  const activeButton = stepTimeline.querySelector<HTMLButtonElement>(".step-button.active");
  activeButton?.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "center"
  });
}

function renderStepInspector(): void {
  const step = getActiveStep();
  if (!step) {
    stepTitle.textContent = state.error ? "Planner error" : "No plan";
    stepSummary.textContent = state.error ?? "";
    stepMetrics.innerHTML = "";
    candidateList.innerHTML = "";
    layerList.innerHTML = "";
    return;
  }

  stepTitle.textContent = step.title;
  stepSummary.textContent = step.summary;
  stepMetrics.innerHTML = step.metrics.map((metricItem) => `
    <div class="metric ${metricItem.tone ?? "neutral"}">
      <span>${escapeHtml(metricItem.label)}</span>
      <strong>${escapeHtml(String(metricItem.value))}</strong>
    </div>
  `).join("");

  candidateList.innerHTML = step.candidates.length === 0
    ? `<div class="empty">No candidate list for this stage</div>`
    : step.candidates.map(renderCandidate).join("");
  for (const row of candidateList.querySelectorAll<HTMLElement>("[data-candidate-id]")) {
    row.addEventListener("mouseenter", () => {
      state.hoveredCandidateId = row.dataset.candidateId ?? null;
      renderRoomSvg();
    });
    row.addEventListener("mouseleave", () => {
      state.hoveredCandidateId = null;
      renderRoomSvg();
    });
  }

  layerList.innerHTML = step.layers.map((layer) => {
    const checked = isLayerVisible(layer);
    return `
      <label class="layer-toggle">
        <input type="checkbox" data-layer-id="${escapeAttr(layer.id)}" ${checked ? "checked" : ""}>
        <span>${escapeHtml(layer.title)}</span>
        <small>${layer.tiles.length}</small>
      </label>
    `;
  }).join("");
}

function renderValidationList(): void {
  const visualization = state.visualization;
  if (!visualization) {
    validationList.innerHTML = state.error
      ? `<div class="validation-error">${escapeHtml(state.error)}</div>`
      : "";
    return;
  }
  validationList.innerHTML = visualization.validations.length === 0
    ? `<div class="validation-ok">All planner validations passed</div>`
    : visualization.validations.map((error) => `<div class="validation-error">${escapeHtml(error)}</div>`).join("");
}

function renderRoomSvg(): void {
  const room = state.room;
  const visualization = state.visualization;
  const step = getActiveStep();
  if (!room) {
    roomSvg.innerHTML = "";
    return;
  }

  const parts: string[] = [];
  parts.push(renderTerrain(room));
  if (visualization && step) {
    parts.push(renderLayers(step, visualization));
    parts.push(renderCandidateHighlight(step));
  }
  parts.push(renderObjects(room));
  if (visualization && step) {
    parts.push(renderStructureGlyphs(step, visualization));
    parts.push(renderCreepGlyphs(step));
  }
  roomSvg.innerHTML = parts.join("");
}

function renderTerrain(room: RoomPlanningRoomData): string {
  const parts: string[] = [];
  for (let y = 0; y < roomSize; y += 1) {
    for (let x = 0; x < roomSize; x += 1) {
      const tile = toIndex(x, y);
      const code = terrainCode(room, tile);
      const terrainClass = (code & terrainMaskWall) !== 0
        ? "terrain-wall"
        : (code & terrainMaskSwamp) !== 0
          ? "terrain-swamp"
          : "terrain-plain";
      parts.push(`<rect class="tile ${terrainClass}" data-tile="${tile}" x="${x}" y="${y}" width="1" height="1"></rect>`);
    }
  }
  return parts.join("");
}

function renderLayers(step: RoomPlanningVisualizationStep, visualization: RoomPlanningVisualization): string {
  const parts: string[] = [];
  for (const layer of step.layers) {
    if (!isLayerVisible(layer)) {
      continue;
    }
    if (layer.kind === "heatmap") {
      parts.push(renderHeatmapLayer(layer));
      continue;
    }
    if (layer.kind === "creep") {
      continue;
    }
    if (rendersAsStructureSvg(layer) && visualization.plan.structurePlan) {
      continue;
    }
    const className = `overlay overlay-${layer.kind} tone-${layer.tone ?? "selected"}`;
    for (const tile of layer.tiles) {
      const coord = fromIndex(tile);
      parts.push(`<rect class="${className}" data-tile="${tile}" x="${coord.x}" y="${coord.y}" width="1" height="1"></rect>`);
    }
  }

  return parts.join("");
}

function renderHeatmapLayer(layer: RoomPlanningLayer): string {
  const values = layer.values ?? {};
  const maxValue = Math.max(1, ...Object.values(values));
  return layer.tiles.map((tile) => {
    const coord = fromIndex(tile);
    const value = values[tile] ?? 0;
    const intensity = Math.max(0.18, Math.min(0.85, value / maxValue));
    return `<rect class="overlay overlay-heatmap" data-tile="${tile}" x="${coord.x}" y="${coord.y}" width="1" height="1" style="opacity:${intensity.toFixed(3)}"></rect>`;
  }).join("");
}

function renderObjects(room: RoomPlanningRoomData): string {
  return room.objects
    .filter((object) => object.type === "source" || object.type === "controller" || object.type === "mineral")
    .map((object) => {
      const tile = toIndex(object.x, object.y);
      const label = object.type === "source" ? "S" : object.type === "controller" ? "C" : "M";
      return `
        <circle class="object object-${escapeAttr(object.type)}" data-tile="${tile}" cx="${object.x + 0.5}" cy="${object.y + 0.5}" r="0.38"></circle>
        <text class="object-label" x="${object.x + 0.5}" y="${object.y + 0.66}">${label}</text>
      `;
    }).join("");
}

function renderStructureGlyphs(step: RoomPlanningVisualizationStep, visualization: RoomPlanningVisualization): string {
  const structures = visualization.plan.structurePlan?.structures;
  if (!structures) {
    return "";
  }
  const selected = new Map<string, PlannedStructurePlacement>();
  for (const layer of step.layers) {
    if (!isLayerVisible(layer) || !rendersAsStructureSvg(layer)) {
      continue;
    }
    for (const structure of structures) {
      if (structureMatchesLayer(structure, layer)) {
        selected.set(structureKey(structure), structure);
      }
    }
  }

  return [...selected.values()]
    .sort(compareStructureDrawOrder)
    .map((structure) => renderPlannedStructureSvg(structure, "structure-base"))
    .join("");
}

function renderCreepGlyphs(step: RoomPlanningVisualizationStep): string {
  const selectedTiles = new Set<number>();
  for (const layer of step.layers) {
    if (!isLayerVisible(layer) || layer.kind !== "creep") {
      continue;
    }
    for (const tile of layer.tiles) {
      selectedTiles.add(tile);
    }
  }

  return [...selectedTiles].map((tile) => {
    const coord = fromIndex(tile);
    const centerX = coord.x + 0.5;
    const centerY = coord.y + 0.5;
    return `
      <g class="creep-marker" data-tile="${tile}">
        <circle class="creep-marker-body" cx="${centerX}" cy="${centerY}" r="0.28"></circle>
        <line class="creep-marker-cross" x1="${centerX - 0.14}" y1="${centerY}" x2="${centerX + 0.14}" y2="${centerY}"></line>
        <line class="creep-marker-cross" x1="${centerX}" y1="${centerY - 0.14}" x2="${centerX}" y2="${centerY + 0.14}"></line>
      </g>
    `;
  }).join("");
}

function rendersAsStructureSvg(layer: RoomPlanningLayer): boolean {
  return layer.kind === "stamp"
    || layer.kind === "path"
    || layer.kind === "road"
    || layer.kind === "rampart"
    || layer.kind === "structure";
}

function structureMatchesLayer(structure: PlannedStructurePlacement, layer: RoomPlanningLayer): boolean {
  if (!layer.tiles.includes(structure.tile)) {
    return false;
  }

  switch (layer.kind) {
    case "path":
    case "road":
      return structure.type === "road";
    case "rampart":
      return structure.type === "rampart";
    case "stamp":
      return structure.type !== "road" && structure.type !== "rampart";
    case "structure":
      return structureMatchesStructureLayer(structure, layer);
    case "creep":
    case "candidate":
    case "region":
    case "heatmap":
      return false;
  }
}

function structureMatchesStructureLayer(structure: PlannedStructurePlacement, layer: RoomPlanningLayer): boolean {
  switch (layer.id) {
    case "source-sink-structures":
      return structure.label.startsWith("source")
        || structure.label.startsWith("controller")
        || structure.label.startsWith("mineral");
    case "pre-rampart-structures":
      return structure.type === "extension";
    case "towers":
      return structure.type === "tower";
    case "remaining-structures":
      return structure.type === "nuker" || structure.type === "observer";
    case "final-structures":
      return true;
    default:
      return true;
  }
}

function structureKey(structure: PlannedStructurePlacement): string {
  return `${structure.type}:${structure.tile}:${structure.label}:${structure.rcl}:${structure.removeAtRcl ?? ""}`;
}

function renderCandidateHighlight(step: RoomPlanningVisualizationStep): string {
  if (!state.hoveredCandidateId) {
    return "";
  }
  const candidate = step.candidates.find((item) => item.id === state.hoveredCandidateId);
  if (!candidate) {
    return "";
  }
  return candidate.tiles.map((tile) => {
    const coord = fromIndex(tile);
    return `<rect class="candidate-highlight" data-tile="${tile}" x="${coord.x}" y="${coord.y}" width="1" height="1"></rect>`;
  }).join("");
}

function renderCandidate(candidate: RoomPlanningCandidate): string {
  return `
    <div class="candidate-row ${candidate.selected ? "selected" : ""}" data-candidate-id="${escapeAttr(candidate.id)}">
      <div class="candidate-title">
        <strong>#${candidate.rank} ${escapeHtml(candidate.label)}</strong>
        <span>${candidate.selected ? "selected" : escapeHtml(formatCoord(candidate.anchor))}</span>
      </div>
      <div class="candidate-metrics">
        ${candidate.metrics.map((metricItem) => `
          <span>${escapeHtml(metricItem.label)} <b>${escapeHtml(String(metricItem.value))}</b></span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderTileInspector(tile: number | null): void {
  if (tile === null || !state.room) {
    tileInspector.textContent = "Hover a tile";
    return;
  }

  const coord = fromIndex(tile);
  const terrain = describeTerrain(state.room, tile);
  const object = state.room.objects.find((item) => item.x === coord.x && item.y === coord.y);
  const structures = state.visualization?.plan.structurePlan?.structures
    .filter((structure) => structure.tile === tile)
    .map((structure) => structure.type)
    .join(", ");
  tileInspector.textContent = [
    `${coord.x},${coord.y}`,
    terrain,
    object ? object.type : null,
    structures ? `structures: ${structures}` : null
  ].filter((item): item is string => item !== null).join(" | ");
}

function getActiveStep(): RoomPlanningVisualizationStep | null {
  return state.visualization?.steps[state.activeStepIndex] ?? null;
}

function isLayerVisible(layer: RoomPlanningLayer): boolean {
  return state.layerVisibility.get(layer.id) ?? layer.visibleByDefault;
}

function setLoading(message: string): void {
  state.loading = true;
  statusText.textContent = message;
}

function fact(label: string, value: string): string {
  return `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function countObjects(room: RoomPlanningRoomData): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const object of room.objects) {
    counts[object.type] = (counts[object.type] ?? 0) + 1;
  }
  return counts;
}

function countTerrain(room: RoomPlanningRoomData, kind: "plain" | "swamp" | "wall"): number {
  let count = 0;
  for (let tile = 0; tile < roomSize * roomSize; tile += 1) {
    const code = terrainCode(room, tile);
    if (kind === "wall" && (code & terrainMaskWall) !== 0) {
      count += 1;
    } else if (kind === "swamp" && (code & terrainMaskWall) === 0 && (code & terrainMaskSwamp) !== 0) {
      count += 1;
    } else if (kind === "plain" && code === 0) {
      count += 1;
    }
  }
  return count;
}

function describeTerrain(room: RoomPlanningRoomData, tile: number): string {
  const code = terrainCode(room, tile);
  if ((code & terrainMaskWall) !== 0) {
    return "wall";
  }
  if ((code & terrainMaskSwamp) !== 0) {
    return "swamp";
  }
  return "plain";
}

function terrainCode(room: RoomPlanningRoomData, tile: number): number {
  return room.terrain.charCodeAt(tile) - 48;
}

function toIndex(x: number, y: number): number {
  return y * roomSize + x;
}

function fromIndex(index: number): { x: number; y: number } {
  return {
    x: index % roomSize,
    y: Math.floor(index / roomSize)
  };
}

function formatCoord(coord: { x: number; y: number }): string {
  return `${coord.x},${coord.y}`;
}

function getElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id}.`);
  }
  return element as unknown as T;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
