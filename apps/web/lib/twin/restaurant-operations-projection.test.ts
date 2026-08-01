import { describe, expect, it } from "vitest";

import type { RestaurantCapacitySnapshot } from "@/lib/storefront/restaurant-capacity";

import { restaurantFloorResourceUnits } from "./restaurant-operations-projection";

describe("restaurantFloorResourceUnits", () => {
  it("projects occupied and turning state instead of treating every active resource as available", () => {
    const snapshot = {
      tables: [
        {
          key: "table-1",
          label: "Aster",
          seats: 4,
          state: "occupied",
          freeInMinutes: null,
        },
        {
          key: "table-2",
          label: "Birch",
          seats: 2,
          state: "turning-soon",
          freeInMinutes: 8,
        },
      ],
    } as RestaurantCapacitySnapshot;

    expect(restaurantFloorResourceUnits(snapshot)).toEqual([
      {
        key: "table-1",
        label: "Aster",
        state: "Occupied",
        intent: "info",
        sublabel: "4 seats",
      },
      {
        key: "table-2",
        label: "Birch",
        state: "Turning soon",
        intent: "warning",
        sublabel: "2 seats · free in 8m",
      },
    ]);
  });
});
