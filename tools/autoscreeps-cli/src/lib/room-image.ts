import fs from "node:fs/promises";
import path from "node:path";
import type { RunSampleRoomImage, VariantRole } from "./contracts.ts";
import { encodePng } from "./png.ts";
import type { RoomObjectRecord, RoomObjectsResponse } from "./screeps-api.ts";
import { ensureDirectory } from "./utils.ts";

type Color = readonly [number, number, number, number?];

export type RoomImageRaster = {
  width: number;
  height: number;
  scale: number;
  rgba: Buffer;
};

type RoomImageInput = {
  terrain: string;
  roomObjects: RoomObjectsResponse;
  scale?: number;
};

type RoomObjectStyle = {
  priority: number;
  fill: Color;
  shape: "tile" | "small" | "circle" | "diamond" | "outline";
};

export const defaultRoomImageScale = 12;
const roomSize = 50;

const terrainWall: Color = [0, 0, 0];
const terrainSwamp: Color = [35, 37, 19];
const terrainExit: Color = [50, 50, 50];
const terrainPlain: Color = [43, 43, 43];
const ownerPalette: readonly Color[] = [
  [85, 183, 255],
  [255, 146, 68],
  [134, 224, 126],
  [221, 120, 255],
  [255, 220, 82],
  [118, 210, 207],
  [255, 116, 141],
  [184, 202, 255]
];

const objectStyles: Record<string, RoomObjectStyle> = {
  road: { priority: 10, fill: [92, 92, 92, 230], shape: "small" },
  resource: { priority: 20, fill: [247, 214, 82], shape: "small" },
  tombstone: { priority: 20, fill: [160, 160, 160], shape: "small" },
  ruin: { priority: 20, fill: [124, 110, 101], shape: "small" },
  constructionSite: { priority: 30, fill: [255, 136, 54], shape: "outline" },
  rampart: { priority: 35, fill: [73, 188, 92, 145], shape: "tile" },
  constructedWall: { priority: 36, fill: [86, 86, 86], shape: "tile" },
  wall: { priority: 36, fill: [16, 16, 16], shape: "tile" },
  container: { priority: 40, fill: [181, 144, 96], shape: "tile" },
  extension: { priority: 40, fill: [242, 204, 78], shape: "tile" },
  extractor: { priority: 40, fill: [82, 158, 173], shape: "tile" },
  factory: { priority: 40, fill: [156, 155, 168], shape: "tile" },
  invaderCore: { priority: 40, fill: [205, 64, 78], shape: "tile" },
  keeperLair: { priority: 40, fill: [168, 74, 72], shape: "tile" },
  lab: { priority: 40, fill: [93, 189, 221], shape: "tile" },
  link: { priority: 40, fill: [86, 173, 232], shape: "tile" },
  nuker: { priority: 40, fill: [126, 116, 148], shape: "tile" },
  observer: { priority: 40, fill: [121, 185, 214], shape: "tile" },
  portal: { priority: 40, fill: [127, 89, 213], shape: "diamond" },
  powerBank: { priority: 40, fill: [219, 55, 86], shape: "tile" },
  powerSpawn: { priority: 40, fill: [218, 72, 109], shape: "tile" },
  spawn: { priority: 40, fill: [109, 216, 87], shape: "tile" },
  storage: { priority: 40, fill: [198, 159, 84], shape: "tile" },
  terminal: { priority: 40, fill: [111, 188, 178], shape: "tile" },
  tower: { priority: 40, fill: [255, 91, 91], shape: "tile" },
  controller: { priority: 50, fill: [171, 104, 255], shape: "diamond" },
  mineral: { priority: 50, fill: [79, 204, 218], shape: "diamond" },
  source: { priority: 50, fill: [255, 223, 80], shape: "circle" },
  creep: { priority: 60, fill: [236, 244, 255], shape: "circle" },
  powerCreep: { priority: 60, fill: [255, 115, 173], shape: "circle" }
};

