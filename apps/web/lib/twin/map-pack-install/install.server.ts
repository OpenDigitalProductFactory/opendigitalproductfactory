import "server-only";

// Fetching and installing a street-map pack for a recommended region
// (BI-43BBCC26). Three resumable stages, each one job step:
//   plan      read the source archive's header and directories (only the
//             leaves overlapping the region), lay out the extract, write the
//             header, directories and metadata into a staging file;
//   chunk i   download one merged byte range and write its tiles in place
//             (idempotent: a retried step rewrites the same bytes);
//   finalize  check size and structure, hash, write the manifest, and move
//             pack then manifest into the map directory.
// Readers only see a pack once its manifest exists and its size matches.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { bytesToHeader } from "pmtiles";

import { resolveMapDataDir } from "../map-assets.server";
import { validateMapPackManifest, type MapPackManifest } from "../map-pack-manifest";

import {
  chooseMaxZoom,
  collectEntries,
  planLayout,
  wantedIntervals,
  type Bounds,
} from "./extract-plan";
import {
  HEADER_BYTES,
  buildDirectories,
  compress,
  decompress,
  deserializeDirectory,
  headerToBytes,
  type HeaderFields,
} from "./pmtiles-v3";

export const BUILDS_INDEX_URL = "https://build-metadata.protomaps.dev/builds.json";
export const BUILDS_BASE_URL = "https://build.protomaps.com/";
export const SOURCE_NAME = "Protomaps Basemap (OpenStreetMap)";
export const SOURCE_ATTRIBUTION =
  "© OpenStreetMap contributors · © ESA WorldCover project / Contains modified Copernicus Sentinel data (2020) processed by ESA WorldCover consortium";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type InstallRequest = {
  packId: string;
  /** Human label, e.g. "Kansas, United States". */
  region: string;
  bounds: Bounds;
  locale: string;
};

type PlanFile = {
  request: InstallRequest;
  sourceUrl: string;
  sourceEtag: string;
  archiveVersion: string;
  sourceTileDataOffset: number;
  targetTileDataOffset: number;
  totalBytes: number;
  minZoom: number;
  maxZoom: number;
  chunks: Array<{ sourceStart: number; sourceEnd: number; first: number; count: number }>;
};

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function stagingDir(packId: string, root = resolveMapDataDir()): string {
  if (!SAFE_ID.test(packId)) throw new Error("invalid pack id");
  return join(root, ".staging", packId);
}

/** The newest planet build, by key (`YYYYMMDD.pmtiles`). */
export async function latestBuild(fetchImpl: FetchLike = fetch): Promise<{ key: string; version: string }> {
  const res = await fetchImpl(BUILDS_INDEX_URL);
  if (!res.ok) throw new Error(`build index unavailable (${res.status})`);
  const builds = (await res.json()) as Array<{ key?: unknown }>;
  const keys = builds
    .map((b) => (typeof b.key === "string" ? b.key : ""))
    .filter((k) => /^\d{8}\.pmtiles$/.test(k))
    .sort();
  const key = keys[keys.length - 1];
  if (!key) throw new Error("build index lists no builds");
  return { key, version: key.slice(0, 8) };
}

/** Range reads pinned to one ETag, so a rebuilt object can never be mixed in. */
export function rangeReader(url: string, fetchImpl: FetchLike = fetch) {
  let etag: string | null = null;
  return {
    etag: () => etag,
    async read(offset: number, length: number): Promise<Uint8Array> {
      const headers: Record<string, string> = { Range: `bytes=${offset}-${offset + length - 1}` };
      if (etag) headers["If-Match"] = etag;
      const res = await fetchImpl(url, { headers });
      if (res.status !== 206) throw new Error(`range read failed (${res.status}) at ${offset}`);
      const got = res.headers.get("etag");
      if (etag && got && got !== etag) throw new Error("source archive changed during install");
      etag = etag ?? got;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length !== length) throw new Error(`short range read at ${offset}: ${bytes.length}/${length}`);
      return bytes;
    },
  };
}

