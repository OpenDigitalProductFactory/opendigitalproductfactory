import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
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
import { assertPlanSource, discardStaging, downloadChunk, finalizeInstall, planInstall, stagingDir } from "./install.server";
import { normalizePlan } from "./plan-policy.server";

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

  it("downloads only from the Protomaps build host named in a well-formed plan", () => {
    expect(() => assertPlanSource({ sourceUrl: "https://build.protomaps.com/20261007.pmtiles", sourceEtag: '"abc"' })).not.toThrow();
    expect(() => assertPlanSource({ sourceUrl: "https://build.protomaps.com/20261007.pmtiles", sourceEtag: "" })).not.toThrow();
    expect(() => assertPlanSource({ sourceUrl: "https://example.com/planet.pmtiles", sourceEtag: "" })).toThrow(/unexpected source/);
    expect(() => assertPlanSource({ sourceUrl: "http://build.protomaps.com/20261007.pmtiles", sourceEtag: "" })).toThrow(/unexpected source/);
    expect(() => assertPlanSource({ sourceUrl: "https://build.protomaps.com/x.pmtiles", sourceEtag: 'a"\r\nX: y' })).toThrow(/ETag/);
  });

  it.each([
    ["hostile archive", { sourceUrl: "https://build.protomaps.com/../../evil.pmtiles" }],
    ["malformed ETag", { sourceEtag: '"unterminated' }],
    ["invalid arithmetic", { sourceTileDataOffset: -1 }],
    ["overlapping chunks", { chunks: [{ sourceStart: 0, sourceEnd: 2, first: 0, count: 1 }, { sourceStart: 1, sourceEnd: 3, first: 1, count: 1 }] }],
  ] as const)("rejects %s before fetch or contents.bin mutation", async (_label, changes) => {
    const packId = `tampered-${_label.replace(/[^a-z0-9]+/g, "-")}`;
    const fetchImpl = rangeFetch(source);
    await planInstall(
      { packId, region: "Central Texas, United States", bounds: BOUNDS, locale: "en-US" },
      { fetchImpl, root, sourceUrl: "https://build.protomaps.com/20261007.pmtiles", archiveVersion: "20261007" },
    );
    const dir = stagingDir(packId, root);
    const planPath = join(dir, "plan.json");
    const contentsPath = join(dir, "contents.bin");
    const originalContents = await readFile(contentsPath);
    const plan = JSON.parse(await readFile(planPath, "utf8")) as Record<string, unknown>;
    await writeFile(planPath, JSON.stringify({ ...plan, ...changes }));
    const injectedFetch = vi.fn(async () => new Response(new Uint8Array([1]), { status: 206, headers: { etag: source.etag } }));

    await expect(downloadChunk(packId, 0, { fetchImpl: injectedFetch, root })).rejects.toThrow();
    expect(injectedFetch).not.toHaveBeenCalled();
    expect(await readFile(contentsPath)).toEqual(originalContents);
  });
});

type PolicyPlan = Parameters<typeof normalizePlan>[0];

const validPolicyPlan = (): PolicyPlan => ({
  request: {
    packId: "us-texas-test",
    region: "Central Texas, United States",
    bounds: BOUNDS,
    locale: "en-US",
  },
  sourceUrl: "https://build.protomaps.com/20261007.pmtiles",
  sourceEtag: '"synthetic-1"',
  archiveVersion: "20261007",
  pmtilesSpecVersion: 3,
  sourceTileDataOffset: 1_024,
  targetTileDataOffset: 4_096,
  totalBytes: 8_192,
  minZoom: 0,
  maxZoom: 13,
  chunks: [{ sourceStart: 0, sourceEnd: 128, first: 0, count: 1 }],
  contents: [{ sourceOffset: 0, length: 32, targetOffset: 0 }],
});

