import { describe, expect, it } from "vitest";
import { bytesToHeader } from "pmtiles";

import {
  COMPRESSION_GZIP,
  HEADER_BYTES,
  ROOT_BUDGET_BYTES,
  buildDirectories,
  decompress,
  deserializeDirectory,
  headerToBytes,
  readVarint,
  serializeDirectory,
  writeVarint,
  type DirEntry,
} from "./pmtiles-v3";

describe("varints", () => {
  it.each([0, 1, 127, 128, 300, 2 ** 31, 2 ** 40 + 5])("round-trips %d", (n) => {
    const out: number[] = [];
    writeVarint(out, n);
    expect(readVarint(Uint8Array.from(out), { i: 0 })).toBe(n);
  });
});

describe("directories", () => {
  const entries: DirEntry[] = [
    { tileId: 0, offset: 0, length: 100, runLength: 1 },
    { tileId: 5, offset: 100, length: 50, runLength: 3 },
    { tileId: 9, offset: 0, length: 100, runLength: 1 },
  ];

  it("round-trips, including a contiguous offset and a reused one", () => {
    expect(deserializeDirectory(serializeDirectory(entries))).toEqual(entries);
  });

  it("refuses unsorted entries", () => {
    expect(() => serializeDirectory([entries[1]!, entries[0]!])).toThrow();
  });

  it("keeps a small directory in the root", () => {
    const { root, leaves } = buildDirectories(entries, COMPRESSION_GZIP);
    expect(leaves.length).toBe(0);
    expect(deserializeDirectory(decompress(root, COMPRESSION_GZIP))).toEqual(entries);
  });

  it("splits a large directory into leaves the root can address within 16 KiB", () => {
    const many: DirEntry[] = Array.from({ length: 200_000 }, (_, i) => ({
      tileId: i * 3 + (i % 3),
      offset: i * 911,
      length: 300 + (i % 400),
      runLength: 1,
    }));
    const { root, leaves } = buildDirectories(many, COMPRESSION_GZIP);
    expect(root.length).toBeLessThanOrEqual(ROOT_BUDGET_BYTES);
    const rootEntries = deserializeDirectory(decompress(root, COMPRESSION_GZIP));
    expect(rootEntries.every((e) => e.runLength === 0)).toBe(true);
    const rebuilt = rootEntries.flatMap((e) =>
      deserializeDirectory(decompress(leaves.subarray(e.offset, e.offset + e.length), COMPRESSION_GZIP)),
    );
    expect(rebuilt).toEqual(many);
  });
});

describe("headerToBytes", () => {
  it("is read back by the pinned pmtiles reader", () => {
    const fields = {
      rootDirectoryOffset: HEADER_BYTES, rootDirectoryLength: 300,
      jsonMetadataOffset: 427, jsonMetadataLength: 90,
      leafDirectoryOffset: 517, leafDirectoryLength: 4000,
      tileDataOffset: 4517, tileDataLength: 1_466_000_000,
      numAddressedTiles: 1_900_000, numTileEntries: 1_700_000, numTileContents: 1_200_000,
      clustered: true, internalCompression: 2, tileCompression: 2, tileType: 1,
      minZoom: 0, maxZoom: 15,
      minLon: -106.65, minLat: 25.84, maxLon: -93.51, maxLat: 36.5,
      centerZoom: 6, centerLon: -100.08, centerLat: 31.17,
    };
    const header = bytesToHeader(headerToBytes(fields).buffer as ArrayBuffer);
    expect(header).toMatchObject({ ...fields, specVersion: 3, etag: undefined });
  });
});
