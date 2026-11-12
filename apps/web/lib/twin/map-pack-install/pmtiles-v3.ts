// PMTiles v3 encoding for writing a regional extract (BI-43BBCC26).
//
// The pinned reader (pmtiles@4.5.0, tool evaluation 2026-09-25) only reads
// archives. Writing needs the inverse of its header and directory parsing,
// which the open v3 specification fixes exactly:
// https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
// Header: 127 bytes, little-endian. Directory: varint entry count, then
// delta-encoded tile ids, run lengths, lengths and offsets (offset + 1, or 0
// when it follows the previous entry's bytes), compressed as a whole.

import { gunzipSync, gzipSync } from "node:zlib";

export const HEADER_BYTES = 127;
/** The header and root directory must fit in the first 16 KiB (spec §3). */
export const ROOT_BUDGET_BYTES = 16_384 - HEADER_BYTES;

export const COMPRESSION_NONE = 1;
export const COMPRESSION_GZIP = 2;

export type DirEntry = { tileId: number; offset: number; length: number; runLength: number };

export type HeaderFields = {
  rootDirectoryOffset: number;
  rootDirectoryLength: number;
  jsonMetadataOffset: number;
  jsonMetadataLength: number;
  leafDirectoryOffset: number;
  leafDirectoryLength: number;
  tileDataOffset: number;
  tileDataLength: number;
  numAddressedTiles: number;
  numTileEntries: number;
  numTileContents: number;
  clustered: boolean;
  internalCompression: number;
  tileCompression: number;
  tileType: number;
  minZoom: number;
  maxZoom: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  centerZoom: number;
  centerLon: number;
  centerLat: number;
};

export function writeVarint(out: number[], value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`varint out of range: ${value}`);
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

export function readVarint(buf: Uint8Array, pos: { i: number }): number {
  let value = 0;
  let scale = 1;
  for (;;) {
    if (pos.i >= buf.length) throw new RangeError("truncated varint");
    const byte = buf[pos.i++]!;
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return value;
    scale *= 0x80;
    if (scale > 2 ** 56) throw new RangeError("varint too long");
  }
}

export function decompress(bytes: Uint8Array, compression: number): Uint8Array {
  if (compression === COMPRESSION_NONE) return bytes;
  if (compression === COMPRESSION_GZIP) return new Uint8Array(gunzipSync(bytes));
  throw new Error(`unsupported internal compression ${compression}`);
}

export function compress(bytes: Uint8Array, compression: number): Uint8Array {
  if (compression === COMPRESSION_NONE) return bytes;
  if (compression === COMPRESSION_GZIP) return new Uint8Array(gzipSync(bytes));
  throw new Error(`unsupported internal compression ${compression}`);
}

/** Uncompressed directory bytes. Entries must be sorted by tileId. */
export function serializeDirectory(entries: readonly DirEntry[]): Uint8Array {
  const out: number[] = [];
  writeVarint(out, entries.length);
  let lastId = 0;
  for (const e of entries) {
    if (e.tileId < lastId) throw new Error("directory entries must be sorted by tileId");
    writeVarint(out, e.tileId - lastId);
    lastId = e.tileId;
  }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const prev = entries[i - 1];
    if (i > 0 && prev && e.offset === prev.offset + prev.length) writeVarint(out, 0);
    else writeVarint(out, e.offset + 1);
  }
  return Uint8Array.from(out);
}

export function deserializeDirectory(bytes: Uint8Array): DirEntry[] {
  const pos = { i: 0 };
  const count = readVarint(bytes, pos);
  const entries: DirEntry[] = [];
  let lastId = 0;
  for (let i = 0; i < count; i++) {
    lastId += readVarint(bytes, pos);
    entries.push({ tileId: lastId, offset: 0, length: 0, runLength: 1 });
  }
  for (const e of entries) e.runLength = readVarint(bytes, pos);
  for (const e of entries) e.length = readVarint(bytes, pos);
  for (let i = 0; i < count; i++) {
    const v = readVarint(bytes, pos);
    const prev = entries[i - 1];
    entries[i]!.offset = v === 0 && i > 0 && prev ? prev.offset + prev.length : v - 1;
  }
  return entries;
}

function setUint64(view: DataView, at: number, value: number): void {
  view.setBigUint64(at, BigInt(value), true);
}

export function headerToBytes(h: HeaderFields): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES);
  bytes.set(new TextEncoder().encode("PMTiles"), 0);
  const v = new DataView(bytes.buffer);
  v.setUint8(7, 3);
  setUint64(v, 8, h.rootDirectoryOffset);
  setUint64(v, 16, h.rootDirectoryLength);
  setUint64(v, 24, h.jsonMetadataOffset);
  setUint64(v, 32, h.jsonMetadataLength);
  setUint64(v, 40, h.leafDirectoryOffset);
  setUint64(v, 48, h.leafDirectoryLength);
  setUint64(v, 56, h.tileDataOffset);
  setUint64(v, 64, h.tileDataLength);
  setUint64(v, 72, h.numAddressedTiles);
  setUint64(v, 80, h.numTileEntries);
  setUint64(v, 88, h.numTileContents);
  v.setUint8(96, h.clustered ? 1 : 0);
  v.setUint8(97, h.internalCompression);
  v.setUint8(98, h.tileCompression);
  v.setUint8(99, h.tileType);
  v.setUint8(100, h.minZoom);
  v.setUint8(101, h.maxZoom);
  const e7 = (deg: number) => Math.round(deg * 1e7);
  v.setInt32(102, e7(h.minLon), true);
  v.setInt32(106, e7(h.minLat), true);
  v.setInt32(110, e7(h.maxLon), true);
  v.setInt32(114, e7(h.maxLat), true);
  v.setUint8(118, h.centerZoom);
  v.setInt32(119, e7(h.centerLon), true);
  v.setInt32(123, e7(h.centerLat), true);
  return bytes;
}

/**
 * Split entries into a root directory that fits the 16 KiB budget and leaf
 * directories, the same two-level shape go-pmtiles writes. Leaf entries in
 * the root carry runLength 0 and point into the leaf section.
 */
export function buildDirectories(
  entries: readonly DirEntry[],
  internalCompression: number,
  /** Tests lower this to force leaves on a small archive. */
  rootBudget = ROOT_BUDGET_BYTES,
  firstLeafSize = 4096,
): {
  root: Uint8Array;
  leaves: Uint8Array;
} {
  const flat = compress(serializeDirectory(entries), internalCompression);
  if (flat.length <= rootBudget) return { root: flat, leaves: new Uint8Array(0) };

  for (let leafSize = firstLeafSize; ; leafSize *= 2) {
    const rootEntries: DirEntry[] = [];
    const leafParts: Uint8Array[] = [];
    let leafOffset = 0;
    for (let start = 0; start < entries.length; start += leafSize) {
      const chunk = entries.slice(start, start + leafSize);
      const bytes = compress(serializeDirectory(chunk), internalCompression);
      rootEntries.push({ tileId: chunk[0]!.tileId, offset: leafOffset, length: bytes.length, runLength: 0 });
      leafParts.push(bytes);
      leafOffset += bytes.length;
    }
    const root = compress(serializeDirectory(rootEntries), internalCompression);
    if (root.length <= rootBudget) {
      const leaves = new Uint8Array(leafOffset);
      let at = 0;
      for (const part of leafParts) {
        leaves.set(part, at);
        at += part.length;
      }
      return { root, leaves };
    }
    if (leafSize > entries.length) throw new Error("directory too large for a two-level archive");
  }
}
