// Generates app icons (PNG) for the PWA manifest using only Node built-ins.
// Produces a 512x512 (full + maskable) and 192x192 icon with a violet→indigo
// gradient background and a stylized "open book" mark, matching the favicon.
//
// PNG output: minimal zlib-compressed RGBA8 stream, no external deps.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(__dirname, '..', 'public');
mkdirSync(PUBLIC, { recursive: true });

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) {
  return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
}

function makeIcon(size, opts = {}) {
  const { maskable = false } = opts;
  const buf = Buffer.alloc(size * size * 4);
  const bgA = [167, 139, 250]; // accent-500
  const bgB = [79, 70, 229];   // indigo-700
  const inkBg = [10, 15, 29];
  const cx = size / 2;
  const cy = size / 2;
  // For maskable, the "safe zone" is the inner 80% — so we make the bg fill
  // the whole canvas and place the mark within the central 80%.
  const safe = maskable ? 1.0 : 0.92;
  const r = (size * safe) / 2;
  const cornerR = size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Rounded square mask (only for non-maskable; maskable fills the whole canvas)
      const dx = Math.max(0, Math.abs(x - cx) - (r - cornerR));
      const dy = Math.max(0, Math.abs(y - cy) - (r - cornerR));
      const dist = Math.sqrt(dx * dx + dy * dy);
      const inside = maskable ? true : dist <= cornerR;

      if (!inside) {
        buf[idx] = inkBg[0]; buf[idx + 1] = inkBg[1]; buf[idx + 2] = inkBg[2]; buf[idx + 3] = 0;
        continue;
      }

      // Diagonal gradient bg
      const t = (x + y) / (size * 2);
      const [br, bgC, bb] = mix(bgA, bgB, t);
      let r_ = br, g_ = bgC, b_ = bb;

      // Stylized open-book mark: two trapezoidal pages with a spine in the middle
      // Page area lives within 25%-75% of the canvas
      const px = (x - cx) / size; // -0.5..0.5
      const py = (y - cy) / size;
      const inPageBand = py > -0.18 && py < 0.18;
      const spineWidth = 0.02;
      const pageOuter = 0.28;
      const isSpine = inPageBand && Math.abs(px) < spineWidth;
      const isLeftPage = inPageBand && px > -pageOuter && px < -spineWidth && (py + 0.18) * 1.4 > -px - spineWidth;
      const isRightPage = inPageBand && px < pageOuter && px > spineWidth && (py + 0.18) * 1.4 > px - spineWidth;

      if (isSpine) {
        r_ = 245; g_ = 245; b_ = 255;
      } else if (isLeftPage || isRightPage) {
        // page coloring with slight gradient
        const pageT = Math.abs(px) / pageOuter;
        r_ = Math.round(lerp(255, 220, pageT));
        g_ = Math.round(lerp(255, 226, pageT));
        b_ = Math.round(lerp(255, 240, pageT));
      }

      // Page lines
      if ((isLeftPage || isRightPage) && Math.abs(((py + 0.18) * size) % 22 - 11) < 1.2 && Math.abs(px) > 0.05) {
        r_ = 180; g_ = 180; b_ = 210;
      }

      buf[idx] = r_;
      buf[idx + 1] = g_;
      buf[idx + 2] = b_;
      buf[idx + 3] = 255;
    }
  }

  return encodePng(size, size, buf);
}

function crc32(buf) {
  let c;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Filter byte per scanline (0 = None)
  const stride = w * 4;
  const filtered = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    filtered[y * (stride + 1)] = 0;
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(filtered);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const targets = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-512-maskable.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180, maskable: false },
];

for (const t of targets) {
  const png = makeIcon(t.size, { maskable: t.maskable });
  writeFileSync(resolve(PUBLIC, t.name), png);
  console.log(`wrote ${t.name} (${png.length} bytes)`);
}
