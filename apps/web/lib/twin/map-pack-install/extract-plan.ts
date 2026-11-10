// Planning a regional extract from a clustered PMTiles v3 archive
// (BI-43BBCC26). Pure apart from the injected leaf reader, so the whole plan
// is unit-testable without the network. Mirrors `pmtiles extract --bbox`
// (go-pmtiles): wanted tile ids per zoom, a directory walk that reads only the
// leaves overlapping them, then a new layout with deduplicated contents.

import { zxyToTileId } from "pmtiles";

import type { DirEntry } from "./pmtiles-v3";

export type Bounds = { west: number; south: number; east: number; north: number };

/** Half-open tile-id interval [start, end). */
export type Interval = [number, number];

export const DEFAULT_MAX_ZOOM = 15;
/** Keeps planning memory and download size bounded for state-sized regions. */
export const DEFAULT_TILE_BUDGET = 4_000_000;
/** Bytes per download step; one durable job step each. */
export const CHUNK_BYTES = 32 * 1024 * 1024;
/** Gap between wanted contents that is cheaper to over-fetch than to split on. */
export const MERGE_GAP_BYTES = 256 * 1024;

function lonToX(lon: number, z: number): number {
  const n = 2 ** z;
  return Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
}

function latToY(lat: number, z: number): number {
  const n = 2 ** z;
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clamped * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return Math.min(n - 1, Math.max(0, Math.floor(y)));
}

export function tileCount(bounds: Bounds, z: number): number {
  const x = lonToX(bounds.east, z) - lonToX(bounds.west, z) + 1;
  const y = latToY(bounds.south, z) - latToY(bounds.north, z) + 1;
  return x * y;
}

/** The highest max zoom (≤ cap) whose cumulative tile count fits the budget. */
export function chooseMaxZoom(bounds: Bounds, cap = DEFAULT_MAX_ZOOM, budget = DEFAULT_TILE_BUDGET): number {
  let total = 0;
  let best = 0;
  for (let z = 0; z <= cap; z++) {
    total += tileCount(bounds, z);
    if (total > budget) break;
    best = z;
  }
  return best;
}

/** Sorted, merged tile-id intervals covering the bounds at every zoom. */
export function wantedIntervals(bounds: Bounds, minZoom: number, maxZoom: number): Interval[] {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) total += tileCount(bounds, z);
  const ids = new Float64Array(total);
  let i = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = lonToX(bounds.west, z);
    const x1 = lonToX(bounds.east, z);
    const y0 = latToY(bounds.north, z);
    const y1 = latToY(bounds.south, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) ids[i++] = zxyToTileId(z, x, y);
  }
  ids.sort();
  const out: Interval[] = [];
  for (const id of ids) {
    const last = out[out.length - 1];
    if (last && id <= last[1]) last[1] = Math.max(last[1], id + 1);
    else out.push([id, id + 1]);
  }
  return out;
}

