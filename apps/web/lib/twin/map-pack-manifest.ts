import { isRecord } from "@/lib/shared/coerce";

const PACK_ID = /^[a-z0-9](?:[a-z0-9.-]{0,78}[a-z0-9])?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ARCHIVE_BYTES = 1_000_000_000_000;

export interface MapPackBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface MapPackManifest {
  schemaVersion: 1;
  packId: string;
  locale: string;
  region: string;
  bounds: MapPackBounds;
  sourceName: string;
  sourceUrl: string;
  attribution: string;
  archiveVersion: string;
  byteLength: number;
  sha256: string;
  pmtilesSpecVersion: 3;
  minZoom: number;
  maxZoom: number;
  createdAt: string;
}

export type MapPackManifestResult =
  | { ok: true; value: MapPackManifest }
  | { ok: false; error: string };

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function boundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validUrl(value: unknown): value is string {
  if (!boundedText(value, 2_048)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function validBounds(value: unknown): value is MapPackBounds {
  return (
    isRecord(value) &&
    boundedNumber(value.west, -180, 180) &&
    boundedNumber(value.east, -180, 180) &&
    boundedNumber(value.south, -90, 90) &&
    boundedNumber(value.north, -90, 90) &&
    value.south <= value.north
  );
}

export function validateMapPackManifest(value: unknown): MapPackManifestResult {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return { ok: false, error: "Map pack manifest must use schema version 1." };
  }
  if (typeof value.packId !== "string" || !PACK_ID.test(value.packId)) {
    return { ok: false, error: "Map pack id must be a bounded lowercase identifier." };
  }
  if (
    !boundedText(value.locale, 35) ||
    !boundedText(value.region, 120) ||
    !boundedText(value.sourceName, 160) ||
    !validUrl(value.sourceUrl) ||
    !boundedText(value.attribution, 1_000) ||
    !boundedText(value.archiveVersion, 80)
  ) {
    return { ok: false, error: "Map pack provenance is incomplete or invalid." };
  }
  if (!validBounds(value.bounds)) {
    return { ok: false, error: "Map pack coverage bounds are invalid." };
  }
  if (
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) <= 0 ||
    (value.byteLength as number) > MAX_ARCHIVE_BYTES ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256) ||
    value.pmtilesSpecVersion !== 3
  ) {
    return { ok: false, error: "Map pack archive identity is invalid." };
  }
  if (
    !Number.isInteger(value.minZoom) ||
    !Number.isInteger(value.maxZoom) ||
    !boundedNumber(value.minZoom, 0, 24) ||
    !boundedNumber(value.maxZoom, 0, 24) ||
    value.minZoom > value.maxZoom
  ) {
    return { ok: false, error: "Map pack zoom range is invalid." };
  }
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) {
    return { ok: false, error: "Map pack creation time is invalid." };
  }
  return { ok: true, value: value as unknown as MapPackManifest };
}

export function mapPackFileName(packId: string): string {
  if (!PACK_ID.test(packId)) throw new TypeError("Map pack id is invalid.");
  return `${packId}.pmtiles`;
}
