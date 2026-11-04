import { describe, expect, it, vi } from "vitest";
import { zxyToTileId } from "pmtiles";

import {
  chooseMaxZoom,
  collectEntries,
  intersect,
  planLayout,
  tileCount,
  wantedIntervals,
  type Interval,
} from "./extract-plan";
import type { DirEntry } from "./pmtiles-v3";

const TEXAS = { west: -106.65, south: 25.84, east: -93.51, north: 36.5 };
const AUSTIN_SMALL = { west: -97.9, south: 30.1, east: -97.6, north: 30.4 };

describe("tile ranges", () => {
  it("covers the whole world with one tile at zoom 0", () => {
    expect(tileCount(TEXAS, 0)).toBe(1);
    expect(wantedIntervals(TEXAS, 0, 0)).toEqual([[0, 1]]);
  });

  it("includes the tile containing a point inside the bounds at every zoom", () => {
    const intervals = wantedIntervals(AUSTIN_SMALL, 0, 12);
    // Austin, z12: x = 935, y = 1686 (slippy-map tile of 30.27, -97.74)
    const id = zxyToTileId(12, 935, 1686);
    expect(intersect(intervals, id, id + 1)).toEqual([[id, id + 1]]);
    // ... and not a tile in London.
    const london = zxyToTileId(12, 2046, 1361);
    expect(intersect(intervals, london, london + 1)).toEqual([]);
  });

  it("keeps Texas at z15 within the default budget and caps a continent lower", () => {
    expect(chooseMaxZoom(TEXAS)).toBe(15);
    expect(chooseMaxZoom({ west: -125, south: 24, east: -66, north: 50 })).toBeLessThan(15);
  });
});

describe("intersect", () => {
  const intervals: Interval[] = [[10, 20], [30, 40]];
  it("returns only the wanted parts of a range", () => {
    expect(intersect(intervals, 15, 35)).toEqual([[15, 20], [30, 35]]);
    expect(intersect(intervals, 20, 30)).toEqual([]);
    expect(intersect(intervals, 0, 100)).toEqual(intervals);
  });
});

describe("collectEntries", () => {
  it("reads only the leaves that overlap the wanted tiles and cuts runs to the wanted part", async () => {
    const root: DirEntry[] = [
      { tileId: 0, offset: 0, length: 10, runLength: 0 },   // leaf A covers [0, 100)
      { tileId: 100, offset: 10, length: 10, runLength: 0 }, // leaf B covers [100, 200)
      { tileId: 200, offset: 5000, length: 7, runLength: 50 }, // run [200, 250)
    ];
    const leafB: DirEntry[] = [
      { tileId: 120, offset: 1000, length: 30, runLength: 1 },
      { tileId: 150, offset: 2000, length: 40, runLength: 1 },
    ];
    const readLeaf = vi.fn(async (offset: number) => (offset === 10 ? leafB : []));
    const out = await collectEntries(root, [[120, 121], [210, 215]], readLeaf);
    expect(readLeaf).toHaveBeenCalledTimes(1);
    expect(readLeaf).toHaveBeenCalledWith(10, 10);
    expect(out).toEqual([
      { tileId: 120, offset: 1000, length: 30, runLength: 1 },
      { tileId: 210, offset: 5000, length: 7, runLength: 5 },
    ]);
  });
});

describe("planLayout", () => {
  it("deduplicates contents, keeps source order and maps entries to new offsets", () => {
    const layout = planLayout([
      { tileId: 1, offset: 900, length: 10, runLength: 1 },
      { tileId: 2, offset: 100, length: 20, runLength: 1 },
      { tileId: 3, offset: 900, length: 10, runLength: 2 },
    ]);
    expect(layout.contents).toEqual([
      { sourceOffset: 100, length: 20, targetOffset: 0 },
      { sourceOffset: 900, length: 10, targetOffset: 20 },
    ]);
    expect(layout.entries).toEqual([
      { tileId: 1, offset: 20, length: 10, runLength: 1 },
      { tileId: 2, offset: 0, length: 20, runLength: 1 },
      { tileId: 3, offset: 20, length: 10, runLength: 2 },
    ]);
    expect(layout.tileDataLength).toBe(30);
    expect(layout.numAddressedTiles).toBe(4);
  });

  it("merges nearby contents into one download and splits at the chunk size", () => {
    const entries: DirEntry[] = [
      { tileId: 1, offset: 0, length: 100, runLength: 1 },
      { tileId: 2, offset: 150, length: 100, runLength: 1 },
      { tileId: 3, offset: 10_000_000, length: 100, runLength: 1 },
    ];
    const { chunks } = planLayout(entries, 1_000_000, 1_000);
    expect(chunks.map((c) => [c.sourceStart, c.sourceEnd, c.contents.length])).toEqual([
      [0, 250, 2],
      [10_000_000, 10_000_100, 1],
    ]);
  });

  it("re-joins a run that the cut split into adjacent pieces", () => {
    const layout = planLayout([
      { tileId: 10, offset: 0, length: 5, runLength: 2 },
      { tileId: 12, offset: 0, length: 5, runLength: 3 },
    ]);
    expect(layout.entries).toEqual([{ tileId: 10, offset: 0, length: 5, runLength: 5 }]);
  });
});
