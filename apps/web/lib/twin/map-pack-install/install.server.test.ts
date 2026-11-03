import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PMTiles, zxyToTileId, type RangeResponse, type Source } from "pmtiles";

vi.mock("server-only", () => ({}));

import { validateMapPackManifest } from "../map-pack-manifest";

import {
  COMPRESSION_GZIP,
  COMPRESSION_NONE,
  HEADER_BYTES,
  buildDirectories,
  compress,
  headerToBytes,
  type DirEntry,
} from "./pmtiles-v3";
import { discardStaging, downloadChunk, finalizeInstall, planInstall, stagingDir } from "./install.server";

// A synthetic clustered "planet": every tile at z0-4, plus a dense block over
// central Texas at z5-13, each tile's bytes naming its tile id. Ocean-like
// duplicates share one content, as real planets do.
function tileBytes(id: number): Uint8Array {
  return new TextEncoder().encode(`tile:${id}`);
}

function buildSource(): { bytes: Uint8Array; etag: string } {
  const ids = new Set<number>();
  for (let z = 0; z <= 4; z++) for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) ids.add(zxyToTileId(z, x, y));
  const lon2x = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const lat2y = (lat: number, z: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  };
  for (let z = 5; z <= 13; z++) {
    for (let x = lon2x(-99, z); x <= lon2x(-96, z); x++) {
      for (let y = lat2y(33, z); y <= lat2y(29, z); y++) ids.add(zxyToTileId(z, x, y));
    }
  }
  const sorted = [...ids].sort((a, b) => a - b);
  const ocean = new TextEncoder().encode("ocean");
  const parts: Uint8Array[] = [ocean];
  const entries: DirEntry[] = [];
  let at = ocean.length;
  for (const id of sorted) {
    if (id % 97 === 0) {
      entries.push({ tileId: id, offset: 0, length: ocean.length, runLength: 1 });
      continue;
    }
    const b = tileBytes(id);
    entries.push({ tileId: id, offset: at, length: b.length, runLength: 1 });
    parts.push(b);
    at += b.length;
  }
  // A small root budget forces the leaf-directory path a real planet uses.
  const dirs = buildDirectories(entries, COMPRESSION_GZIP, 256, 64);
  if (dirs.leaves.length === 0) throw new Error("fixture must exercise leaf directories");
  const meta = compress(new TextEncoder().encode(JSON.stringify({ name: "synthetic" })), COMPRESSION_GZIP);
  const rootOffset = HEADER_BYTES;
  const metaOffset = rootOffset + dirs.root.length;
  const leafOffset = metaOffset + meta.length;
  const dataOffset = leafOffset + dirs.leaves.length;
  const header = headerToBytes({
    rootDirectoryOffset: rootOffset, rootDirectoryLength: dirs.root.length,
    jsonMetadataOffset: metaOffset, jsonMetadataLength: meta.length,
    leafDirectoryOffset: leafOffset, leafDirectoryLength: dirs.leaves.length,
    tileDataOffset: dataOffset, tileDataLength: at,
    numAddressedTiles: entries.length, numTileEntries: entries.length, numTileContents: parts.length,
    clustered: true, internalCompression: COMPRESSION_GZIP, tileCompression: COMPRESSION_NONE, tileType: 1,
    minZoom: 0, maxZoom: 13, minLon: -180, minLat: -85, maxLon: 180, maxLat: 85,
    centerZoom: 0, centerLon: 0, centerLat: 0,
  });
  const out = new Uint8Array(dataOffset + at);
  out.set(header, 0);
  out.set(dirs.root, rootOffset);
  out.set(meta, metaOffset);
  out.set(dirs.leaves, leafOffset);
  let p = dataOffset;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return { bytes: out, etag: '"synthetic-1"' };
}

function rangeFetch(source: { bytes: Uint8Array; etag: string }) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (headers["If-Match"] && headers["If-Match"] !== source.etag) return new Response(null, { status: 412 });
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(headers.Range ?? "")!;
    const slice = source.bytes.slice(Number(a), Math.min(Number(b) + 1, source.bytes.length));
    return new Response(slice, { status: 206, headers: { etag: source.etag } });
  });
}

class BufferSource implements Source {
  constructor(private readonly bytes: Uint8Array) {}
  getKey() {
    return "buffer";
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: this.bytes.slice(offset, offset + length).buffer as ArrayBuffer };
  }
}

