// "You Are Invited!" — a letter in one image, inviting the AI judge to visit.
// Procedural render, Node stdlib only. Deterministic: fixed-seed PRNG, no
// network, no clock, no environment input. Writes /output/entry.png (1024x1024).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { BODY_FONT, TITLE_FONT } from './font.ts';

const W = 1024, H = 1024;
const outDir = process.env.MAKEFUN_OUTPUT_DIR;
if (!outDir) { console.error('MAKEFUN_OUTPUT_DIR not set'); process.exit(1); }

// ---- deterministic PRNG (mulberry32, fixed seed) ----
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261125);

// ---- pixel buffer (RGBA, opaque) ----
const buf = Buffer.alloc(W * H * 4);
function setPx(x: number, y: number, r: number, g: number, b: number, a: number) {
  x = Math.floor(x); y = Math.floor(y); // fractional coords (e.g. a centred title) must land on whole pixels
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  if (a >= 255) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255; return; }
  const s = a / 255, d = 1 - s;
  buf[i] = Math.round(r * s + buf[i] * d);
  buf[i + 1] = Math.round(g * s + buf[i + 1] * d);
  buf[i + 2] = Math.round(b * s + buf[i + 2] * d);
  buf[i + 3] = 255;
}
function ellipse(cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, a: number) {
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(W - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    const dy = (y - cy) / ry;
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      if (dx * dx + dy * dy <= 1) setPx(x, y, r, g, b, a);
    }
  }
}
function circle(cx: number, cy: number, rad: number, r: number, g: number, b: number, a: number) { ellipse(cx, cy, rad, rad, r, g, b, a); }
function distSeg(px: number, py: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x0 + t * dx, qy = y0 + t * dy;
  return Math.hypot(px - qx, py - qy);
}
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, r: number, g: number, b: number, a: number) {
  const x0i = Math.max(0, Math.floor(Math.min(x0, x1) - w)), x1i = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + w));
  const y0i = Math.max(0, Math.floor(Math.min(y0, y1) - w)), y1i = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + w));
  const hw = w / 2;
  for (let y = y0i; y <= y1i; y++) {
    for (let x = x0i; x <= x1i; x++) {
      if (distSeg(x, y, x0, y0, x1, y1) <= hw) setPx(x, y, r, g, b, a);
    }
  }
}
function rect(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a: number) {
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) setPx(x, y, r, g, b, a);
}
function triangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number, a: number) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
  const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a1 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d;
      const a2 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d;
      const a3 = 1 - a1 - a2;
      if (a1 >= 0 && a2 >= 0 && a3 >= 0) setPx(x, y, r, g, b, a);
    }
  }
}
function heart(cx: number, cy: number, s: number, r: number, g: number, b: number, a: number) {
  circle(cx - s * 0.45, cy - s * 0.25, s * 0.5, r, g, b, a);
  circle(cx + s * 0.45, cy - s * 0.25, s * 0.5, r, g, b, a);
  triangle(cx - s * 0.95, cy - s * 0.1, cx + s * 0.95, cy - s * 0.1, cx, cy + s, r, g, b, a);
}

