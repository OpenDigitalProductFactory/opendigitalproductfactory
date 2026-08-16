import type {
  GeographicCoordinate,
  GeographicPlacementGeometry,
  GeographicPolygonGeometry,
  GeographicSceneLayout,
} from "@dpf/storefront-templates";

import { isRecord } from "@/lib/shared/coerce";

export const MAX_GEOGRAPHIC_SCENE_ZONES = 200;
export const MAX_GEOGRAPHIC_SCENE_PLACEMENTS = 5_000;

const MAX_COORDINATES = 20_000;
const MAX_ID_LENGTH = 160;
const MAX_LABEL_LENGTH = 240;
const MIN_ZOOM = 0;
const MAX_ZOOM = 24;

type GeoJsonPosition = [longitude: number, latitude: number];

type GeoJsonGeometry =
  | { type: "Point"; coordinates: GeoJsonPosition }
  | { type: "LineString"; coordinates: GeoJsonPosition[] }
  | { type: "Polygon"; coordinates: GeoJsonPosition[][] };

export interface GeographicFeatureProperties {
  featureId: string;
  featureKind: "zone" | "placement";
  label: string;
  entityKind: string | null;
  entityId: string | null;
  selected: boolean;
  statusLabel: string | null;
  sublabel: string | null;
  intent: string | null;
}

export interface GeographicFeature {
  type: "Feature";
  id: string;
  geometry: GeoJsonGeometry;
  properties: GeographicFeatureProperties;
}

export interface GeographicFeatureCollection {
  type: "FeatureCollection";
  features: GeographicFeature[];
}

export interface GeographicScenePresentation {
  label?: string;
  statusLabel?: string;
  sublabel?: string;
  intent?: string;
}

export type GeographicScenePresentationMap = Readonly<
  Record<string, GeographicScenePresentation>
>;

export interface GeographicBounds {
  west: number;
  south: number;
  east: number;
  north: number;
  crossesAntimeridian: boolean;
}

export interface GeographicSceneModel {
  viewport: GeographicSceneLayout["viewport"];
  bounds: GeographicBounds;
  zones: GeographicFeatureCollection;
  placements: GeographicFeatureCollection;
}

export type GeographicSceneValidationResult =
  | { ok: true; value: GeographicSceneLayout }
  | { ok: false; error: string };

function validString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function validLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

function validLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function validCoordinate(value: unknown): value is GeographicCoordinate {
  return isRecord(value) && validLongitude(value.longitude) && validLatitude(value.latitude);
}

function sameCoordinate(left: GeographicCoordinate, right: GeographicCoordinate): boolean {
  return left.longitude === right.longitude && left.latitude === right.latitude;
}

function validPolygon(value: unknown): value is GeographicPolygonGeometry {
  if (!isRecord(value) || value.kind !== "polygon" || !Array.isArray(value.rings) || value.rings.length === 0) {
    return false;
  }
  return value.rings.every((ring) =>
    Array.isArray(ring) &&
    ring.length >= 4 &&
    ring.length <= MAX_COORDINATES &&
    ring.every(validCoordinate) &&
    sameCoordinate(ring[0], ring[ring.length - 1]),
  );
}

function validPlacementGeometry(value: unknown): value is GeographicPlacementGeometry {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "point") return validCoordinate(value);
  if (value.kind === "line-string") {
    return Array.isArray(value.coordinates) && value.coordinates.length >= 2 && value.coordinates.every(validCoordinate);
  }
  return validPolygon(value);
}

function coordinateCount(value: GeographicPlacementGeometry): number {
  if (value.kind === "point") return 1;
  if (value.kind === "line-string") return value.coordinates.length;
  return value.rings.reduce((total, ring) => total + ring.length, 0);
}

export function validateGeographicSceneLayout(value: unknown): GeographicSceneValidationResult {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.spaceKind !== "geographic") {
    return { ok: false, error: "Geographic scene must use schema version 1 and geographic space kind." };
  }
  if (
    !isRecord(value.viewport) ||
    !validCoordinate(value.viewport) ||
    typeof value.viewport.zoom !== "number" ||
    !Number.isFinite(value.viewport.zoom) ||
    value.viewport.zoom < MIN_ZOOM ||
    value.viewport.zoom > MAX_ZOOM
  ) {
    return { ok: false, error: "Geographic viewport is outside supported coordinate or zoom bounds." };
  }
  if (!Array.isArray(value.zones) || value.zones.length > MAX_GEOGRAPHIC_SCENE_ZONES) {
    return { ok: false, error: `Geographic scene supports at most ${MAX_GEOGRAPHIC_SCENE_ZONES} zones.` };
  }
  if (!Array.isArray(value.placements) || value.placements.length > MAX_GEOGRAPHIC_SCENE_PLACEMENTS) {
    return { ok: false, error: `Geographic scene supports at most ${MAX_GEOGRAPHIC_SCENE_PLACEMENTS} placements.` };
  }
  if (value.underlayRef !== undefined && !validString(value.underlayRef, MAX_ID_LENGTH)) {
    return { ok: false, error: "Geographic scene underlay reference is invalid." };
  }

  const ids = new Set<string>();
  let coordinates = 0;
  for (const zone of value.zones) {
    if (
      !isRecord(zone) ||
      !validString(zone.id, MAX_ID_LENGTH) ||
      !validString(zone.label, MAX_LABEL_LENGTH) ||
      !validPolygon(zone.geometry) ||
      ids.has(zone.id)
    ) {
      return { ok: false, error: "Geographic zone is invalid or reuses a feature id." };
    }
    ids.add(zone.id);
    coordinates += zone.geometry.rings.reduce(
      (total, ring) => total + ring.length,
      0,
    );
  }
  for (const placement of value.placements) {
    if (
      !isRecord(placement) ||
      !validString(placement.id, MAX_ID_LENGTH) ||
      (placement.label !== undefined && !validString(placement.label, MAX_LABEL_LENGTH)) ||
      !isRecord(placement.entityRef) ||
      !validString(placement.entityRef.kind, MAX_ID_LENGTH) ||
      !validString(placement.entityRef.id, MAX_ID_LENGTH) ||
      !validPlacementGeometry(placement.geometry) ||
      ids.has(placement.id)
    ) {
      return { ok: false, error: "Geographic placement is invalid or reuses a feature id." };
    }
    ids.add(placement.id);
    coordinates += coordinateCount(placement.geometry);
  }
  if (coordinates > MAX_COORDINATES) {
    return { ok: false, error: `Geographic scene supports at most ${MAX_COORDINATES} coordinates.` };
  }
  return { ok: true, value: value as unknown as GeographicSceneLayout };
}

