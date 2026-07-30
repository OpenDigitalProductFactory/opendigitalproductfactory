import type {
  CartesianCoordinate,
  CartesianPlacementGeometry,
  CartesianRegionGeometry,
  CartesianSceneLayout,
  CartesianScenePlacement,
  CartesianSceneZone,
  SceneEntityRef,
} from "@dpf/storefront-templates";

import type { Intent } from "@/components/ui/report-kit";
import { isRecord } from "@/lib/shared/coerce";

export const MAX_CARTESIAN_SCENE_ZONES = 6;
export const MAX_CARTESIAN_SCENE_PLACEMENTS = 1_000;

const MAX_COORDINATE = 1_000_000;
const MAX_DIMENSION = 10_000;
const MAX_ID_LENGTH = 160;
const MAX_LABEL_LENGTH = 240;
const MAX_POLYGON_POINTS = 256;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;

export type CartesianSceneMode = "configure" | "operate" | "read-only";

export type CartesianResourceNodeType =
  | "table"
  | "chair"
  | "bay"
  | "rack"
  | "seat"
  | "station"
  | "resource";

export interface CartesianScenePresentation {
  label: string;
  statusLabel: string;
  sublabel?: string;
  intent?: Intent;
  cogSuggested?: boolean;
  pending?: boolean;
}

export type CartesianScenePresentationMap = Readonly<
  Record<string, CartesianScenePresentation>
>;

export interface CartesianBounds extends CartesianCoordinate {
  width: number;
  height: number;
}

export interface CartesianZoneNodeData extends Record<string, unknown> {
  zoneId: string;
  label: string;
  width: number;
  height: number;
  rotation: number;
  polygonPoints?: readonly CartesianCoordinate[];
}

export interface CartesianPlacementNodeData extends Record<string, unknown> {
  placementId: string;
  entityRef: SceneEntityRef;
  label: string;
  statusLabel: string;
  sublabel?: string;
  intent: Intent;
  cogSuggested: boolean;
  pending: boolean;
  interactive: boolean;
  shapeKind: string;
  width: number;
  height: number;
  rotation: number;
}

export type CartesianSceneNodeDescriptor =
  | {
      id: string;
      kind: "zone";
      nodeType: "zone";
      position: CartesianCoordinate;
      absolutePosition: CartesianCoordinate;
      width: number;
      height: number;
      draggable: false;
      selectable: false;
      parentId?: undefined;
      zIndex: 0;
      data: CartesianZoneNodeData;
    }
  | {
      id: string;
      kind: "placement";
      nodeType: CartesianResourceNodeType;
      position: CartesianCoordinate;
      absolutePosition: CartesianCoordinate;
      width: number;
      height: number;
      draggable: boolean;
      selectable: boolean;
      parentId?: string;
      zIndex: 1;
      data: CartesianPlacementNodeData;
    };

export type CartesianSceneValidationResult =
  | { ok: true; value: CartesianSceneLayout }
  | { ok: false; error: string };

function validString(
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0)
  );
}

function validCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_COORDINATE
  );
}

function validDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_DIMENSION
  );
}