describe("normalized map-pack plan policy boundary", () => {
  it("accepts a production-shaped plan and preserves its normalized values", () => {
    const plan = validPolicyPlan();
    expect(normalizePlan(plan)).toMatchObject(plan);
  });

  it.each([
    ["non-HTTPS source", { sourceUrl: "http://build.protomaps.com/20261007.pmtiles" }],
    ["unapproved source origin", { sourceUrl: "https://example.com/20261007.pmtiles" }],
    ["URL credentials", { sourceUrl: "https://user:pass@build.protomaps.com/20261007.pmtiles" }],
    ["URL query", { sourceUrl: "https://build.protomaps.com/20261007.pmtiles?x=1" }],
    ["URL fragment", { sourceUrl: "https://build.protomaps.com/20261007.pmtiles#x" }],
    ["malformed ETag", { sourceEtag: '"unterminated' }],
    ["overlong ETag", { sourceEtag: `"${"x".repeat(256)}"` }],
    ["invalid pack identifier", { request: { ...validPolicyPlan().request, packId: "../escape" } }],
    ["invalid archive build version", { archiveVersion: "not-a-build" }],
    ["unsupported PMTiles version", { pmtilesSpecVersion: 2 }],
    ["unsafe integer offset", { sourceTileDataOffset: Number.MAX_SAFE_INTEGER + 1 }],
    ["negative integer offset", { targetTileDataOffset: -1 }],
    ["excessive archive size", { totalBytes: 1_000_000_000_001 }],
    ["excessive serialized plan size", { planBytes: 1_000_001 }],
    ["inconsistent source and target offsets", { targetTileDataOffset: 1_000 }],
    ["empty chunk coverage", { chunks: [] }],
    [
      "incomplete chunk coverage",
      {
        contents: [
          { sourceOffset: 0, length: 32, targetOffset: 0 },
          { sourceOffset: 64, length: 32, targetOffset: 32 },
        ],
        chunks: [{ sourceStart: 0, sourceEnd: 32, first: 0, count: 1 }],
      },
    ],
    [
      "overlapping chunk ranges",
      {
        contents: [
          { sourceOffset: 0, length: 32, targetOffset: 0 },
          { sourceOffset: 32, length: 32, targetOffset: 32 },
        ],
        chunks: [
          { sourceStart: 0, sourceEnd: 48, first: 0, count: 1 },
          { sourceStart: 32, sourceEnd: 64, first: 1, count: 1 },
        ],
      },
    ],
    [
      "overlapping contents ranges",
      {
        contents: [
          { sourceOffset: 0, length: 32, targetOffset: 0 },
          { sourceOffset: 32, length: 32, targetOffset: 16 },
        ],
        chunks: [{ sourceStart: 0, sourceEnd: 48, first: 0, count: 2 }],
      },
    ],
    [
      "overlapping content source ranges",
      {
        contents: [
          { sourceOffset: 0, length: 32, targetOffset: 0 },
          { sourceOffset: 16, length: 32, targetOffset: 32 },
        ],
        chunks: [{ sourceStart: 0, sourceEnd: 48, first: 0, count: 2 }],
      },
    ],
    [
      "chunks omit contents entries",
      {
        contents: [
          { sourceOffset: 0, length: 32, targetOffset: 0 },
          { sourceOffset: 64, length: 32, targetOffset: 32 },
        ],
        chunks: [{ sourceStart: 0, sourceEnd: 32, first: 0, count: 1 }],
      },
    ],
    ["chunk with reversed range", { chunks: [{ sourceStart: 128, sourceEnd: 0, first: 0, count: 1 }] }],
    ["chunk outside archive", { chunks: [{ sourceStart: 8_000, sourceEnd: 8_300, first: 0, count: 1 }] }],
    ["excessive chunk count", { chunks: Array.from({ length: 100_001 }, () => ({ sourceStart: 0, sourceEnd: 1, first: 0, count: 1 })) }],
    ["contents reference outside source range", { contents: [{ sourceOffset: 128, length: 64, targetOffset: 0 }] }],
    ["contents reference outside target range", { contents: [{ sourceOffset: 0, length: 32, targetOffset: 8_192 }] }],
  ] as const)("rejects %s", (_label, change) => {
    expect(() => normalizePlan({ ...validPolicyPlan(), ...change })).toThrow();
  });

  it("does not leave plan.json when planning is rejected", async () => {
    const packId = "rejected-policy-plan";
    const dir = stagingDir(packId, root);
    await expect(
      planInstall(
        { packId, region: "Central Texas, United States", bounds: BOUNDS, locale: "en-US" },
        { fetchImpl: rangeFetch(source), root, sourceUrl: "http://build.protomaps.com/20261007.pmtiles", archiveVersion: "20261007" },
      ),
    ).rejects.toThrow();
    await expect(stat(join(dir, "plan.json"))).rejects.toThrow();
  });

  it("rejects a tampered staged plan before making requests or writes", async () => {
    const packId = "tampered-policy-plan";
    await planInstall(
      { packId, region: "Central Texas, United States", bounds: BOUNDS, locale: "en-US" },
      { fetchImpl: rangeFetch(source), root, sourceUrl: "https://build.protomaps.com/20261007.pmtiles", archiveVersion: "20261007" },
    );
    const dir = stagingDir(packId, root);
    const plan = JSON.parse(await readFile(join(dir, "plan.json"), "utf8")) as Record<string, unknown>;
    plan.sourceUrl = "https://example.com/20261007.pmtiles";
    await writeFile(join(dir, "plan.json"), JSON.stringify(plan));

    const fetchImpl = vi.fn<typeof fetch>();
    await expect(downloadChunk(packId, 0, { fetchImpl, root })).rejects.toThrow(/source/);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(stat(join(dir, "pack.pmtiles"))).resolves.toBeDefined();
  });

  it("rejects a chunk table that omits contents.bin entries before making requests", async () => {
    const packId = "incomplete-chunk-table";
    await planInstall(
      { packId, region: "Central Texas, United States", bounds: BOUNDS, locale: "en-US" },
      { fetchImpl: rangeFetch(source), root, sourceUrl: "https://build.protomaps.com/20261007.pmtiles", archiveVersion: "20261007" },
    );
    const dir = stagingDir(packId, root);
    const plan = JSON.parse(await readFile(join(dir, "plan.json"), "utf8")) as { chunks: Array<Record<string, number>> };
    expect((await stat(join(dir, "contents.bin"))).size).toBeGreaterThan(24);
    plan.chunks = [{ ...plan.chunks[0]!, first: 0, count: 1 }];
    await writeFile(join(dir, "plan.json"), JSON.stringify(plan));

    const fetchImpl = vi.fn<typeof fetch>();
    await expect(downloadChunk(packId, 0, { fetchImpl, root })).rejects.toThrow(/cover|contiguous/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