const BOUNDS = { west: -98, south: 30, east: -97, north: 31 };
let root: string;
let source: ReturnType<typeof buildSource>;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dpf-maps-"));
  source = buildSource();
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("map pack install, end to end against a synthetic archive (BI-43BBCC26)", () => {
  it("extracts only the region's tiles, byte for byte, and installs pack and manifest", async () => {
    const fetchImpl = rangeFetch(source);
    const plan = await planInstall(
      { packId: "us-texas-test", region: "Central Texas, United States", bounds: BOUNDS, locale: "en-US" },
      { fetchImpl, root, sourceUrl: "https://build.protomaps.com/20261007.pmtiles", archiveVersion: "20261007" },
    );
    expect(plan.chunkCount).toBeGreaterThan(0);
    for (let i = 0; i < plan.chunkCount; i++) await downloadChunk("us-texas-test", i, { fetchImpl, root });
    // A retried chunk rewrites the same bytes.
    await downloadChunk("us-texas-test", 0, { fetchImpl, root });
    const manifest = await finalizeInstall("us-texas-test", { root, now: new Date("2026-10-07T23:00:00Z") });

    expect(validateMapPackManifest(manifest).ok).toBe(true);
    expect(manifest).toMatchObject({ packId: "us-texas-test", bounds: BOUNDS, maxZoom: 13, archiveVersion: "20261007" });
    expect((await readdir(root)).sort()).toEqual([".staging", "us-texas-test.manifest.json", "us-texas-test.pmtiles"]);

    const packBytes = new Uint8Array(await readFile(join(root, "us-texas-test.pmtiles")));
    expect(packBytes.length).toBe(manifest.byteLength);
    const pack = new PMTiles(new BufferSource(packBytes));
    const header = await pack.getHeader();
    expect(header).toMatchObject({ minZoom: 0, maxZoom: 13, minLon: -98, maxLat: 31, clustered: true });

    // Inside the bounds: Austin at z13 is present with its own bytes.
    const austin = zxyToTileId(13, 1871, 3372);
    const inside = await pack.getZxy(13, 1871, 3372);
    expect(new TextDecoder().decode(inside!.data)).toBe(`tile:${austin}`);
    // Inside, at a low zoom shared with the world.
    expect(await pack.getZxy(0, 0, 0)).toBeDefined();
    // Dallas at z13 is in the source but outside the bounds, so not in the extract.
    expect(await pack.getZxy(13, 1893, 3304)).toBeUndefined();
    // Downloads were range reads pinned to the source ETag.
    expect(fetchImpl.mock.calls.every(([, init]) => (init?.headers as Record<string, string>)?.Range)).toBe(true);
  });

  it("refuses to mix in a source that changed mid-install", async () => {
    const fetchImpl = rangeFetch(source);
    await planInstall(
      { packId: "changed-src", region: "Central Texas, United States", bounds: BOUNDS, locale: "en-US" },
      { fetchImpl, root, sourceUrl: "https://build.protomaps.com/20261007.pmtiles", archiveVersion: "20261007" },
    );
    const changed = rangeFetch({ ...source, etag: '"synthetic-2"' });
    await expect(downloadChunk("changed-src", 0, { fetchImpl: changed, root })).rejects.toThrow(/412/);
  });

  it("finishes an install interrupted between moving the pack and its manifest", async () => {
    const fetchImpl = rangeFetch(source);
    const request = { packId: "interrupted", region: "Central Texas, United States", bounds: BOUNDS, locale: "en-US" };
    const plan = await planInstall(request, { fetchImpl, root, sourceUrl: "https://build.protomaps.com/20261007.pmtiles", archiveVersion: "20261007" });
    for (let i = 0; i < plan.chunkCount; i++) await downloadChunk("interrupted", i, { fetchImpl, root });
    const dir = stagingDir("interrupted", root);
    const saved = join(root, "saved-plan");
    await mkdir(saved);
    await copyFile(join(dir, "plan.json"), join(saved, "plan.json"));
    await copyFile(join(dir, "contents.bin"), join(saved, "contents.bin"));
    const first = await finalizeInstall("interrupted", { root, now: new Date("2026-10-07T23:00:00Z") });

    // Put the room back as an attempt that died after the pack rename: staging
    // holds the plan and manifest, the pack is already in place, no manifest is listed.
    await mkdir(dir, { recursive: true });
    await copyFile(join(saved, "plan.json"), join(dir, "plan.json"));
    await copyFile(join(saved, "contents.bin"), join(dir, "contents.bin"));
    await rename(join(root, "interrupted.manifest.json"), join(dir, "manifest.json"));

    const retried = await finalizeInstall("interrupted", { root });
    expect(retried).toEqual(first);
    expect(await readFile(join(root, "interrupted.manifest.json"), "utf8")).toContain('"packId": "interrupted"');
    await expect(stat(dir)).rejects.toThrow();
    // Repeating finalize after it completed returns the installed manifest.
    expect(await finalizeInstall("interrupted", { root })).toEqual(first);
  });

  it("discards a failed install's staging folder", async () => {
    const fetchImpl = rangeFetch(source);
    await planInstall(
      { packId: "abandoned", region: "Central Texas, United States", bounds: BOUNDS, locale: "en-US" },
      { fetchImpl, root, sourceUrl: "https://build.protomaps.com/20261007.pmtiles", archiveVersion: "20261007" },
    );
    await discardStaging("abandoned", { root });
    await expect(stat(stagingDir("abandoned", root))).rejects.toThrow();
  });
});
