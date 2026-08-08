import type { CartesianSceneLayout } from "@dpf/storefront-templates";

import { parseRestaurantTableAttributes } from "../storefront/restaurant-table-attributes";
import { validateCartesianSceneLayout } from "./cartesian-scene";

export interface RestaurantSceneTable {
  id: string;
  label: string;
  capacity: number;
  serviceArea: string | null;
  attributes?: unknown;
}

export interface RestaurantOperationalScene {
  id: string;
  version: number;
  layout: CartesianSceneLayout;
  createdFromStarter: boolean;
}

interface SceneRow {
  id: string;
  version: number;
  layoutState: unknown;
}

export interface OperationalSceneLayoutDatabase {
  operationalSceneLayout: {
    findUnique(input: {
      where: {
        orgId_twinTemplate_locationId: {
          orgId: string;
          twinTemplate: "FLOOR";
          locationId: string;
        };
      };
      select: { id: true; version: true; layoutState: true };
    }): Promise<SceneRow | null>;
    create(input: {
      data: {
        orgId: string;
        twinTemplate: "FLOOR";
        spaceKind: "cartesian-interior";
        locationId: string;
        label: string;
        layoutState: CartesianSceneLayout;
      };
      select: { id: true; version: true; layoutState: true };
    }): Promise<SceneRow>;
    updateMany(input: {
      where: { id: string; version: number };
      data: {
        layoutState: CartesianSceneLayout;
        underlayRef: string | null;
        version: { increment: 1 };
      };
    }): Promise<{ count: number }>;
  };
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "area";
}

function footprint(capacity: number, shape: string) {
  const seats = Math.max(1, Math.min(capacity, 12));
  if (shape === "booth") {
    return { width: Math.min(152, 96 + seats * 7), height: 72 };
  }
  if (shape === "bar") {
    return { width: Math.min(160, 88 + seats * 8), height: 52 };
  }
  if (shape === "rectangle") {
    return { width: Math.min(144, 88 + seats * 7), height: 72 };
  }
  const side = Math.min(104, 64 + seats * 5);
  return { width: side, height: side };
}

/**
 * Deterministic first layout for a newly configured restaurant. It is a starter,
 * not an inferred authority: the persisted row becomes authoritative as soon as
 * it is created and every later move is version-saved.
 */
export function buildRestaurantStarterScene(
  sourceTables: readonly RestaurantSceneTable[],
): CartesianSceneLayout {
  const tables = [...sourceTables].sort(
    (a, b) =>
      (a.serviceArea?.trim() || "Unassigned area").localeCompare(
        b.serviceArea?.trim() || "Unassigned area",
      ) ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id),
  );
  const byArea = new Map<string, RestaurantSceneTable[]>();
  for (const table of tables) {
    const area = table.serviceArea?.trim() || "Unassigned area";
    const group = byArea.get(area) ?? [];
    group.push(table);
    byArea.set(area, group);
  }

  const areas = [...byArea.entries()].sort(
    ([leftArea, left], [rightArea, right]) =>
      right.length - left.length || leftArea.localeCompare(rightArea),
  );
  const zoneDrafts = areas.map(([area, group], areaIndex) => {
    const columns = Math.min(4, Math.max(1, group.length));
    const rows = Math.ceil(group.length / columns);
    return {
      area,
      group,
      areaIndex,
      columns,
      width: Math.max(320, columns * 168 + 64),
      height: Math.max(220, rows * 136 + 84),
    };
  });
  const primaryWidth = zoneDrafts[0]?.width ?? 320;
  let adjacentY = 0;
  const zones: CartesianSceneLayout["zones"][number][] = [];
  const placements: CartesianSceneLayout["placements"][number][] = [];
  for (const draft of zoneDrafts) {
    const { area, group, areaIndex, columns, width, height } = draft;
    const x = areaIndex === 0 ? 0 : primaryWidth + 32;
    const y = areaIndex === 0 ? 0 : adjacentY;
    if (areaIndex > 0) adjacentY += height + 32;
    const zoneId = `${slug(area)}-${areaIndex + 1}`;
    zones.push({
      id: zoneId,
      label: area,
      geometry: {
        kind: "rectangle",
        x,
        y,
        width,
        height,
      },
    });
    group.forEach((table, index) => {
      const attributes = parseRestaurantTableAttributes(table.attributes);
      const { width, height } = footprint(
        table.capacity,
        attributes.shape,
      );
      const column = index % columns;
      const row = Math.floor(index / columns);
      placements.push({
        id: `table-placement-${table.id}`,
        label: table.label,
        entityRef: { kind: "table", id: table.id },
        geometry: {
          x: x + 32 + column * 168,
          y: y + 52 + row * 136,
          width,
          height,
          rotation: 0,
          shapeKind: `${attributes.shape}-table`,
        },
      });
    });
  }

  return {
    schemaVersion: 1,
    spaceKind: "cartesian-interior",
    viewport: { x: 24, y: 24, zoom: areas.length > 1 ? 0.78 : 0.9 },
    zones,
    placements,
  };
}

