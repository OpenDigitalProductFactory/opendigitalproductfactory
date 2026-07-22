// apps/web/lib/storefront/floor-layout.test.ts
import { describe, expect, it } from "vitest";

import {
  inferSectionShape,
  layoutRestaurantFloor,
  tableSize,
  type FloorSection,
} from "./floor-layout";
import type { RestaurantTable, TableCapacityState } from "./restaurant-capacity";

function table(
  label: string,
  state: TableCapacityState = "available",
  seats: number | null = 2,
  freeInMinutes: number | null = null,
): RestaurantTable {
  return { key: label.toLowerCase().replace(/\s+/g, "-"), label, seats, state, freeInMinutes };
}

describe("inferSectionShape", () => {
  it("routes seating vocabulary to sections without any new data", () => {
    expect(inferSectionShape("Window 2").section).toBe<FloorSection>("window");
    expect(inferSectionShape("Patio 5").section).toBe<FloorSection>("patio");
    expect(inferSectionShape("Bar seat 3").section).toBe<FloorSection>("bar");
    expect(inferSectionShape("Booth 1").section).toBe<FloorSection>("booth");
    expect(inferSectionShape("Table 4").section).toBe<FloorSection>("main");
  });

  it("gives the bar and booth their own shapes", () => {
    expect(inferSectionShape("Bar seat 3").shape).toBe("bar");
    expect(inferSectionShape("Booth 1").shape).toBe("booth");
    expect(inferSectionShape("Table 4").shape).toBe("round");
  });
});

describe("tableSize", () => {
  it("scales with seats and is null-safe", () => {
    const two = tableSize(2, "round");
    const eight = tableSize(8, "round");
    expect(eight.w).toBeGreaterThan(two.w);
    expect(tableSize(null, "round")).toEqual(tableSize(2, "round"));
  });

  it("clamps within shape bounds", () => {
    expect(tableSize(999, "round").w).toBeLessThanOrEqual(132);
    expect(tableSize(0, "round").w).toBeGreaterThanOrEqual(64);
    expect(tableSize(6, "booth").h).toBe(84);
  });
});

describe("layoutRestaurantFloor", () => {
  it("is total on an empty install", () => {
    const scene = layoutRestaurantFloor([]);
    expect(scene.placements).toHaveLength(0);
    expect(scene.zones).toHaveLength(0);
    expect(scene.width).toBeGreaterThan(0);
    expect(scene.height).toBeGreaterThan(0);
  });

  it("places every table exactly once and carries its live state through", () => {
    const tables = [
      table("Table 1", "available"),
      table("Table 2", "occupied"),
      table("Window 1", "turning-soon", 2, 8),
      table("Booth 3", "blocked", 6),
    ];
    const scene = layoutRestaurantFloor(tables);
    expect(scene.placements).toHaveLength(4);
    expect(new Set(scene.placements.map((p) => p.key)).size).toBe(4);
    const turning = scene.placements.find((p) => p.key === "window-1")!;
    expect(turning.state).toBe("turning-soon");
    expect(turning.freeInMinutes).toBe(8);
    expect(turning.stateLabel).toBe("Turning soon");
  });

  it("clusters tables into stable, non-overlapping section bands", () => {
    const tables = [table("Table 1"), table("Window 1"), table("Bar seat 1"), table("Booth 1")];
    const scene = layoutRestaurantFloor(tables);
    const sections = scene.zones.map((z) => z.section);
    // Window before main before booth before bar — the fixed SECTION_ORDER.
    expect(sections).toEqual(["window", "main", "booth", "bar"]);
    // Bands do not vertically overlap.
    for (let i = 1; i < scene.zones.length; i++) {
      expect(scene.zones[i].y).toBeGreaterThanOrEqual(scene.zones[i - 1].y + scene.zones[i - 1].h);
    }
  });

  it("wraps a section to multiple rows past the column count", () => {
    const many = Array.from({ length: 15 }, (_, i) => table(`Table ${i + 1}`));
    const scene = layoutRestaurantFloor(many, { cols: 6 });
    expect(scene.placements).toHaveLength(15);
    const rowYs = new Set(scene.placements.map((p) => Math.round(p.y / 10)));
    expect(rowYs.size).toBeGreaterThanOrEqual(3); // 15 / 6 -> 3 rows
  });

  it("is deterministic", () => {
    const tables = [table("Table 1"), table("Window 1"), table("Booth 2", "occupied", 6)];
    expect(layoutRestaurantFloor(tables)).toEqual(layoutRestaurantFloor(tables));
  });
});
