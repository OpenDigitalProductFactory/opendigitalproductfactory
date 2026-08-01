import { describe, expect, it } from "vitest";

import type { RestaurantFloorProjection } from "./restaurant-floor-projection";
import {
  deriveRestaurantHostPulse,
  rankRestaurantDemand,
} from "./restaurant-host-console";

const floor = {
  asOf: "2026-08-01T18:20:00.000Z",
  staffingAvailable: true,
  tables: [
    { state: "available", timing: null },
    { state: "ordered", timing: { kind: "turning", minutes: 8 } },
    { state: "dirty", timing: null },
    { state: "late-turn", timing: { kind: "late", minutes: 12 } },
  ],
  demand: [
    {
      id: "walk-in",
      kind: "walk-in",
      name: "Walk-in party",
      covers: 2,
      waitedMinutes: 22,
      scheduledAt: null,
      hasDietaryNote: false,
      vip: false,
      compatibleTableIds: [],
      recommendation: null,
    },
    {
      id: "late-reservation",
      kind: "reservation",
      name: "Late reservation",
      covers: 4,
      waitedMinutes: null,
      scheduledAt: "2026-08-01T17:55:00.000Z",
      hasDietaryNote: false,
      vip: false,
      compatibleTableIds: [],
      recommendation: null,
    },
  ],
} as unknown as RestaurantFloorProjection;

describe("restaurant host console selectors", () => {
  it("puts an overdue reservation ahead of a long-waiting walk-in", () => {
    expect(rankRestaurantDemand(floor).map((demand) => demand.id)).toEqual([
      "late-reservation",
      "walk-in",
    ]);
  });

  it("summarizes the first-screen pressure signals", () => {
    expect(deriveRestaurantHostPulse(floor)).toEqual({
      waiting: 2,
      availableNow: 1,
      turningSoon: 1,
      needsAction: 2,
    });
  });
});
