import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  aggregateBusinessMetrics,
  buildRestaurantMetricRows,
  restaurantMetricWindow,
} from "./business-metric-rollup";

const at = new Date("2026-08-01T02:00:00.000Z");

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-01T03:00:00.000Z"));
});

afterAll(() => vi.useRealTimers());

describe("restaurantMetricWindow", () => {
  it("uses the business timezone rather than UTC day boundaries", () => {
    expect(restaurantMetricWindow(at, "America/Chicago")).toEqual({
      periodKey: "2026-07-31",
      start: new Date("2026-07-31T05:00:00.000Z"),
      end: new Date("2026-08-01T05:00:00.000Z"),
      timezone: "America/Chicago",
    });
  });

  it("preserves a local business date across a daylight-saving transition", () => {
    const window = restaurantMetricWindow(
      new Date("2026-03-08T18:00:00.000Z"),
      "America/Chicago",
    );
    expect(window).toMatchObject({
      periodKey: "2026-03-08",
      start: new Date("2026-03-08T06:00:00.000Z"),
      end: new Date("2026-03-09T05:00:00.000Z"),
    });
    expect(window.end.getTime() - window.start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});

describe("buildRestaurantMetricRows", () => {
  it("derives only metrics supported by canonical restaurant evidence", () => {
    const window = restaurantMetricWindow(at, "America/Chicago");
    const rows = buildRestaurantMetricRows({
      organizationId: "org-1",
      storefrontId: "sf-1",
      window,
      computedAt: at,
      hoursConfirmedAt: new Date("2026-01-01T00:00:00.000Z"),
      businessHours: {
        friday: { open: "17:00", close: "23:00" },
      },
      resources: [
        { id: "table-1", kind: "table", status: "active" },
        { id: "table-2", kind: "table", status: "active" },
      ],
      serviceTurns: [
        {
          id: "turn-1",
          startedAt: new Date("2026-07-31T23:00:00.000Z"),
          closedAt: new Date("2026-08-01T00:00:00.000Z"),
          covers: 4,
        },
        {
          id: "turn-2",
          startedAt: new Date("2026-08-01T00:30:00.000Z"),
          closedAt: new Date("2026-08-01T02:00:00.000Z"),
          covers: 2,
        },
      ],
      allocations: [
        {
          resourceId: "table-1",
          serviceTurnId: "turn-1",
          startsAt: new Date("2026-07-31T23:00:00.000Z"),
          endsAt: new Date("2026-08-01T00:00:00.000Z"),
        },
        {
          resourceId: "table-2",
          serviceTurnId: "turn-2",
          startsAt: new Date("2026-08-01T00:30:00.000Z"),
          endsAt: new Date("2026-08-01T02:00:00.000Z"),
        },
      ],
      bookings: [
        { id: "b-1", scheduledAt: new Date("2026-07-31T23:00:00.000Z"), status: "confirmed", hasServiceTurn: true },
        { id: "b-2", scheduledAt: new Date("2026-08-01T00:30:00.000Z"), status: "no_show", hasServiceTurn: false },
      ],
    });

    const byKey = new Map(rows.map((row) => [row.metricKey, row]));
    expect(byKey.get("covers")).toMatchObject({ availability: "available", value: 6, unit: "count" });
    expect(byKey.get("turn-time")).toMatchObject({ availability: "available", value: 75, unit: "duration" });
    expect(byKey.get("table-utilization")).toMatchObject({
      availability: "available",
      value: 0.20833333333333334,
      unit: "percent",
    });
    expect(byKey.get("wait-no-show-rate")).toMatchObject({ availability: "available", value: 0.5, unit: "rate" });
    expect(byKey.get("sales")).toMatchObject({ availability: "unavailable", value: null });
    expect(byKey.get("average-check")).toMatchObject({ availability: "unavailable", value: null });
    expect(byKey.get("labor-percentage")).toMatchObject({ availability: "unavailable", value: null });
    expect(rows.every((row) => row.definitionVersion === "restaurant-v1")).toBe(true);
    expect(rows.every((row) => row.sourceWatermark?.toISOString() === at.toISOString())).toBe(true);
  });

  it("marks partial cover evidence and unconfirmed capacity denominators unavailable", () => {
    const window = restaurantMetricWindow(at, "UTC");
    const rows = buildRestaurantMetricRows({
      organizationId: "org-1",
      storefrontId: "sf-1",
      window,
      computedAt: at,
      hoursConfirmedAt: null,
      businessHours: null,
      resources: [{ id: "table-1", kind: "table", status: "active" }],
      serviceTurns: [{ id: "turn-1", startedAt: window.start, closedAt: null, covers: null }],
      allocations: [],
      bookings: [],
    });
    const byKey = new Map(rows.map((row) => [row.metricKey, row]));

    expect(byKey.get("covers")?.unavailableReason).toContain("party size");
    expect(byKey.get("table-utilization")?.unavailableReason).toContain("confirmed business hours");
    expect(byKey.get("turn-time")?.unavailableReason).toContain("completed service turns");
    expect(byKey.get("wait-no-show-rate")?.unavailableReason).toContain("eligible bookings");
  });
});

describe("aggregateBusinessMetrics", () => {
  it("recomputes current and prior periods through idempotent upserts", async () => {
    const upserted: string[] = [];
    const result = await aggregateBusinessMetrics({
      async listRestaurantContexts() {
        return [{
          organizationId: "org-1",
          storefrontId: "sf-1",
          timezone: "UTC",
          hoursConfirmedAt: null,
          businessHours: null,
        }];
      },
      async loadRestaurantSource(context, window, computedAt) {
        return {
          ...context,
          window,
          computedAt,
          resources: [],
          serviceTurns: [],
          allocations: [],
          bookings: [],
        };
      },
      async upsert(row) {
        upserted.push(`${row.metricKey}:${row.periodStart.toISOString()}`);
      },
    }, at);

    expect(result).toEqual({ organizations: 1, periods: 2, upserted: 14 });
    expect(new Set(upserted).size).toBe(14);
  });
});