function validateRegionGeometry(
  value: unknown,
): CartesianRegionGeometry | null {
  if (!isRecord(value)) return null;
  if (value.kind === "rectangle") {
    if (
      !validCoordinate(value.x) ||
      !validCoordinate(value.y) ||
      !validDimension(value.width) ||
      !validDimension(value.height) ||
      (value.rotation !== undefined &&
        (typeof value.rotation !== "number" ||
          !Number.isFinite(value.rotation)))
    ) {
      return null;
    }
    return {
      kind: "rectangle",
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      ...(typeof value.rotation === "number"
        ? { rotation: value.rotation }
        : {}),
    };
  }
  if (
    value.kind !== "polygon" ||
    !Array.isArray(value.points) ||
    value.points.length < 3 ||
    value.points.length > MAX_POLYGON_POINTS
  ) {
    return null;
  }
  const points: CartesianCoordinate[] = [];
  for (const point of value.points) {
    if (
      !isRecord(point) ||
      !validCoordinate(point.x) ||
      !validCoordinate(point.y)
    ) {
      return null;
    }
    points.push({ x: point.x, y: point.y });
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  if (
    !validDimension(Math.max(...xs) - Math.min(...xs)) ||
    !validDimension(Math.max(...ys) - Math.min(...ys))
  ) {
    return null;
  }
  return { kind: "polygon", points };
}

function validatePlacementGeometry(
  value: unknown,
): CartesianPlacementGeometry | null {
  if (
    !isRecord(value) ||
    !validCoordinate(value.x) ||
    !validCoordinate(value.y) ||
    !validDimension(value.width) ||
    !validDimension(value.height) ||
    typeof value.rotation !== "number" ||
    !Number.isFinite(value.rotation) ||
    !validString(value.shapeKind, MAX_LABEL_LENGTH)
  ) {
    return null;
  }
  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    rotation: value.rotation,
    shapeKind: value.shapeKind.trim(),
  };
}

export function validateCartesianSceneLayout(
  value: unknown,
): CartesianSceneValidationResult {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.spaceKind !== "cartesian-interior"
  ) {
    return {
      ok: false,
      error: "The layout is not a cartesian operational scene.",
    };
  }
  if (
    !isRecord(value.viewport) ||
    !validCoordinate(value.viewport.x) ||
    !validCoordinate(value.viewport.y) ||
    typeof value.viewport.zoom !== "number" ||
    !Number.isFinite(value.viewport.zoom) ||
    value.viewport.zoom < MIN_ZOOM ||
    value.viewport.zoom > MAX_ZOOM
  ) {
    return { ok: false, error: "The layout viewport is invalid." };
  }
  if (!Array.isArray(value.zones) || !Array.isArray(value.placements)) {
    return { ok: false, error: "The layout zones and placements are required." };
  }
  if (value.zones.length > MAX_CARTESIAN_SCENE_ZONES) {
    return {
      ok: false,
      error: `A cartesian scene can show at most ${MAX_CARTESIAN_SCENE_ZONES} zones.`,
    };
  }
  if (value.placements.length > MAX_CARTESIAN_SCENE_PLACEMENTS) {
    return {
      ok: false,
      error: `A cartesian scene can show at most ${MAX_CARTESIAN_SCENE_PLACEMENTS} resources.`,
    };
  }

  const zoneIds = new Set<string>();
  const zones: CartesianSceneZone[] = [];
  for (const rawZone of value.zones) {
    if (
      !isRecord(rawZone) ||
      !validString(rawZone.id, MAX_ID_LENGTH) ||
      !validString(rawZone.label, MAX_LABEL_LENGTH)
    ) {
      return { ok: false, error: "Every zone needs a valid id and label." };
    }
    if (zoneIds.has(rawZone.id)) {
      return { ok: false, error: "Zone ids must be unique." };
    }
    const geometry = validateRegionGeometry(rawZone.geometry);
    if (!geometry) {
      return {
        ok: false,
        error: `Zone ${rawZone.id} has invalid geometry.`,
      };
    }
    zoneIds.add(rawZone.id);
    zones.push({
      id: rawZone.id,
      label: rawZone.label,
      geometry,
    });
  }

  const placementIds = new Set<string>();
  const placements: CartesianScenePlacement[] = [];
  for (const rawPlacement of value.placements) {
    if (
      !isRecord(rawPlacement) ||
      !validString(rawPlacement.id, MAX_ID_LENGTH)
    ) {
      return { ok: false, error: "Every placement needs a valid id." };
    }
    if (placementIds.has(rawPlacement.id)) {
      return { ok: false, error: "Placement ids must be unique." };
    }
    if (
      !isRecord(rawPlacement.entityRef) ||
      !validString(rawPlacement.entityRef.kind, MAX_ID_LENGTH) ||
      !validString(rawPlacement.entityRef.id, MAX_ID_LENGTH)
    ) {
      return {
        ok: false,
        error: `Placement ${rawPlacement.id} has an invalid entity reference.`,
      };
    }
    if (
      rawPlacement.label !== undefined &&
      !validString(rawPlacement.label, MAX_LABEL_LENGTH)
    ) {
      return {
        ok: false,
        error: `Placement ${rawPlacement.id} has an invalid label.`,
      };
    }
    const geometry = validatePlacementGeometry(rawPlacement.geometry);
    if (!geometry) {
      return {
        ok: false,
        error: `Placement ${rawPlacement.id} has invalid geometry.`,
      };
    }
    placementIds.add(rawPlacement.id);
    placements.push({
      id: rawPlacement.id,
      ...(typeof rawPlacement.label === "string"
        ? { label: rawPlacement.label }
        : {}),
      entityRef: {
        kind: rawPlacement.entityRef.kind,
        id: rawPlacement.entityRef.id,
      },
      geometry,
    });
  }

  if (
    value.underlayRef !== undefined &&
    !validString(value.underlayRef, 2_048)
  ) {
    return { ok: false, error: "The floor-plan reference is invalid." };
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      spaceKind: "cartesian-interior",
      viewport: {
        x: value.viewport.x,
        y: value.viewport.y,
        zoom: value.viewport.zoom,
      },
      zones,
      placements,
      ...(typeof value.underlayRef === "string"
        ? { underlayRef: value.underlayRef }
        : {}),
    },
  };
}