function isLegacyUnassignedStarter(
  layout: CartesianSceneLayout,
  tables: readonly RestaurantSceneTable[],
): boolean {
  if (
    layout.zones.length !== 1 ||
    layout.zones[0]?.label.trim().toLowerCase() !== "unassigned area" ||
    !tables.some((table) => Boolean(table.serviceArea?.trim()))
  ) {
    return false;
  }
  const expected = new Set(tables.map((table) => table.id));
  const placed = layout.placements
    .filter((placement) => placement.entityRef.kind === "table")
    .map((placement) => placement.entityRef.id);
  return placed.length === expected.size && placed.every((id) => expected.has(id));
}

function parseScene(row: SceneRow, createdFromStarter: boolean) {
  const validated = validateCartesianSceneLayout(row.layoutState);
  if (!validated.ok) {
    throw new Error(
      `The saved restaurant floor layout is invalid: ${validated.error}`,
    );
  }
  return {
    id: row.id,
    version: row.version,
    layout: validated.value,
    createdFromStarter,
  } satisfies RestaurantOperationalScene;
}

function uniqueId(seed: string, used: Set<string>): string {
  let candidate = seed;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${seed}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function appendMissingTables(
  layout: CartesianSceneLayout,
  tables: readonly RestaurantSceneTable[],
): CartesianSceneLayout {
  const placed = new Set(
    layout.placements
      .filter((placement) => placement.entityRef.kind === "table")
      .map((placement) => placement.entityRef.id),
  );
  const missing = tables.filter((table) => !placed.has(table.id));
  if (missing.length === 0) return layout;

  const starter = buildRestaurantStarterScene(missing);
  const maxBottom = Math.max(
    0,
    ...layout.zones.map((zone) =>
      zone.geometry.kind === "rectangle"
        ? zone.geometry.y + zone.geometry.height
        : Math.max(...zone.geometry.points.map((point) => point.y)),
    ),
    ...layout.placements.map(
      (placement) =>
        placement.geometry.y + placement.geometry.height,
    ),
  );
  const yOffset = maxBottom + 32;
  const zoneIds = new Set(layout.zones.map((zone) => zone.id));
  const placementIds = new Set(
    layout.placements.map((placement) => placement.id),
  );
  const appendedZones = starter.zones.map((zone) => {
    const id = uniqueId(`new-${zone.id}`, zoneIds);
    return {
      ...zone,
      id,
      label: `${zone.label} · new tables`,
      geometry:
        zone.geometry.kind === "rectangle"
          ? { ...zone.geometry, y: zone.geometry.y + yOffset }
          : {
              ...zone.geometry,
              points: zone.geometry.points.map((point) => ({
                ...point,
                y: point.y + yOffset,
              })),
            },
    };
  });
  const appendedPlacements = starter.placements.map((placement) => ({
    ...placement,
    id: uniqueId(`new-${placement.id}`, placementIds),
    geometry: {
      ...placement.geometry,
      y: placement.geometry.y + yOffset,
    },
  }));
  return {
    ...layout,
    zones: [...layout.zones, ...appendedZones],
    placements: [...layout.placements, ...appendedPlacements],
  };
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function loadOrCreateRestaurantScene(input: {
  database: OperationalSceneLayoutDatabase;
  orgId: string;
  locationId: string;
  locationLabel: string;
  tables: readonly RestaurantSceneTable[];
}): Promise<RestaurantOperationalScene> {
  const key = {
    orgId: input.orgId,
    twinTemplate: "FLOOR" as const,
    locationId: input.locationId,
  };
  const select = { id: true, version: true, layoutState: true } as const;
  const existing = await input.database.operationalSceneLayout.findUnique({
    where: { orgId_twinTemplate_locationId: key },
    select,
  });
  if (existing) {
    const parsed = parseScene(existing, false);
    const reconciled = isLegacyUnassignedStarter(parsed.layout, input.tables)
      ? buildRestaurantStarterScene(input.tables)
      : appendMissingTables(parsed.layout, input.tables);
    if (reconciled === parsed.layout) return parsed;
    const update =
      await input.database.operationalSceneLayout.updateMany({
        where: { id: parsed.id, version: parsed.version },
        data: {
          layoutState: reconciled,
          underlayRef: reconciled.underlayRef ?? null,
          version: { increment: 1 },
        },
      });
    if (update.count === 1) {
      return {
        ...parsed,
        version: parsed.version + 1,
        layout: reconciled,
      };
    }
    const winner = await input.database.operationalSceneLayout.findUnique({
      where: { orgId_twinTemplate_locationId: key },
      select,
    });
    if (!winner) throw new Error("The restaurant floor layout disappeared.");
    return parseScene(winner, false);
  }

  const layout = buildRestaurantStarterScene(input.tables);
  try {
    const created = await input.database.operationalSceneLayout.create({
      data: {
        ...key,
        spaceKind: "cartesian-interior",
        label: input.locationLabel.trim() || "Restaurant floor",
        layoutState: layout,
      },
      select,
    });
    return parseScene(created, true);
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const winner = await input.database.operationalSceneLayout.findUnique({
      where: { orgId_twinTemplate_locationId: key },
      select,
    });
    if (!winner) throw error;
    return parseScene(winner, false);
  }
}
