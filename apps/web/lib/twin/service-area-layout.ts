// Service areas (BI-6CC10E4C) are the zones of the organization's TERRITORY
// geographic layout with no location. Saving replaces only the zones, keeps any
// placements another feature stored, and is guarded by the layout version so a
// stale editor cannot overwrite a newer save.

import type { GeographicSceneLayout, GeographicSceneZone } from "@dpf/storefront-templates";

import { geographicBounds, validateGeographicSceneLayout } from "./geographic-scene";

export const SERVICE_AREA_TWIN_TEMPLATE = "TERRITORY";
const WORLD_VIEWPORT = { latitude: 20, longitude: 0, zoom: 1 } as const;

export interface ServiceAreaRow {
  id: string;
  version: number;
  layoutState: unknown;
}

export interface ServiceAreaDatabase {
  operationalSceneLayout: {
    findFirst(input: {
      where: { orgId: string; twinTemplate: string; locationId: null; spaceKind: "geographic" };
      orderBy: { createdAt: "asc" };
      select: { id: true; version: true; layoutState: true };
    }): Promise<ServiceAreaRow | null>;
    create(input: {
      data: {
        orgId: string;
        twinTemplate: string;
        spaceKind: "geographic";
        locationId: null;
        label: string;
        layoutState: GeographicSceneLayout;
      };
    }): Promise<{ version: number }>;
    updateMany(input: {
      where: { id: string; orgId: string; version: number };
      data: { layoutState: GeographicSceneLayout; version: { increment: 1 } };
    }): Promise<{ count: number }>;
  };
}

export interface ServiceAreas {
  /** 0 when the organization has never saved an area. */
  version: number;
  zones: readonly GeographicSceneZone[];
}

function existingLayout(row: ServiceAreaRow | null): GeographicSceneLayout | null {
  if (!row) return null;
  const validated = validateGeographicSceneLayout(row.layoutState);
  return validated.ok ? validated.value : null;
}

export async function loadServiceAreas(database: ServiceAreaDatabase, orgId: string): Promise<ServiceAreas> {
  const row = await database.operationalSceneLayout.findFirst({
    where: { orgId, twinTemplate: SERVICE_AREA_TWIN_TEMPLATE, locationId: null, spaceKind: "geographic" },
    orderBy: { createdAt: "asc" },
    select: { id: true, version: true, layoutState: true },
  });
  return { version: row?.version ?? 0, zones: existingLayout(row)?.zones ?? [] };
}

export type SaveServiceAreasResult =
  | { ok: true; version: number }
  | { ok: false; code: "invalid" | "stale"; error: string };

function viewportFor(zones: readonly GeographicSceneZone[]): GeographicSceneLayout["viewport"] {
  const points = zones.flatMap((zone) => zone.geometry.rings.flat());
  if (points.length === 0) return WORLD_VIEWPORT;
  const bounds = geographicBounds(points);
  return { latitude: (bounds.south + bounds.north) / 2, longitude: (bounds.west + bounds.east) / 2, zoom: 9 };
}

export async function saveServiceAreas(
  database: ServiceAreaDatabase,
  input: { orgId: string; expectedVersion: number; zones: unknown },
): Promise<SaveServiceAreasResult> {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || !Array.isArray(input.zones)) {
    return { ok: false, code: "invalid", error: "invalid-request" };
  }
  const row = await database.operationalSceneLayout.findFirst({
    where: { orgId: input.orgId, twinTemplate: SERVICE_AREA_TWIN_TEMPLATE, locationId: null, spaceKind: "geographic" },
    orderBy: { createdAt: "asc" },
    select: { id: true, version: true, layoutState: true },
  });
  if ((row?.version ?? 0) !== input.expectedVersion) return { ok: false, code: "stale", error: "stale" };

  const previous = existingLayout(row);
  const candidate = {
    schemaVersion: 1,
    spaceKind: "geographic",
    viewport: previous?.viewport ?? WORLD_VIEWPORT,
    zones: input.zones,
    placements: previous?.placements ?? [],
    ...(previous?.underlayRef ? { underlayRef: previous.underlayRef } : {}),
  };
  const validated = validateGeographicSceneLayout(candidate);
  if (!validated.ok) return { ok: false, code: "invalid", error: validated.error };
  const layout: GeographicSceneLayout = previous
    ? validated.value
    : { ...validated.value, viewport: viewportFor(validated.value.zones) };

  if (!row) {
    const created = await database.operationalSceneLayout.create({
      data: {
        orgId: input.orgId,
        twinTemplate: SERVICE_AREA_TWIN_TEMPLATE,
        spaceKind: "geographic",
        locationId: null,
        label: "Service areas",
        layoutState: layout,
      },
    });
    return { ok: true, version: created.version };
  }
  const update = await database.operationalSceneLayout.updateMany({
    where: { id: row.id, orgId: input.orgId, version: input.expectedVersion },
    data: { layoutState: layout, version: { increment: 1 } },
  });
  return update.count === 1
    ? { ok: true, version: input.expectedVersion + 1 }
    : { ok: false, code: "stale", error: "stale" };
}
