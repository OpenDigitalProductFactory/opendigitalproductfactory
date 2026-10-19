import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  handleMapPackRequest,
  handleMapRuntimeRequest,
  listInstalledMapPacks,
  openMapPack,
  resolveMapDataDir,
} from "./map-assets.server";

const BYTES = Buffer.from("0123456789abcdefghij"); // 20 bytes

function manifest(packId: string, byteLength = BYTES.length) {
  return {
    schemaVersion: 1,
    packId,
    locale: "en-US",
    region: "Test region",
    bounds: { west: -10, south: -10, east: 10, north: 10 },
    sourceName: "Protomaps",
    sourceUrl: "https://build.protomaps.com/",
    attribution: "© OpenStreetMap contributors",
    archiveVersion: "20260901",
    byteLength,
    sha256: "a".repeat(64),
    pmtilesSpecVersion: 3,
    minZoom: 0,
    maxZoom: 14,
    createdAt: "2026-09-01T00:00:00Z",
  };
}

let root: string;

async function install(packId: string, byteLength?: number) {
  await writeFile(path.join(root, `${packId}.pmtiles`), BYTES);
  await writeFile(path.join(root, `${packId}.manifest.json`), JSON.stringify(manifest(packId, byteLength)));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "dpf-maps-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function request(method: "GET" | "HEAD", range?: string) {
  return { method, rangeHeader: range ?? null, authenticated: true, root };
}

describe("map data directory", () => {
  it("defaults to /var/lib/dpf/maps and honours DPF_MAP_DATA_DIR", () => {
    expect(resolveMapDataDir({})).toBe("/var/lib/dpf/maps");
    expect(resolveMapDataDir({ DPF_MAP_DATA_DIR: "/data/maps" })).toBe("/data/maps");
  });
});

describe("installed packs", () => {
  it("lists only packs whose manifest is valid and matches its file name", async () => {
    await install("us-texas");
    await writeFile(path.join(root, "broken.manifest.json"), "{not json");
    await writeFile(path.join(root, "other.manifest.json"), JSON.stringify(manifest("mismatch")));
    const packs = await listInstalledMapPacks(root);
    expect(packs.map((pack) => pack.packId)).toEqual(["us-texas"]);
  });

  it("returns an empty list when the directory does not exist", async () => {
    expect(await listInstalledMapPacks(path.join(root, "absent"))).toEqual([]);
  });

  it("opens a pack, and reports missing and length-mismatched packs", async () => {
    await install("us-texas");
    await install("short", 999);
    expect((await openMapPack("us-texas", root)).status).toBe("ok");
    expect((await openMapPack("nowhere", root)).status).toBe("missing");
    expect((await openMapPack("short", root)).status).toBe("invalid");
  });

  it.each(["..", "../etc/passwd", "a/b", "%2e%2e", "US-TEXAS", "/abs", "a..b/"])(
    "refuses the pack id %s without touching the file system",
    async (packId) => {
      expect((await openMapPack(packId, root)).status).toBe("missing");
    },
  );
});

describe("pack requests", () => {
  beforeEach(async () => install("us-texas"));

  it("refuses an unauthenticated call", async () => {
    const response = await handleMapPackRequest({ ...request("GET"), authenticated: false }, "us-texas");
    expect(response.status).toBe(401);
  });

  it("serves the whole archive with range support and an immutable ETag", async () => {
    const response = await handleMapPackRequest(request("GET"), "us-texas");
    expect(response.status).toBe(200);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("ETag")).toBe(`"${"a".repeat(64)}"`);
    expect(response.headers.get("Content-Length")).toBe("20");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(BYTES.toString());
  });

  it("serves a partial range", async () => {
    const response = await handleMapPackRequest(request("GET", "bytes=2-5"), "us-texas");
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 2-5/20");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("2345");
  });

  it("serves a suffix range", async () => {
    const response = await handleMapPackRequest(request("GET", "bytes=-3"), "us-texas");
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 17-19/20");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("hij");
  });

  it("refuses multiple and unsatisfiable ranges with 416", async () => {
    for (const range of ["bytes=0-1,4-5", "bytes=50-60"]) {
      const response = await handleMapPackRequest(request("GET", range), "us-texas");
      expect(response.status).toBe(416);
      expect(response.headers.get("Content-Range")).toBe("bytes */20");
    }
  });

  it("answers HEAD with headers and no body", async () => {
    const response = await handleMapPackRequest(request("HEAD", "bytes=0-9"), "us-texas");
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(response.body).toBeNull();
  });

  it("returns typed 404 and 409 bodies", async () => {
    await install("short", 999);
    const missing = await handleMapPackRequest(request("GET"), "nowhere");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ status: "missing" });
    const invalid = await handleMapPackRequest(request("GET"), "short");
    expect(invalid.status).toBe(409);
    expect(await invalid.json()).toMatchObject({ status: "invalid" });
  });
});

describe("runtime requests", () => {
  it("serves only the two allowlisted MapLibre runtime files", async () => {
    const ok = await handleMapRuntimeRequest({ authenticated: true }, "maplibre-gl-worker.mjs");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    for (const file of ["maplibre-gl.mjs", "../package.json", "maplibre-gl-worker.mjs.map"]) {
      expect((await handleMapRuntimeRequest({ authenticated: true }, file)).status).toBe(404);
    }
  });

  it("refuses an unauthenticated call", async () => {
    expect((await handleMapRuntimeRequest({ authenticated: false }, "maplibre-gl-shared.mjs")).status).toBe(401);
  });
});
