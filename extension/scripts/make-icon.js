/*
 * Generates the extension icon (media/icon.png, 256×256 RGBA) with no external
 * dependencies — a tiny hand-rolled PNG encoder (zlib is built into Node).
 *
 * The mark: a dark rounded panel split down the middle, with red bars on the
 * left ("old") and green bars on the right ("new") — a compact "diff" glyph.
 *
 *   node scripts/make-icon.js
 */
const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

const SIZE = 256;
const SCALE = SIZE / 128; // scales all layout constants proportionally (128→256 = ×2)
const buf = Buffer.alloc(SIZE * SIZE * 4); // RGBA

function px(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = a;
}

function rect(x0, y0, w, h, r, g, b, a) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) px(x, y, r, g, b, a);
  }
}

// Rounded-square background (transparent corners).
const radius = Math.round(22 * SCALE);
function inRounded(x, y) {
  const min = 0;
  const max = SIZE - 1;
  const cxs = [min + radius, max - radius];
  const cys = [min + radius, max - radius];
  if (x < cxs[0] && y < cys[0]) return (x - cxs[0]) ** 2 + (y - cys[0]) ** 2 <= radius ** 2;
  if (x > cxs[1] && y < cys[0]) return (x - cxs[1]) ** 2 + (y - cys[0]) ** 2 <= radius ** 2;
  if (x < cxs[0] && y > cys[1]) return (x - cxs[0]) ** 2 + (y - cys[1]) ** 2 <= radius ** 2;
  if (x > cxs[1] && y > cys[1]) return (x - cxs[1]) ** 2 + (y - cys[1]) ** 2 <= radius ** 2;
  return true;
}
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (inRounded(x, y)) px(x, y, 0x1e, 0x1e, 0x1e, 0xff);
  }
}

// Center divider.
const divW = 2 * SCALE;
const divGap = Math.round(6 * SCALE);
rect(SIZE / 2 - SCALE, Math.round(16 * SCALE), divW, SIZE - Math.round(32 * SCALE), 0x80, 0x80, 0x80, 0xff);

// Diff bars: [yTop, height, leftColored, rightColored].
const RED = [0xf8, 0x51, 0x49];
const GREEN = [0x2e, 0xa0, 0x43];
const rows = [
  [Math.round(30 * SCALE), Math.round(12 * SCALE), true, true],  // changed
  [Math.round(52 * SCALE), Math.round(12 * SCALE), true, false],  // removed
  [Math.round(74 * SCALE), Math.round(12 * SCALE), false, true],  // added
  [Math.round(96 * SCALE), Math.round(12 * SCALE), true, true],   // changed
];
const pad = Math.round(20 * SCALE);
const half = SIZE / 2;
for (const [y, h, left, right] of rows) {
  if (left) rect(pad, y, half - pad - divGap, h, ...RED, 0xff);
  if (right) rect(half + divGap, y, half - pad - divGap, h, ...GREEN, 0xff);
}

// ---- PNG encode ----
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
// 10,11,12 = 0 (compression / filter / interlace)

// Raw scanlines, each prefixed with a filter-type byte (0 = none).
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  buf.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(__dirname, "..", "media", "icon.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