export function renderRoomImageRaster(input: RoomImageInput): RoomImageRaster {
  const scale = input.scale ?? defaultRoomImageScale;
  if (!Number.isInteger(scale) || scale < 3) {
    throw new Error(`Room image scale must be an integer of at least 3, received ${scale}.`);
  }
  if (input.terrain.length < roomSize * roomSize) {
    throw new Error(`Room terrain must contain at least ${roomSize * roomSize} encoded tiles.`);
  }

  const width = roomSize * scale;
  const height = roomSize * scale;
  const rgba = Buffer.alloc(width * height * 4);
  const raster: RoomImageRaster = { width, height, scale, rgba };

  renderTerrain(raster, input.terrain);
  for (const object of [...input.roomObjects.objects].sort(compareRoomObjectsForRendering)) {
    drawRoomObject(raster, object, input.roomObjects.users);
  }

  return raster;
}

export function renderRoomImagePng(input: RoomImageInput): Buffer {
  const raster = renderRoomImageRaster(input);
  return encodePng(raster);
}

export async function writeRoomImageArtifact(input: {
  runDir: string;
  role: VariantRole;
  gameTime: number;
  room: string;
  terrain: string;
  roomObjects: RoomObjectsResponse;
}): Promise<RunSampleRoomImage> {
  const png = renderRoomImagePng({
    terrain: input.terrain,
    roomObjects: input.roomObjects
  });
  const relativePath = path.join(
    "room-images",
    input.role,
    `${String(input.gameTime).padStart(10, "0")}-${sanitizePathSegment(input.room)}.png`
  );
  const absolutePath = path.join(input.runDir, relativePath);
  await ensureDirectory(path.dirname(absolutePath));
  await fs.writeFile(absolutePath, png);

  return {
    room: input.room,
    path: relativePath.split(path.sep).join("/"),
    width: roomSize * defaultRoomImageScale,
    height: roomSize * defaultRoomImageScale,
    scale: defaultRoomImageScale,
    objects: input.roomObjects.objects.length
  };
}

function renderTerrain(raster: RoomImageRaster, terrain: string): void {
  for (let y = 0; y < roomSize; y += 1) {
    for (let x = 0; x < roomSize; x += 1) {
      const code = Number.parseInt(terrain.charAt(y * roomSize + x), 10);
      let color: Color;
      if ((code & 1) !== 0) {
        color = terrainWall;
      } else if ((code & 2) !== 0) {
        color = terrainSwamp;
      } else if (x === 0 || y === 0 || x === roomSize - 1 || y === roomSize - 1) {
        color = terrainExit;
      } else {
        color = terrainPlain;
      }
      fillRect(raster, x * raster.scale, y * raster.scale, raster.scale, raster.scale, color);
    }
  }
}

function drawRoomObject(
  raster: RoomImageRaster,
  object: RoomObjectRecord,
  users: RoomObjectsResponse["users"]
): void {
  const x = normalizeRoomCoordinate(object.x);
  const y = normalizeRoomCoordinate(object.y);
  if (x === null || y === null || object.type === "exit") {
    return;
  }

  const style = objectStyles[object.type] ?? { priority: 25, fill: [210, 210, 210], shape: "small" };
  const tileX = x * raster.scale;
  const tileY = y * raster.scale;
  const inset = Math.max(1, Math.floor(raster.scale / 6));
  const innerSize = Math.max(1, raster.scale - inset * 2);

  switch (style.shape) {
    case "tile":
      fillRect(raster, tileX + inset, tileY + inset, innerSize, innerSize, style.fill);
      break;
    case "small": {
      const size = Math.max(2, Math.floor(raster.scale / 2));
      const offset = Math.floor((raster.scale - size) / 2);
      fillRect(raster, tileX + offset, tileY + offset, size, size, style.fill);
      break;
    }
    case "circle":
      fillCircle(
        raster,
        tileX + Math.floor(raster.scale / 2),
        tileY + Math.floor(raster.scale / 2),
        Math.max(2, Math.floor(raster.scale / 2) - 1),
        style.fill
      );
      break;
    case "diamond":
      fillDiamond(
        raster,
        tileX + Math.floor(raster.scale / 2),
        tileY + Math.floor(raster.scale / 2),
        Math.max(2, Math.floor(raster.scale / 2) - 1),
        style.fill
      );
      break;
    case "outline":
      strokeRect(raster, tileX + inset, tileY + inset, innerSize, innerSize, style.fill);
      break;
  }

  const ownerColor = getOwnerColor(object, users);
  if (ownerColor) {
    strokeRect(raster, tileX + 1, tileY + 1, raster.scale - 2, raster.scale - 2, ownerColor);
  }
}

