import { deflateSync } from "node:zlib";

type PngInput = {
  width: number;
  height: number;
  rgba: Buffer | Uint8Array;
};

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let crcTable: Uint32Array | null = null;

export function encodePng(input: PngInput): Buffer {
  if (!Number.isInteger(input.width) || input.width <= 0) {
    throw new Error(`PNG width must be a positive integer, received ${input.width}.`);
  }
  if (!Number.isInteger(input.height) || input.height <= 0) {
    throw new Error(`PNG height must be a positive integer, received ${input.height}.`);
  }

  const expectedLength = input.width * input.height * 4;
  if (input.rgba.byteLength !== expectedLength) {
    throw new Error(`PNG RGBA buffer length ${input.rgba.byteLength} does not match ${input.width}x${input.height}.`);
  }

  const bytesPerRow = input.width * 4;
  const raw = Buffer.alloc(input.height * (bytesPerRow + 1));
  const source = Buffer.isBuffer(input.rgba)
    ? input.rgba
    : Buffer.from(input.rgba.buffer, input.rgba.byteOffset, input.rgba.byteLength);

  for (let y = 0; y < input.height; y += 1) {
    const rawRowStart = y * (bytesPerRow + 1);
    raw[rawRowStart] = 0;
    source.copy(raw, rawRowStart + 1, y * bytesPerRow, (y + 1) * bytesPerRow);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(input.width, 0);
  ihdr.writeUInt32BE(input.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    pngSignature,
    createChunk("IHDR", ihdr),
    createChunk("IDAT", deflateSync(raw)),
    createChunk("IEND", Buffer.alloc(0))
  ]);
}

function createChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  if (typeBuffer.length !== 4) {
    throw new Error(`PNG chunk type must be exactly four bytes, received '${type}'.`);
  }

  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer: Buffer): number {
  const table = getCrcTable();
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function getCrcTable(): Uint32Array {
  if (crcTable !== null) {
    return crcTable;
  }

  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }

  crcTable = table;
  return table;
}
