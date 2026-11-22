import "server-only";

import type { Bounds } from "./extract-plan";

export type MapPackPlanPolicy = Readonly<{
  buildIndexUrl: "https://build-metadata.protomaps.dev/builds.json";
  archiveOrigin: "https://build.protomaps.com";
  maxEtagLength: number;
  maxPlanBytes: number;
  maxArchiveBytes: number;
  maxChunks: number;
  pmtilesSpecVersion: 3;
}>;

/** Trusted limits for plans that can cause network reads and disk writes. */
export const PROTOMAPS_PLAN_POLICY: MapPackPlanPolicy = Object.freeze({
  buildIndexUrl: "https://build-metadata.protomaps.dev/builds.json",
  archiveOrigin: "https://build.protomaps.com",
  maxEtagLength: 255,
  maxPlanBytes: 1_000_000,
  maxArchiveBytes: 1_000_000_000_000,
  maxChunks: 100_000,
  pmtilesSpecVersion: 3,
});

export type PlanContent = Readonly<{
  sourceOffset: number;
  length: number;
  targetOffset: number;
}>;

export type PlanChunk = Readonly<{
  sourceStart: number;
  sourceEnd: number;
  first: number;
  count: number;
}>;

export type NormalizedPlanRequest = Readonly<{
  packId: string;
  region: string;
  bounds: Readonly<Bounds>;
  locale: string;
}>;

export type NormalizedPlanFile = Readonly<{
  request: NormalizedPlanRequest;
  sourceUrl: string;
  sourceEtag: string;
  archiveVersion: string;
  pmtilesSpecVersion: 3;
  sourceTileDataOffset: number;
  sourceTileDataLength?: number;
  targetTileDataOffset: number;
  totalBytes: number;
  minZoom: number;
  maxZoom: number;
  chunks: readonly PlanChunk[];
  contents: readonly PlanContent[];
}>;

export type PlanFileInput = {
  request: Readonly<{ packId: string; region: string; bounds: Bounds; locale: string }>;
  sourceUrl: string;
  sourceEtag: string;
  archiveVersion: string;
  pmtilesSpecVersion: number;
  sourceTileDataOffset: number;
  sourceTileDataLength?: number;
  targetTileDataOffset: number;
  totalBytes: number;
  minZoom: number;
  maxZoom: number;
  chunks: readonly { sourceStart: number; sourceEnd: number; first: number; count: number }[];
  contents: readonly { sourceOffset: number; length: number; targetOffset: number }[];
  /** Test and read-side guard input; it is never persisted in the result. */
  planBytes?: number;
};

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const BUILD_KEY = /^\d{8}\.pmtiles$/;
const BUILD_VERSION = /^\d{8}$/;
const ETAG = /^(W\/)?"[\x21\x23-\x7e]*"$/;

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`invalid ${label}`);
  return value as number;
}

function safeAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error(`invalid ${label}`);
  return result;
}