/** First interval index whose end is after `id`. */
function firstAfter(intervals: readonly Interval[], id: number): number {
  let lo = 0;
  let hi = intervals.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (intervals[mid]![1] <= id) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The parts of [start, end) that are wanted. */
export function intersect(intervals: readonly Interval[], start: number, end: number): Interval[] {
  const out: Interval[] = [];
  for (let k = firstAfter(intervals, start); k < intervals.length; k++) {
    const [a, b] = intervals[k]!;
    if (a >= end) break;
    out.push([Math.max(a, start), Math.min(b, end)]);
  }
  return out;
}

export type LeafReader = (offset: number, length: number) => Promise<DirEntry[]>;

/**
 * Tile entries from the source whose tiles are wanted, in tile-id order, with
 * SOURCE offsets (relative to its tile data). A run that only partly overlaps
 * is cut to the wanted part; the cut keeps pointing at the same content.
 */
export async function collectEntries(
  directory: readonly DirEntry[],
  intervals: readonly Interval[],
  readLeaf: LeafReader,
  /** Exclusive upper tile id this directory covers (from its parent). */
  coverEnd = Number.MAX_SAFE_INTEGER,
  /** Leaves read at once; results keep tile-id order regardless. */
  concurrency = 8,
): Promise<DirEntry[]> {
  // Each slot is either direct entries or a pending leaf walk, so leaves can be
  // read in parallel while the output stays in tile-id order.
  const slots: Array<DirEntry[] | (() => Promise<DirEntry[]>)> = [];
  for (let i = 0; i < directory.length; i++) {
    const e = directory[i]!;
    if (e.runLength === 0) {
      const end = directory[i + 1]?.tileId ?? coverEnd;
      if (intersect(intervals, e.tileId, end).length === 0) continue;
      slots.push(async () => collectEntries(await readLeaf(e.offset, e.length), intervals, readLeaf, end, concurrency));
      continue;
    }
    const direct: DirEntry[] = [];
    for (const [a, b] of intersect(intervals, e.tileId, e.tileId + e.runLength)) {
      direct.push({ tileId: a, offset: e.offset, length: e.length, runLength: b - a });
    }
    if (direct.length) slots.push(direct);
  }

  const results: DirEntry[][] = new Array(slots.length);
  let next = 0;
  async function worker() {
    while (next < slots.length) {
      const k = next++;
      const slot = slots[k]!;
      results[k] = typeof slot === "function" ? await slot() : slot;
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, slots.length)) }, worker));
  return results.flat();
}

export type Content = { sourceOffset: number; length: number; targetOffset: number };
export type Chunk = { sourceStart: number; sourceEnd: number; contents: Content[] };

export type ExtractLayout = {
  /** Entries with TARGET offsets, ready for buildDirectories. */
  entries: DirEntry[];
  contents: Content[];
  chunks: Chunk[];
  tileDataLength: number;
  numAddressedTiles: number;
};

/**
 * Deduplicate contents by source offset, lay them out in source order (a
 * clustered source is in tile-id order, so the extract stays clustered), and
 * group them into download chunks of merged byte ranges.
 */
export function planLayout(sourceEntries: readonly DirEntry[], chunkBytes = CHUNK_BYTES, mergeGap = MERGE_GAP_BYTES): ExtractLayout {
  const bySource = new Map<number, number>();
  for (const e of sourceEntries) if (!bySource.has(e.offset)) bySource.set(e.offset, e.length);
  const contents: Content[] = [...bySource.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sourceOffset, length]) => ({ sourceOffset, length, targetOffset: 0 }));
  let at = 0;
  const target = new Map<number, number>();
  for (const c of contents) {
    c.targetOffset = at;
    target.set(c.sourceOffset, at);
    at += c.length;
  }

  const entries: DirEntry[] = [];
  let addressed = 0;
  for (const e of sourceEntries) {
    const offset = target.get(e.offset)!;
    const prev = entries[entries.length - 1];
    addressed += e.runLength;
    // Re-join a run the cut split, when the pieces are adjacent.
    if (prev && prev.offset === offset && prev.tileId + prev.runLength === e.tileId) prev.runLength += e.runLength;
    else entries.push({ tileId: e.tileId, offset, length: e.length, runLength: e.runLength });
  }

  const chunks: Chunk[] = [];
  for (const c of contents) {
    const last = chunks[chunks.length - 1];
    const end = c.sourceOffset + c.length;
    if (last && c.sourceOffset - last.sourceEnd <= mergeGap && end - last.sourceStart <= chunkBytes) {
      last.sourceEnd = Math.max(last.sourceEnd, end);
      last.contents.push(c);
    } else {
      chunks.push({ sourceStart: c.sourceOffset, sourceEnd: end, contents: [c] });
    }
  }

  return { entries, contents, chunks, tileDataLength: at, numAddressedTiles: addressed };
}
