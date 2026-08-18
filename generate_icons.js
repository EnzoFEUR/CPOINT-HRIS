const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Simple PNG encoder in pure Node (no external dependencies)
function createPNG(width, height, getPixel) {
  // RGBA buffer: width * height * 4 + height (1 filter byte per scanline)
  const scanlineLength = width * 4 + 1;
  const rawData = Buffer.alloc(scanlineLength * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    rawData[rowOffset] = 0; // Filter type: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y, width, height);
      const pixelOffset = rowOffset + 1 + x * 4;
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);

  // PNG Header
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(8 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const crc = crc32(buf.subarray(4, 8 + len));
  buf.writeUInt32BE(crc >>> 0, 8 + len);
  return buf;
}

// CRC32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

// Draw CP Logo Icon
function generateIconPixel(x, y, width, height, isMaskable = false) {
  const nx = x / width;
  const ny = y / height;

  // Background: Deep Slate gradient
  const bgR = Math.round(15 + ny * 15);
  const bgG = Math.round(23 + ny * 18);
  const bgB = Math.round(42 + ny * 25);

  // If not maskable, rounded rect corner radius check
  if (!isMaskable) {
    const cornerRadius = 0.22;
    const cx = nx < 0.5 ? nx : 1 - nx;
    const cy = ny < 0.5 ? ny : 1 - ny;
    if (cx < cornerRadius && cy < cornerRadius) {
      const dx = cornerRadius - cx;
      const dy = cornerRadius - cy;
      if (dx * dx + dy * dy > cornerRadius * cornerRadius) {
        return [0, 0, 0, 0]; // transparent
      }
    }
  }

  // Inner box: Center badge (nx: 0.22 - 0.78, ny: 0.22 - 0.78)
  const badgeMin = isMaskable ? 0.25 : 0.20;
  const badgeMax = isMaskable ? 0.75 : 0.80;
  const badgeRadius = 0.12;

  if (nx >= badgeMin && nx <= badgeMax && ny >= badgeMin && ny <= badgeMax) {
    const bx = nx < 0.5 ? nx - badgeMin : badgeMax - nx;
    const by = ny < 0.5 ? ny - badgeMin : badgeMax - ny;
    let inBadge = true;
    if (bx < badgeRadius && by < badgeRadius) {
      const dx = badgeRadius - bx;
      const dy = badgeRadius - by;
      if (dx * dx + dy * dy > badgeRadius * badgeRadius) {
        inBadge = false;
      }
    }

    if (inBadge) {
      // Blue-Indigo Gradient for badge
      const bProgress = (nx - badgeMin + ny - badgeMin) / ((badgeMax - badgeMin) * 2);
      const bR = Math.round(59 + bProgress * (79 - 59));
      const bG = Math.round(130 + bProgress * (70 - 130));
      const bB = Math.round(246 + bProgress * (229 - 246));

      // Draw Letter 'C' and 'P' in white
      // C: centered around nx: 0.35..0.48, ny: 0.35..0.65
      // P: centered around nx: 0.52..0.66, ny: 0.35..0.65
      const inC = isPixelInC(nx, ny, isMaskable);
      const inP = isPixelInP(nx, ny, isMaskable);

      if (inC || inP) {
        return [255, 255, 255, 255]; // Pure white text
      }

      // Small green status dot top right of badge
      const dotCenterX = isMaskable ? 0.68 : 0.72;
      const dotCenterY = isMaskable ? 0.32 : 0.28;
      const dotRadius = 0.035;
      const ddx = nx - dotCenterX;
      const ddy = ny - dotCenterY;
      if (ddx * ddx + ddy * ddy <= dotRadius * dotRadius) {
        return [16, 185, 129, 255]; // Emerald green dot
      }

      return [bR, bG, bB, 255];
    }
  }

  return [bgR, bgG, bgB, 255];
}

function isPixelInC(nx, ny, isMaskable) {
  const cx = isMaskable ? 0.40 : 0.38;
  const cy = 0.50;
  const rx = 0.085;
  const ry = 0.12;
  const thickness = 0.035;

  const dx = (nx - cx) / rx;
  const dy = (ny - cy) / ry;
  const dist = dx * dx + dy * dy;

  // Ellipse ring
  if (dist <= 1.0 && dist >= 0.35) {
    // Cut open right side for 'C'
    if (nx > cx + 0.01 && Math.abs(ny - cy) < 0.06) {
      return false;
    }
    return true;
  }
  return false;
}

function isPixelInP(nx, ny, isMaskable) {
  const px = isMaskable ? 0.57 : 0.58;
  const py = 0.50;

  // Left vertical bar of P
  if (nx >= px - 0.06 && nx <= px - 0.025 && ny >= py - 0.12 && ny <= py + 0.12) {
    return true;
  }

  // Loop of P (top half)
  const lcx = px;
  const lcy = py - 0.045;
  const lrx = 0.065;
  const lry = 0.075;
  const ldx = (nx - lcx) / lrx;
  const ldy = (ny - lcy) / lry;
  const ldist = ldx * ldx + ldy * ldy;

  if (ldist <= 1.0 && ldist >= 0.25 && nx >= px - 0.035) {
    return true;
  }

  return false;
}

// Generate all needed PNG files
const publicDir = path.join(__dirname, 'frontend', 'public');

console.log('Generating PWA PNG icons in:', publicDir);

const icon192 = createPNG(192, 192, (x, y, w, h) => generateIconPixel(x, y, w, h, false));
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), icon192);

const icon512 = createPNG(512, 512, (x, y, w, h) => generateIconPixel(x, y, w, h, false));
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), icon512);

const iconMaskable = createPNG(512, 512, (x, y, w, h) => generateIconPixel(x, y, w, h, true));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable.png'), iconMaskable);

const appleIcon = createPNG(180, 180, (x, y, w, h) => generateIconPixel(x, y, w, h, false));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleIcon);

console.log('Successfully generated all PWA PNG icons!');