export function sceneEntityRefKey(ref: SceneEntityRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function resolveCartesianResourceNodeType(
  shapeKind: string,
): CartesianResourceNodeType {
  const normalized = shapeKind.trim().toLowerCase();
  if (/(^|[-_\s])table($|[-_\s])/.test(normalized)) return "table";
  if (/(^|[-_\s])chair($|[-_\s])/.test(normalized)) return "chair";
  if (/(^|[-_\s])bay($|[-_\s])/.test(normalized)) return "bay";
  if (/(^|[-_\s])rack($|[-_\s])/.test(normalized)) return "rack";
  if (/(^|[-_\s])seat($|[-_\s])/.test(normalized)) return "seat";
  if (/(^|[-_\s])station($|[-_\s])/.test(normalized)) return "station";
  return "resource";
}

export function cartesianZoneBounds(
  geometry: CartesianRegionGeometry,
): CartesianBounds {
  if (geometry.kind === "rectangle") {
    return {
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
    };
  }
  const xs = geometry.points.map((point) => point.x);
  const ys = geometry.points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function pointInPolygon(
  point: CartesianCoordinate,
  polygon: readonly CartesianCoordinate[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x <
        ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) +
          a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function zoneContainsPoint(
  zone: CartesianSceneZone,
  point: CartesianCoordinate,
): boolean {
  if (zone.geometry.kind === "polygon") {
    return pointInPolygon(point, zone.geometry.points);
  }
  const { x, y, width, height, rotation = 0 } = zone.geometry;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const radians = (-rotation * Math.PI) / 180;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  const localX = centerX + dx * Math.cos(radians) - dy * Math.sin(radians);
  const localY = centerY + dx * Math.sin(radians) + dy * Math.cos(radians);
  return (
    localX >= x &&
    localX <= x + width &&
    localY >= y &&
    localY <= y + height
  );
}

export function findContainingZoneId(
  zones: readonly CartesianSceneZone[],
  placement: CartesianScenePlacement,
): string | undefined {
  const center = {
    x: placement.geometry.x + placement.geometry.width / 2,
    y: placement.geometry.y + placement.geometry.height / 2,
  };
  return zones
    .filter((zone) => zoneContainsPoint(zone, center))
    .map((zone) => {
      const bounds = cartesianZoneBounds(zone.geometry);
      return { id: zone.id, area: bounds.width * bounds.height };
    })
    .sort((a, b) => a.area - b.area || a.id.localeCompare(b.id))[0]?.id;
}

export function sceneToCartesianNodeDescriptors(
  scene: CartesianSceneLayout,
  options: {
    mode: CartesianSceneMode;
    bindings?: CartesianScenePresentationMap;
  },
): CartesianSceneNodeDescriptor[] {
  const zoneById = new Map(scene.zones.map((zone) => [zone.id, zone]));
  const zones: CartesianSceneNodeDescriptor[] = scene.zones.map((zone) => {
    const bounds = cartesianZoneBounds(zone.geometry);
    return {
      id: `scene-zone:${zone.id}`,
      kind: "zone",
      nodeType: "zone",
      position: { x: bounds.x, y: bounds.y },
      absolutePosition: { x: bounds.x, y: bounds.y },
      width: bounds.width,
      height: bounds.height,
      draggable: false,
      selectable: false,
      zIndex: 0,
      data: {
        zoneId: zone.id,
        label: zone.label,
        width: bounds.width,
        height: bounds.height,
        rotation:
          zone.geometry.kind === "rectangle"
            ? (zone.geometry.rotation ?? 0)
            : 0,
        ...(zone.geometry.kind === "polygon"
          ? {
              polygonPoints: zone.geometry.points.map((point) => ({
                x: point.x - bounds.x,
                y: point.y - bounds.y,
              })),
            }
          : {}),
      },
    };
  });

  const placements: CartesianSceneNodeDescriptor[] = scene.placements.map(
    (placement) => {
      const binding = options.bindings?.[sceneEntityRefKey(placement.entityRef)];
      const zoneId = findContainingZoneId(scene.zones, placement);
      const zone = zoneId ? zoneById.get(zoneId) : undefined;
      const zoneBounds = zone ? cartesianZoneBounds(zone.geometry) : undefined;
      const absolutePosition = {
        x: placement.geometry.x,
        y: placement.geometry.y,
      };
      return {
        id: `scene-placement:${placement.id}`,
        kind: "placement",
        nodeType: resolveCartesianResourceNodeType(
          placement.geometry.shapeKind,
        ),
        position: zoneBounds
          ? {
              x: absolutePosition.x - zoneBounds.x,
              y: absolutePosition.y - zoneBounds.y,
            }
          : absolutePosition,
        absolutePosition,
        width: placement.geometry.width,
        height: placement.geometry.height,
        draggable: options.mode === "configure",
        selectable: options.mode !== "read-only",
        ...(zoneId ? { parentId: `scene-zone:${zoneId}` } : {}),
        zIndex: 1,
        data: {
          placementId: placement.id,
          entityRef: placement.entityRef,
          label: binding?.label ?? placement.label ?? placement.id,
          statusLabel:
            binding?.statusLabel ??
            (options.mode === "configure"
              ? "Ready to position"
              : "Status unavailable"),
          ...(binding?.sublabel ? { sublabel: binding.sublabel } : {}),
          intent: binding?.intent ?? "neutral",
          cogSuggested: binding?.cogSuggested ?? false,
          pending: binding?.pending ?? false,
          interactive: options.mode === "operate",
          shapeKind: placement.geometry.shapeKind,
          width: placement.geometry.width,
          height: placement.geometry.height,
          rotation: placement.geometry.rotation,
        },
      };
    },
  );

  return [...zones, ...placements];
}

export function nudgeCartesianPlacement(
  scene: CartesianSceneLayout,
  placementId: string,
  absolutePosition: CartesianCoordinate,
): CartesianSceneLayout {
  const index = scene.placements.findIndex(
    (placement) => placement.id === placementId,
  );
  if (index < 0) return scene;
  const placements = [...scene.placements];
  const placement = placements[index]!;
  placements[index] = {
    ...placement,
    geometry: {
      ...placement.geometry,
      x: absolutePosition.x,
      y: absolutePosition.y,
    },
  };
  return { ...scene, placements };
}