function position(coordinate: GeographicCoordinate): GeoJsonPosition {
  return [coordinate.longitude, coordinate.latitude];
}

function geometry(value: GeographicPlacementGeometry): GeoJsonGeometry {
  if (value.kind === "point") return { type: "Point", coordinates: position(value) };
  if (value.kind === "line-string") {
    return { type: "LineString", coordinates: value.coordinates.map(position) };
  }
  return { type: "Polygon", coordinates: value.rings.map((ring) => ring.map(position)) };
}

function allCoordinates(layout: GeographicSceneLayout): GeographicCoordinate[] {
  const result: GeographicCoordinate[] = [];
  for (const zone of layout.zones) result.push(...zone.geometry.rings.flat());
  for (const placement of layout.placements) {
    if (placement.geometry.kind === "point") result.push(placement.geometry);
    else if (placement.geometry.kind === "line-string") result.push(...placement.geometry.coordinates);
    else result.push(...placement.geometry.rings.flat());
  }
  return result.length > 0 ? result : [layout.viewport];
}

function signedLongitude(value: number): number {
  const normalized = ((value % 360) + 360) % 360;
  return normalized > 180 ? normalized - 360 : normalized;
}

export function geographicBounds(coordinates: readonly GeographicCoordinate[]): GeographicBounds {
  if (coordinates.length === 0) throw new RangeError("At least one geographic coordinate is required.");
  if (coordinates.length > MAX_COORDINATES || !coordinates.every(validCoordinate)) {
    throw new RangeError("Geographic bounds coordinates are invalid or exceed the supported limit.");
  }
  const longitudes = coordinates.map((item) => ((item.longitude % 360) + 360) % 360).sort((a, b) => a - b);
  let largestGap = -1;
  let gapStart = 0;
  for (let index = 0; index < longitudes.length; index += 1) {
    const current = longitudes[index];
    const next = index === longitudes.length - 1 ? longitudes[0] + 360 : longitudes[index + 1];
    if (next - current > largestGap) {
      largestGap = next - current;
      gapStart = index;
    }
  }
  const west = signedLongitude(longitudes[(gapStart + 1) % longitudes.length]);
  const east = signedLongitude(longitudes[gapStart]);
  return {
    west,
    south: Math.min(...coordinates.map((item) => item.latitude)),
    east,
    north: Math.max(...coordinates.map((item) => item.latitude)),
    crossesAntimeridian: west > east,
  };
}

export function buildGeographicSceneModel(input: {
  layout: GeographicSceneLayout;
  presentations?: GeographicScenePresentationMap;
  selectedEntityIds?: readonly string[];
}): GeographicSceneModel {
  const presentations = input.presentations ?? {};
  const selected = new Set(input.selectedEntityIds ?? []);
  return {
    viewport: input.layout.viewport,
    bounds: geographicBounds(allCoordinates(input.layout)),
    zones: {
      type: "FeatureCollection",
      features: input.layout.zones.map((zone) => ({
        type: "Feature",
        id: zone.id,
        geometry: geometry(zone.geometry),
        properties: {
          featureId: zone.id,
          featureKind: "zone",
          label: zone.label,
          entityKind: null,
          entityId: null,
          selected: false,
          statusLabel: null,
          sublabel: null,
          intent: null,
        },
      })),
    },
    placements: {
      type: "FeatureCollection",
      features: input.layout.placements.map((placement) => {
        const presentation = presentations[placement.entityRef.id];
        return {
          type: "Feature",
          id: placement.id,
          geometry: geometry(placement.geometry),
          properties: {
            featureId: placement.id,
            featureKind: "placement",
            label: presentation?.label ?? placement.label ?? placement.entityRef.id,
            entityKind: placement.entityRef.kind,
            entityId: placement.entityRef.id,
            selected: selected.has(placement.entityRef.id),
            statusLabel: presentation?.statusLabel ?? null,
            sublabel: presentation?.sublabel ?? null,
            intent: presentation?.intent ?? null,
          },
        } satisfies GeographicFeature;
      }),
    },
  };
}