/** Stage 1. Returns the number of chunks to download. */
export async function planInstall(
  request: InstallRequest,
  deps: { fetchImpl?: FetchLike; root?: string; sourceUrl?: string; archiveVersion?: string } = {},
): Promise<{ chunkCount: number; totalBytes: number; maxZoom: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const build = deps.sourceUrl
    ? { url: deps.sourceUrl, version: deps.archiveVersion ?? "unknown" }
    : await latestBuild(fetchImpl).then((b) => ({ url: BUILDS_BASE_URL + b.key, version: b.version }));
  const source = rangeReader(build.url, fetchImpl);

  const head = await source.read(0, 16_384);
  const h = bytesToHeader(head.buffer.slice(head.byteOffset, head.byteOffset + head.byteLength) as ArrayBuffer);
  if (!h.clustered) throw new Error("source archive is not clustered");
  const rootBytes = head.subarray(h.rootDirectoryOffset, h.rootDirectoryOffset + h.rootDirectoryLength);
  const root = deserializeDirectory(decompress(rootBytes, h.internalCompression));
  const metadata = decompress(await source.read(h.jsonMetadataOffset, h.jsonMetadataLength), h.internalCompression);

  const maxZoom = Math.min(h.maxZoom, chooseMaxZoom(request.bounds));
  const minZoom = h.minZoom;
  const intervals = wantedIntervals(request.bounds, minZoom, maxZoom);
  const entries = await collectEntries(root, intervals, async (offset, length) =>
    deserializeDirectory(decompress(await source.read(h.leafDirectoryOffset + offset, length), h.internalCompression)),
  );
  if (entries.length === 0) throw new Error("the source has no tiles for this region");
  const layout = planLayout(entries);
  const dirs = buildDirectories(layout.entries, h.internalCompression);
  const meta = compress(metadata, h.internalCompression);

  const rootOffset = HEADER_BYTES;
  const metaOffset = rootOffset + dirs.root.length;
  const leafOffset = metaOffset + meta.length;
  const dataOffset = leafOffset + dirs.leaves.length;
  const b = request.bounds;
  const fields: HeaderFields = {
    rootDirectoryOffset: rootOffset, rootDirectoryLength: dirs.root.length,
    jsonMetadataOffset: metaOffset, jsonMetadataLength: meta.length,
    leafDirectoryOffset: leafOffset, leafDirectoryLength: dirs.leaves.length,
    tileDataOffset: dataOffset, tileDataLength: layout.tileDataLength,
    numAddressedTiles: layout.numAddressedTiles,
    numTileEntries: layout.entries.length,
    numTileContents: layout.contents.length,
    clustered: true, internalCompression: h.internalCompression, tileCompression: h.tileCompression, tileType: h.tileType,
    minZoom, maxZoom,
    minLon: b.west, minLat: b.south, maxLon: b.east, maxLat: b.north,
    centerZoom: Math.min(maxZoom, Math.max(minZoom, 6)),
    centerLon: (b.west + b.east) / 2, centerLat: (b.south + b.north) / 2,
  };

  const dir = stagingDir(request.packId, deps.root);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const prefix = new Uint8Array(dataOffset);
  prefix.set(headerToBytes(fields), 0);
  prefix.set(dirs.root, rootOffset);
  prefix.set(meta, metaOffset);
  prefix.set(dirs.leaves, leafOffset);
  const fh = await open(join(dir, "pack.pmtiles"), "w");
  try {
    await fh.write(prefix, 0, prefix.length, 0);
    await fh.truncate(dataOffset + layout.tileDataLength);
  } finally {
    await fh.close();
  }

  // Contents as [sourceOffset, length, targetOffset] triples, indexed by chunk.
  const triples = new Float64Array(layout.contents.length * 3);
  layout.contents.forEach((c, i) => triples.set([c.sourceOffset, c.length, c.targetOffset], i * 3));
  await writeFile(join(dir, "contents.bin"), new Uint8Array(triples.buffer));
  let first = 0;
  const plan: PlanFile = {
    request,
    sourceUrl: build.url,
    sourceEtag: source.etag() ?? "",
    archiveVersion: build.version,
    sourceTileDataOffset: h.tileDataOffset,
    targetTileDataOffset: dataOffset,
    totalBytes: dataOffset + layout.tileDataLength,
    minZoom,
    maxZoom,
    chunks: layout.chunks.map((c) => {
      const row = { sourceStart: c.sourceStart, sourceEnd: c.sourceEnd, first, count: c.contents.length };
      first += c.contents.length;
      return row;
    }),
  };
  await writeFile(join(dir, "plan.json"), JSON.stringify(plan));
  return { chunkCount: plan.chunks.length, totalBytes: plan.totalBytes, maxZoom };
}