function finiteCoordinate(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid ${label}`);
  return value;
}

export function trustedArchiveUrl(urlText: unknown, policy: MapPackPlanPolicy): { url: URL; key: string } {
  if (typeof urlText !== "string") throw new Error("invalid source URL");
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    throw new Error("invalid source URL");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== policy.archiveOrigin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith("/") ||
    !BUILD_KEY.test(url.pathname.slice(1))
  ) throw new Error("unexpected source URL");
  const key = url.pathname.slice(1);
  return { url: new URL(key, policy.archiveOrigin), key };
}

function normalizedBounds(bounds: Bounds): Readonly<Bounds> {
  const west = finiteCoordinate(bounds?.west, "west bound");
  const south = finiteCoordinate(bounds?.south, "south bound");
  const east = finiteCoordinate(bounds?.east, "east bound");
  const north = finiteCoordinate(bounds?.north, "north bound");
  if (west < -180 || east > 180 || west >= east || south < -90 || north > 90 || south >= north) {
    throw new Error("invalid bounds");
  }
  return { west, south, east, north };
}

export function normalizePlan(input: PlanFileInput, policy: MapPackPlanPolicy = PROTOMAPS_PLAN_POLICY): NormalizedPlanFile {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid staging plan");
  const request = input.request;
  if (!request || typeof request !== "object" || Array.isArray(request) || typeof request.packId !== "string" || !SAFE_ID.test(request.packId)) {
    throw new Error("invalid pack id");
  }
  if (typeof request.region !== "string" || typeof request.locale !== "string") throw new Error("invalid request labels");
  const { url, key } = trustedArchiveUrl(input.sourceUrl, policy);
  if (typeof input.sourceEtag !== "string" || input.sourceEtag.length > policy.maxEtagLength || (input.sourceEtag !== "" && !ETAG.test(input.sourceEtag))) {
    throw new Error("malformed source ETag");
  }
  if (typeof input.archiveVersion !== "string" || !BUILD_VERSION.test(input.archiveVersion) || input.archiveVersion !== key.slice(0, 8)) {
    throw new Error("invalid archive build version");
  }
  if (input.pmtilesSpecVersion !== policy.pmtilesSpecVersion) throw new Error("unsupported PMTiles version");
  const sourceTileDataOffset = safeInteger(input.sourceTileDataOffset, "source tile data offset");
  const targetTileDataOffset = safeInteger(input.targetTileDataOffset, "target tile data offset");
  const totalBytes = safeInteger(input.totalBytes, "archive size");
  const sourceTileDataLength = input.sourceTileDataLength === undefined ? totalBytes : safeInteger(input.sourceTileDataLength, "source tile data length");
  if (
    totalBytes > policy.maxArchiveBytes ||
    sourceTileDataLength > policy.maxArchiveBytes ||
    safeAdd(sourceTileDataOffset, sourceTileDataLength, "source tile data range") > policy.maxArchiveBytes ||
    (input.sourceTileDataLength === undefined && targetTileDataOffset < sourceTileDataOffset) ||
    targetTileDataOffset > totalBytes
  ) throw new Error("archive size or offsets exceed policy");
  if (input.planBytes !== undefined && (!Number.isSafeInteger(input.planBytes) || input.planBytes < 0 || input.planBytes > policy.maxPlanBytes)) {
    throw new Error("serialized plan exceeds policy");
  }
  const minZoom = safeInteger(input.minZoom, "minimum zoom");
  const maxZoom = safeInteger(input.maxZoom, "maximum zoom");
  if (minZoom > maxZoom || maxZoom > 30) throw new Error("invalid zoom range");
  if (!Array.isArray(input.chunks) || input.chunks.length === 0 || input.chunks.length > policy.maxChunks) throw new Error("invalid chunk count");
  if (!Array.isArray(input.contents) || input.contents.length === 0) throw new Error("invalid contents table");

  const contents = input.contents.map((content, index) => {
    if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error(`invalid content ${index}`);
    const sourceOffset = safeInteger(content.sourceOffset, `content ${index} source offset`);
    const length = safeInteger(content.length, `content ${index} length`);
    const targetOffset = safeInteger(content.targetOffset, `content ${index} target offset`);
    const sourceEnd = safeAdd(sourceOffset, length, `content ${index} source range`);
    const targetEnd = safeAdd(targetOffset, length, `content ${index} target range`);
    if (length === 0 || sourceEnd > sourceTileDataLength || targetEnd > totalBytes - targetTileDataOffset) {
      throw new Error(`content ${index} is outside the archive`);
    }
    if (index > 0) {
      const previous = input.contents[index - 1]!;
      if (
        sourceOffset < safeAdd(previous.sourceOffset, previous.length, `content ${index - 1} source range`) ||
        targetOffset < safeAdd(previous.targetOffset, previous.length, `content ${index - 1} target range`)
      ) {
        throw new Error("contents ranges overlap");
      }
    }
    return { sourceOffset, length, targetOffset };
  });
  const chunks = input.chunks.map((chunk, index) => {
    if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) throw new Error(`invalid chunk ${index}`);
    const sourceStart = safeInteger(chunk.sourceStart, `chunk ${index} start`);
    const sourceEnd = safeInteger(chunk.sourceEnd, `chunk ${index} end`);
    const first = safeInteger(chunk.first, `chunk ${index} first`);
    const count = safeInteger(chunk.count, `chunk ${index} count`);
    const contentEnd = safeAdd(first, count, `chunk ${index} content range`);
    if (sourceEnd <= sourceStart || sourceEnd > sourceTileDataLength || contentEnd > contents.length) throw new Error(`chunk ${index} is invalid`);
    if (index > 0 && sourceStart < input.chunks[index - 1]!.sourceEnd) throw new Error("chunk ranges overlap");
    if (count === 0) throw new Error(`chunk ${index} is empty`);
    const firstContent = contents[first];
    const lastContent = contents[contentEnd - 1];
    if (!firstContent || !lastContent || firstContent.sourceOffset < sourceStart || safeAdd(lastContent.sourceOffset, lastContent.length, `chunk ${index} content end`) > sourceEnd) {
      throw new Error(`chunk ${index} range does not match contents`);
    }
    for (let contentIndex = first; contentIndex < first + count; contentIndex++) {
      const content = contents[contentIndex]!;
      if (content.sourceOffset < sourceStart || safeAdd(content.sourceOffset, content.length, `chunk ${index} content end`) > sourceEnd) throw new Error(`chunk ${index} range does not contain contents`);
    }
    return { sourceStart, sourceEnd, first, count };
  });
  let coveredContents = 0;
  for (const chunk of chunks) {
    if (chunk.first !== coveredContents) throw new Error("chunk contents are not contiguous");
    coveredContents = safeAdd(chunk.first, chunk.count, "chunk contents coverage");
  }
  if (coveredContents !== contents.length) throw new Error("chunk contents do not cover the contents table");

  return {
    request: { packId: request.packId, region: request.region, bounds: normalizedBounds(request.bounds), locale: request.locale },
    sourceUrl: url.toString(),
    sourceEtag: input.sourceEtag,
    archiveVersion: input.archiveVersion,
    pmtilesSpecVersion: 3,
    sourceTileDataOffset,
    sourceTileDataLength: input.sourceTileDataLength === undefined ? undefined : sourceTileDataLength,
    targetTileDataOffset,
    totalBytes,
    minZoom,
    maxZoom,
    chunks,
    contents,
  };
}