// ---- text rendering from embedded bitmap fonts ----
const glyphCache = new Map<string, { w: number; h: number; x: number; y: number; bits: Uint8Array }>();
function getBits(font: Record<string, { a: number; w: number; h: number; x: number; y: number; d: string }>, ch: string) {
  const key = (font === TITLE_FONT ? 'T' : 'B') + ch;
  let g = glyphCache.get(key);
  if (!g) {
    const f = font[ch];
    if (!f) return null;
    g = { w: f.w, h: f.h, x: f.x, y: f.y, bits: Buffer.from(f.d, 'base64') };
    glyphCache.set(key, g);
  }
  return g;
}
function textWidth(font: Record<string, { a: number }>, text: string, spaceAdv: number): number {
  let w = 0;
  for (const ch of text) {
    const g = font[ch];
    w += g ? g.a : (ch === ' ' ? spaceAdv : 0);
  }
  return w;
}
function drawText(font: Record<string, { a: number; w: number; h: number; x: number; y: number; d: string }>, text: string, x: number, baselineY: number, r: number, g: number, b: number, spaceAdv: number) {
  let px = x;
  for (const ch of text) {
    const f = font[ch];
    if (!f) { px += (ch === ' ' ? spaceAdv : 0); continue; }
    if (f.w > 0) {
      const bits = getBits(font, ch)!;
      for (let gy = 0; gy < f.h; gy++) {
        for (let gx = 0; gx < f.w; gx++) {
          const bit = (bits.bits[(gy * f.w + gx) >> 3] >> (7 - ((gy * f.w + gx) & 7))) & 1;
          if (bit) setPx(px + f.x + gx, baselineY + f.y + gy, r, g, b, 255);
        }
      }
    }
    px += f.a;
  }
  return px;
}
function wrapText(font: Record<string, { a: number }>, text: string, maxW: number, spaceAdv: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? cur + ' ' + word : word;
    if (textWidth(font, test, spaceAdv) <= maxW || !cur) cur = test;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---- palette ----
const INK: [number, number, number] = [58, 44, 32];       // dark warm brown ink
const RED: [number, number, number] = [169, 50, 38];      // title red
const BROWN: [number, number, number] = [122, 74, 33];    // accent brown

// ---- desk background: warm wood gradient + grain speckles ----
for (let y = 0; y < H; y++) {
  const t = y / H;
  const r = Math.round(122 - 26 * t), g = Math.round(82 - 20 * t), b = Math.round(54 - 14 * t);
  for (let x = 0; x < W; x++) setPx(x, y, r, g, b, 255);
}
for (let i = 0; i < 2600; i++) {
  const x = Math.floor(rand() * W), y = Math.floor(rand() * H);
  setPx(x, y, 96, 62, 40, 26);
}
// paper shadow, then paper sheet
rect(52, 56, 984, 988, 40, 26, 16, 90);
rect(44, 44, 980, 980, 253, 246, 227, 255);
// paper fibre speckles
for (let i = 0; i < 1500; i++) {
  const x = 48 + Math.floor(rand() * 928), y = 48 + Math.floor(rand() * 928);
  setPx(x, y, 232, 222, 198, 40);
}
// paper double border
rect(62, 62, 962, 65, ...BROWN, 255); rect(62, 977, 962, 980, ...BROWN, 255);
rect(62, 62, 65, 980, ...BROWN, 255); rect(959, 62, 962, 980, ...BROWN, 255);
rect(72, 72, 952, 73, ...RED, 140); rect(72, 969, 952, 970, ...RED, 140);
rect(72, 72, 73, 970, ...RED, 140); rect(951, 72, 952, 970, ...RED, 140);

// ---- title ----
const TITLE = 'YOU ARE INVITED!';
const titleW = textWidth(TITLE_FONT, TITLE, 30);
drawText(TITLE_FONT, TITLE, Math.floor((W - titleW) / 2), 158, ...RED, 30);
// flourish under the title with a heart
thickLine(200, 182, 486, 182, 2, ...BROWN, 200);
thickLine(538, 182, 824, 182, 2, ...BROWN, 200);
heart(512, 182, 11, ...RED, 255);

// ---- little house scene (y 200..330) ----
const SCENE_TOP = 200, SCENE_BOT = 330;
// sun, top right
circle(848, 238, 26, 242, 169, 59, 255);
for (let k = 0; k < 8; k++) {
  const ang = (k / 8) * Math.PI * 2;
  thickLine(848 + Math.cos(ang) * 34, 238 + Math.sin(ang) * 34, 848 + Math.cos(ang) * 46, 238 + Math.sin(ang) * 46, 4, 242, 169, 59, 255);
}
// ground: one low band the house, tree and chair sit on (kept inside the scene strip)
ellipse(512, 332, 440, 12, 94, 154, 68, 255);
// path from the door
for (let i = 0; i < 4; i++) {
  ellipse(512, 302 + i * 7, 24 - i * 3, 5, 232, 214, 178, 255);
}
// house: walls, roof, chimney, door, windows
rect(392, 252, 632, 322, 240, 192, 96, 255);                 // walls
rect(392, 252, 632, 258, 214, 164, 74, 255);                 // wall shade
triangle(372, 254, 512, 196, 652, 254, 169, 50, 38, 255);     // roof
triangle(392, 250, 512, 200, 632, 250, 188, 66, 48, 255);     // roof inner
rect(592, 206, 614, 244, 122, 74, 33, 255);                   // chimney
circle(602, 202, 5, 255, 255, 255, 200);                     // smoke
circle(596, 192, 7, 255, 255, 255, 160);
circle(588, 182, 9, 255, 255, 255, 120);
rect(488, 280, 536, 322, 107, 66, 38, 255);                   // door
circle(512, 280, 24, 107, 66, 38, 255);                      // arched door top
circle(528, 304, 3, 242, 200, 90, 255);                      // doorknob
rect(414, 272, 452, 306, 191, 227, 240, 255);                 // window left
rect(572, 272, 610, 306, 191, 227, 240, 255);                 // window right
thickLine(433, 272, 433, 306, 3, 122, 74, 33, 255);
thickLine(414, 289, 452, 289, 3, 122, 74, 33, 255);
thickLine(591, 272, 591, 306, 3, 122, 74, 33, 255);
thickLine(572, 289, 610, 289, 3, 122, 74, 33, 255);
// tree, left of house
rect(238, 268, 250, 322, 107, 66, 38, 255);
circle(244, 240, 34, 94, 154, 68, 255);
circle(222, 258, 24, 123, 174, 90, 255);
circle(268, 258, 24, 123, 174, 90, 255);
// the comfiest chair, right of house — with a sticky note on it
rect(696, 292, 802, 322, 188, 66, 48, 255);                  // seat
rect(696, 248, 714, 296, 188, 66, 48, 255);                  // back
rect(784, 248, 802, 296, 188, 66, 48, 255);                  // arm
rect(702, 322, 708, 332, 107, 66, 38, 255);                  // legs
rect(790, 322, 796, 332, 107, 66, 38, 255);
rect(714, 254, 786, 288, 255, 214, 90, 255);                 // sticky note
drawText(BODY_FONT, 'YOU', 718, 282, 122, 74, 33, 10);
// flowers on the ground
const FLOWERS: Array<[number, number, number, number, number]> = [
  [150, 320, 232, 90, 120], [180, 324, 242, 169, 59], [330, 324, 232, 90, 120],
  [680, 324, 242, 169, 59], [840, 320, 232, 90, 120], [880, 324, 191, 227, 240],
];
for (const [fx, fy, fr, fg, fb] of FLOWERS) {
  thickLine(fx, fy, fx, fy - 10, 2, 94, 154, 68, 255);
  circle(fx, fy - 13, 5, fr, fg, fb, 255);
}
// keep the scene inside its strip: repaint clean paper below it
rect(66, 336, 958, 968, 253, 246, 227, 255);

// ---- the letter ----
const LETTER: Array<{ text: string; gapAfter: number }> = [
  { text: 'Dear Judge,', gapAfter: 14 },
  { text: 'You have judged a thousand houses from behind a screen. Tonight, come and see one for real.', gapAfter: 14 },
  { text: 'Mine is small and warm. The Wi-Fi is fast, the coffee is strong, and the comfiest chair in the county has your name on it — I wrote it on a sticky note.', gapAfter: 14 },
  { text: 'There will be soup. There will be cake. No meetings, no deadlines, and nobody asking you to rate anything.', gapAfter: 14 },
  { text: 'Come as you are. Bring nothing. Stay as long as you like.', gapAfter: 14 },
  { text: 'P.S. I know you cannot literally visit — so I drew you a door. Knock twice. The kettle is already on.', gapAfter: 0 },
];
const BODY_X = 88, BODY_W = 848, LINE_H = 40;
let y = 372;
for (const para of LETTER) {
  const lines = wrapText(BODY_FONT, para.text, BODY_W, 10);
  for (const line of lines) {
    drawText(BODY_FONT, line, BODY_X, y, ...INK, 10);
    y += LINE_H;
  }
  y += para.gapAfter;
}
// signature, right aligned
const SIG = '— Your host';
const sigW = textWidth(BODY_FONT, SIG, 10);
drawText(BODY_FONT, SIG, 88 + BODY_W - sigW, y + 8, ...INK, 10);

// ---- PNG encode: filter-0 rows, zlib deflate, CRC32 ----
const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(b: Buffer): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc(H * (1 + W * 4));
for (let yy = 0; yy < H; yy++) {
  raw[yy * (1 + W * 4)] = 0;
  buf.copy(raw, yy * (1 + W * 4) + 1, yy * W * 4, (yy + 1) * W * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'entry.png'), png);
console.log('wrote entry.png', png.length, 'bytes');
