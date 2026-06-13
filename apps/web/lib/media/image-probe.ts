// Dependency-free image probing: sniff the real MIME type and pixel dimensions
// from the file header bytes. Avoids a hard `sharp`/`image-size` dependency so the
// upload path works on a bare install; Phase 2 can layer sharp-based renditions on
// top when it is present. Supports the formats the storefront accepts: PNG, JPEG,
// GIF, WebP. Returns nulls for dimensions it cannot determine rather than throwing.

export type ProbedImage = {
  mimeType: string | null;
  width: number | null;
  height: number | null;
};

function readPng(buf: Buffer): ProbedImage | null {
  // 89 50 4E 47 0D 0A 1A 0A, then IHDR at offset 16: width(4) height(4) BE
  if (buf.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => buf[i] === b)) return null;
  return { mimeType: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readGif(buf: Buffer): ProbedImage | null {
  // "GIF87a"/"GIF89a", then width(2) height(2) little-endian
  if (buf.length < 10) return null;
  if (buf.toString("ascii", 0, 3) !== "GIF") return null;
  return { mimeType: "image/gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function readWebp(buf: Buffer): ProbedImage | null {
  // RIFF....WEBP
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const format = buf.toString("ascii", 12, 16);
  try {
    if (format === "VP8 ") {
      // lossy: dimensions at offset 26 (14-bit each, little-endian)
      const w = buf.readUInt16LE(26) & 0x3fff;
      const h = buf.readUInt16LE(28) & 0x3fff;
      return { mimeType: "image/webp", width: w, height: h };
    }
    if (format === "VP8L") {
      // lossless: 1-bit signature then 14-bit width-1, 14-bit height-1
      const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { mimeType: "image/webp", width, height };
    }
    if (format === "VP8X") {
      // extended: 24-bit width-1, 24-bit height-1 at offset 24
      const width = 1 + ((buf[24]) | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + ((buf[27]) | (buf[28] << 8) | (buf[29] << 16));
      return { mimeType: "image/webp", width, height };
    }
  } catch {
    return { mimeType: "image/webp", width: null, height: null };
  }
  return { mimeType: "image/webp", width: null, height: null };
}

function readJpeg(buf: Buffer): ProbedImage | null {
  // FF D8 ... walk segments to the SOF marker for dimensions
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    // SOF0..SOF15 (excluding DHT/JPG/DAC markers c4/c8/cc) carry dimensions
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { mimeType: "image/jpeg", width, height };
    }
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (segmentLength < 2) break;
    offset += 2 + segmentLength;
  }
  return { mimeType: "image/jpeg", width: null, height: null };
}

/** Probe an image buffer for its true MIME type and dimensions. Never throws. */
export function probeImage(buffer: Buffer): ProbedImage {
  return (
    readPng(buffer) ??
    readJpeg(buffer) ??
    readGif(buffer) ??
    readWebp(buffer) ?? { mimeType: null, width: null, height: null }
  );
}
