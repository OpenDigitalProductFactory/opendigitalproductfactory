// apps/web/lib/storefront/floor-layout.ts
//
// Pure, deterministic auto-layout that turns the live `RestaurantTable[]`
// capacity projection (restaurant-capacity.ts) into a positioned floor-plan
// scene. This is the FLOOR renderer's geometry seam (EP-SPATIAL-OPERATIONAL-VIEWS,
// BI-287AA5F7): live *state* stays a projection; *geometry* is derived here for
// the read-only "operate" facsimile. When persisted operator geometry lands
// (OperationalSceneLayout, increment 2), `layoutRestaurantFloor` becomes the
// fallback for tables the operator has not yet placed by hand.
//
// No new data: section + shape are inferred from the operator's own table label
// (the same naming the capacity classifier already relies on), so the plan is
// legible on day one with zero configuration.
//
// Spec: docs/superpowers/specs/2026-07-21-spatial-operational-views-design.md §3–4

import type { Intent } from "@/components/ui/report-kit/statusColors";

import {
  capacityStateIntent,
  capacityStateLabel,
  type RestaurantTable,
  type TableCapacityState,
} from "./restaurant-capacity";

export type FloorShape = "round" | "square" | "booth" | "bar";
export type FloorSection = "window" | "main" | "booth" | "bar" | "patio";

/** One positioned table on the floor, ready for the cartesian renderer. */
export interface FloorPlacement {
  key: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: FloorShape;
  section: FloorSection;
  seats: number | null;
  state: TableCapacityState;
  stateLabel: string;
  intent: Intent;
  /** Minutes until a `turning-soon` table frees; null otherwise. */
  freeInMinutes: number | null;
}

/** A named region the tables cluster into (rendered as a soft backdrop). */
export interface FloorZone {
  section: FloorSection;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloorScene {
  placements: FloorPlacement[];
  zones: FloorZone[];
  width: number;
  height: number;
}

const SECTION_ORDER: readonly FloorSection[] = ["window", "main", "booth", "bar", "patio"];

const SECTION_LABEL: Record<FloorSection, string> = {
  window: "Window & terrace",
  main: "Dining room",
  booth: "Booths",
  bar: "Bar & counter",
  patio: "Patio",
};

// Section/shape inferred from the operator's own label — deterministic, no new
// field. Mirrors the seating vocabulary the capacity classifier already knows.
const SECTION_RULES: { rx: RegExp; section: FloorSection; shape: FloorShape }[] = [
  { rx: /\b(window|terrace)\b/i, section: "window", shape: "square" },
  { rx: /\b(patio|garden|outdoor)\b/i, section: "patio", shape: "round" },
  { rx: /\b(bar|counter)\b/i, section: "bar", shape: "bar" },
  { rx: /\b(booth|banquette|nook)\b/i, section: "booth", shape: "booth" },
];

export function inferSectionShape(label: string): { section: FloorSection; shape: FloorShape } {
  for (const rule of SECTION_RULES) {
    if (rule.rx.test(label)) return { section: rule.section, shape: rule.shape };
  }
  return { section: "main", shape: "round" };
}

const COLS = 6;
const CELL_W = 172;
const CELL_H = 150;
const SECTION_GAP = 72;
const PAD = 48;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Table footprint scales with seat count and shape. Total, seat-null-safe. */
export function tableSize(seats: number | null, shape: FloorShape): { w: number; h: number } {
  const s = seats && seats > 0 ? seats : 2;
  if (shape === "booth") return { w: clamp(112 + s * 8, 112, 208), h: 84 };
  if (shape === "bar") return { w: clamp(96 + s * 10, 96, 224), h: 58 };
  const side = clamp(64 + s * 7, 64, 132); // round / square
  return { w: side, h: side };
}

/**
 * Lay the configured tables into a legible floor plan. Deterministic and total:
 * the same tables always yield the same scene; an empty list yields an empty
 * scene with the outer padding preserved. Sections appear only when populated,
 * in a stable order, each as a clustered band of tables.
 */
export function layoutRestaurantFloor(
  tables: RestaurantTable[],
  opts?: { cols?: number },
): FloorScene {
  const cols = Math.max(1, opts?.cols ?? COLS);

  const bySection = new Map<FloorSection, { table: RestaurantTable; shape: FloorShape }[]>();
  for (const table of tables) {
    const { section, shape } = inferSectionShape(table.label);
    const bucket = bySection.get(section);
    if (bucket) bucket.push({ table, shape });
    else bySection.set(section, [{ table, shape }]);
  }

  const placements: FloorPlacement[] = [];
  const zones: FloorZone[] = [];
  let y = PAD;

  for (const section of SECTION_ORDER) {
    const group = bySection.get(section);
    if (!group || group.length === 0) continue;

    const rows = Math.ceil(group.length / cols);
    const zoneTop = y - 12;

    group.forEach(({ table, shape }, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const size = tableSize(table.seats, shape);
      const x = PAD + col * CELL_W + (CELL_W - size.w) / 2;
      const ty = y + row * CELL_H + (CELL_H - size.h) / 2;
      placements.push({
        key: table.key,
        label: table.label,
        x,
        y: ty,
        w: size.w,
        h: size.h,
        shape,
        section,
        seats: table.seats,
        state: table.state,
        stateLabel: capacityStateLabel(table.state),
        intent: capacityStateIntent(table.state),
        freeInMinutes: table.freeInMinutes,
      });
    });

    const zoneH = rows * CELL_H;
    zones.push({
      section,
      label: SECTION_LABEL[section],
      x: PAD - 20,
      y: zoneTop,
      w: cols * CELL_W,
      h: zoneH + 20,
    });
    y += zoneH + SECTION_GAP;
  }

  return {
    placements,
    zones,
    width: PAD * 2 + cols * CELL_W,
    height: placements.length === 0 ? PAD * 2 : y - SECTION_GAP + PAD,
  };
}