function compareRoomObjectsForRendering(left: RoomObjectRecord, right: RoomObjectRecord): number {
  const leftPriority = objectStyles[left.type]?.priority ?? 25;
  const rightPriority = objectStyles[right.type]?.priority ?? 25;
  return leftPriority - rightPriority
    || compareNumbers(normalizeRoomCoordinate(left.y), normalizeRoomCoordinate(right.y))
    || compareNumbers(normalizeRoomCoordinate(left.x), normalizeRoomCoordinate(right.x))
    || left.type.localeCompare(right.type)
    || getObjectIdentity(left).localeCompare(getObjectIdentity(right));
}

function compareNumbers(left: number | null, right: number | null): number {
  return (left ?? Number.POSITIVE_INFINITY) - (right ?? Number.POSITIVE_INFINITY);
}

function getObjectIdentity(object: RoomObjectRecord): string {
  const id = object._id;
  if (typeof id === "string") {
    return id;
  }
  return `${object.type}:${String(object.x)}:${String(object.y)}`;
}

function getOwnerColor(object: RoomObjectRecord, users: RoomObjectsResponse["users"]): Color | null {
  if (!object.user) {
    return null;
  }

  const ownerName = users[object.user]?.username ?? object.user;
  let hash = 0;
  for (let index = 0; index < ownerName.length; index += 1) {
    hash = ((hash << 5) - hash + ownerName.charCodeAt(index)) | 0;
  }
  return ownerPalette[Math.abs(hash) % ownerPalette.length]!;
}

function normalizeRoomCoordinate(value: unknown): number | null {
  const coordinate = Number(value);
  if (!Number.isInteger(coordinate) || coordinate < 0 || coordinate >= roomSize) {
    return null;
  }
  return coordinate;
}

function fillRect(raster: RoomImageRaster, x: number, y: number, width: number, height: number, color: Color): void {
  const xStart = clamp(x, 0, raster.width);
  const yStart = clamp(y, 0, raster.height);
  const xEnd = clamp(x + width, 0, raster.width);
  const yEnd = clamp(y + height, 0, raster.height);

  for (let yy = yStart; yy < yEnd; yy += 1) {
    for (let xx = xStart; xx < xEnd; xx += 1) {
      setPixel(raster, xx, yy, color);
    }
  }
}

function strokeRect(raster: RoomImageRaster, x: number, y: number, width: number, height: number, color: Color): void {
  fillRect(raster, x, y, width, 1, color);
  fillRect(raster, x, y + height - 1, width, 1, color);
  fillRect(raster, x, y, 1, height, color);
  fillRect(raster, x + width - 1, y, 1, height, color);
}

function fillCircle(raster: RoomImageRaster, centerX: number, centerY: number, radius: number, color: Color): void {
  const radiusSquared = radius * radius;
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radiusSquared) {
        setPixel(raster, x, y, color);
      }
    }
  }
}

function fillDiamond(raster: RoomImageRaster, centerX: number, centerY: number, radius: number, color: Color): void {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (Math.abs(x - centerX) + Math.abs(y - centerY) <= radius) {
        setPixel(raster, x, y, color);
      }
    }
  }
}

function setPixel(raster: RoomImageRaster, x: number, y: number, color: Color): void {
  if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) {
    return;
  }

  const index = (y * raster.width + x) * 4;
  const alpha = color[3] ?? 255;
  if (alpha >= 255) {
    raster.rgba[index] = color[0];
    raster.rgba[index + 1] = color[1];
    raster.rgba[index + 2] = color[2];
    raster.rgba[index + 3] = 255;
    return;
  }

  const sourceAlpha = alpha / 255;
  const inverseAlpha = 1 - sourceAlpha;
  raster.rgba[index] = Math.round(color[0] * sourceAlpha + raster.rgba[index]! * inverseAlpha);
  raster.rgba[index + 1] = Math.round(color[1] * sourceAlpha + raster.rgba[index + 1]! * inverseAlpha);
  raster.rgba[index + 2] = Math.round(color[2] * sourceAlpha + raster.rgba[index + 2]! * inverseAlpha);
  raster.rgba[index + 3] = 255;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_");
}
