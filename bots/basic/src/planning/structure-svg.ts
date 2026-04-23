import type { PlannedStructurePlacement, PlannedStructureType } from "./structure-layout.ts";

export function renderPlannedStructureSvg(structure: PlannedStructurePlacement, className = "structure-base"): string {
  const x = structure.x + 0.5;
  const y = structure.y + 0.5;
  const title = `${structure.type} ${structure.label} @ ${structure.x},${structure.y} RCL${structure.rcl}${structure.removeAtRcl ? ` remove RCL${structure.removeAtRcl}` : ""}`;
  return `<g class="${escapeHtml(className)} structure-${escapeHtml(structure.type)}" data-tile="${structure.tile}">
    <title>${escapeHtml(title)}</title>
    ${renderStructureSvgBody(x, y, structure.type)}
  </g>`;
}

export function renderStructureSvgBody(x: number, y: number, type: PlannedStructureType): string {
  const dark = "#181818";
  const gray = "#555555";
  const light = "#AAAAAA";
  const outline = "#8FBB93";
  const road = "#666666";

  switch (type) {
    case "road":
      return `<circle cx="${x}" cy="${y}" r="0.24" fill="${road}" opacity="0.82"></circle>`;
    case "rampart":
      return `<rect x="${x - 0.46}" y="${y - 0.46}" width="0.92" height="0.92" rx="0.16" fill="#16a34a" opacity="0.36" stroke="#86efac" stroke-opacity="0.78" stroke-width="0.06"></rect>`;
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

export function compareStructureDrawOrder(left: PlannedStructurePlacement, right: PlannedStructurePlacement): number {
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
    case "container":
    case "extractor":
      return 1;
    case "extension":
      return 2;
    case "link":
      return 3;
    case "tower":
      return 4;
    case "spawn":
    case "storage":
    case "terminal":
    case "lab":
    case "factory":
    case "powerSpawn":
      return 5;
    case "nuker":
    case "observer":
      return 6;
    case "rampart":
      return 7;
  }
}

function points(x: number, y: number, offsets: Array<[number, number]>): string {
  return offsets.map(([dx, dy]) => `${formatCoord(x + dx)},${formatCoord(y + dy)}`).join(" ");
}

function formatCoord(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