/**
 * The plan is read back from disk, so what it says to download is checked
 * again before any request: only the public Protomaps build host, over HTTPS,
 * with a well-formed ETag.
 */
export function assertPlanSource(plan: Pick<PlanFile, "sourceUrl" | "sourceEtag">): void {
  const url = new URL(plan.sourceUrl);
  if (url.protocol !== "https:" || url.origin !== new URL(BUILDS_BASE_URL).origin || url.search || url.hash) {
    throw new Error("staged plan names an unexpected source");
  }
  if (plan.sourceEtag && !/^(W\/)?"[\x21\x23-\x7e]*"$/.test(plan.sourceEtag)) {
    throw new Error("staged plan has a malformed source ETag");
  }
}

async function readPlan(dir: string): Promise<{ plan: PlanFile; triples: Float64Array }> {
  const plan = JSON.parse(await readFile(join(dir, "plan.json"), "utf8")) as PlanFile;
  assertPlanSource(plan);
  const raw = await readFile(join(dir, "contents.bin"));
  const triples = new Float64Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  return { plan, triples };
}

/** Stage 2, for chunk `index`. Safe to repeat. */
export async function downloadChunk(
  packId: string,
  index: number,
  deps: { fetchImpl?: FetchLike; root?: string } = {},
): Promise<number> {
  const dir = stagingDir(packId, deps.root);
  const { plan, triples } = await readPlan(dir);
  const chunk = plan.chunks[index];
  if (!chunk) throw new Error(`no chunk ${index}`);
  const res = await (deps.fetchImpl ?? fetch)(plan.sourceUrl, {
    headers: {
      Range: `bytes=${plan.sourceTileDataOffset + chunk.sourceStart}-${plan.sourceTileDataOffset + chunk.sourceEnd - 1}`,
      ...(plan.sourceEtag ? { "If-Match": plan.sourceEtag } : {}),
    },
  });
  if (res.status !== 206) throw new Error(`range read failed (${res.status}) for chunk ${index}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length !== chunk.sourceEnd - chunk.sourceStart) throw new Error(`short read for chunk ${index}`);
  const fh = await open(join(dir, "pack.pmtiles"), "r+");
  try {
    for (let k = chunk.first; k < chunk.first + chunk.count; k++) {
      const sourceOffset = triples[k * 3]!;
      const length = triples[k * 3 + 1]!;
      const targetOffset = triples[k * 3 + 2]!;
      const from = sourceOffset - chunk.sourceStart;
      await fh.write(bytes, from, length, plan.targetTileDataOffset + targetOffset);
    }
  } finally {
    await fh.close();
  }
  return bytes.length;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const part of createReadStream(path)) hash.update(part as Buffer);
  return hash.digest("hex");
}

/** Stage 3. Writes the manifest and moves the pack into place. */
async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

/**
 * Stage 3. Validates the staged pack, writes its manifest into staging, then
 * renames the pack and the manifest into place. Safe to repeat: a retry after
 * an interruption between the two renames finishes the move instead of
 * failing on the already-moved pack.
 */
export async function finalizeInstall(
  packId: string,
  deps: { root?: string; now?: Date } = {},
): Promise<MapPackManifest> {
  const root = deps.root ?? resolveMapDataDir();
  const dir = stagingDir(packId, root);
  const finalPack = join(root, `${packId}.pmtiles`);
  const finalManifest = join(root, `${packId}.manifest.json`);
  const stagedManifest = join(dir, "manifest.json");

  // An earlier attempt finished the move and only lost its cleanup or status write.
  if (!(await exists(dir)) && (await exists(finalManifest))) {
    const done = validateMapPackManifest(JSON.parse(await readFile(finalManifest, "utf8")));
    if (!done.ok) throw new Error(`installed manifest rejected: ${done.error}`);
    return done.value;
  }

  const { plan } = await readPlan(dir);
  if (plan.request.packId !== packId) throw new Error("staged plan is for a different pack");
  const staged = join(dir, "pack.pmtiles");

  let manifest: MapPackManifest;
  if (await exists(staged)) {
    manifest = await stagedManifestFor(staged, plan, packId, deps.now ?? new Date());
    await writeFile(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    // Pack first, manifest last: a pack without a manifest is never listed.
    await rename(staged, finalPack);
  } else {
    // The pack was moved by an interrupted attempt; its manifest is still staged.
    if (!(await exists(stagedManifest)) || (await stat(finalPack).then((s) => s.size, () => -1)) !== plan.totalBytes) {
      throw new Error("staged pack is missing; start the install again");
    }
    const checked = validateMapPackManifest(JSON.parse(await readFile(stagedManifest, "utf8")));
    if (!checked.ok) throw new Error(`manifest rejected: ${checked.error}`);
    manifest = checked.value;
  }
  await rename(stagedManifest, finalManifest);
  await rm(dir, { recursive: true, force: true });
  return manifest;
}

async function stagedManifestFor(staged: string, plan: PlanFile, packId: string, now: Date): Promise<MapPackManifest> {
  // Size and structure are checked through one open handle, so they describe the same file.
  const fh = await open(staged, "r");
  let size: number;
  try {
    size = (await fh.stat()).size;
    if (size !== plan.totalBytes) throw new Error(`staged pack is ${size} bytes, expected ${plan.totalBytes}`);
    // Structural check with the pinned reader: header and root directory parse.
    const head = new Uint8Array(16_384);
    await fh.read(head, 0, Math.min(16_384, size), 0);
    const h = bytesToHeader(head.buffer as ArrayBuffer);
    if (h.specVersion !== 3 || h.tileDataOffset !== plan.targetTileDataOffset) throw new Error("staged pack header is wrong");
    deserializeDirectory(decompress(head.subarray(h.rootDirectoryOffset, h.rootDirectoryOffset + h.rootDirectoryLength), h.internalCompression));
  } finally {
    await fh.close();
  }

  const { request } = plan;
  const checked = validateMapPackManifest({
    schemaVersion: 1,
    packId,
    locale: request.locale,
    region: request.region,
    bounds: request.bounds,
    sourceName: SOURCE_NAME,
    sourceUrl: plan.sourceUrl,
    attribution: SOURCE_ATTRIBUTION,
    archiveVersion: plan.archiveVersion,
    byteLength: size,
    sha256: await sha256File(staged),
    pmtilesSpecVersion: 3,
    minZoom: plan.minZoom,
    maxZoom: plan.maxZoom,
    createdAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  if (!checked.ok) throw new Error(`manifest rejected: ${checked.error}`);
  return checked.value;
}

/** Remove a failed install's staging folder so it does not hold space on the map volume. */
export async function discardStaging(packId: string, deps: { root?: string } = {}): Promise<void> {
  await rm(stagingDir(packId, deps.root ?? resolveMapDataDir()), { recursive: true, force: true });
}
