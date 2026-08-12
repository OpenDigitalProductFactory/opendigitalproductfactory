import { createHash } from "node:crypto";

import {
  getPerformanceMetricDefinition,
  type PerformanceMetricDefinition,
} from "@dpf/storefront-templates";

export const RESTAURANT_METRIC_DEFINITION_VERSION = "restaurant-v1";

export interface MetricWindow {
  periodKey: string;
  start: Date;
  end: Date;
  timezone: string;
}

export interface RestaurantMetricSource {
  organizationId: string;
  storefrontId: string;
  window: MetricWindow;
  computedAt: Date;
  hoursConfirmedAt: Date | null;
  businessHours: Record<string, { open: string; close: string } | null> | null;
  resources: readonly { id: string; kind: string; status: string }[];
  serviceTurns: readonly {
    id: string;
    startedAt: Date;
    closedAt: Date | null;
    covers: number | null;
  }[];
  allocations: readonly {
    resourceId: string | null;
    serviceTurnId: string | null;
    startsAt: Date;
    endsAt: Date;
  }[];
  bookings: readonly {
    id: string;
    scheduledAt: Date;
    status: string;
    hasServiceTurn: boolean;
  }[];
}

export interface BusinessMetricRollupInput {
  organizationId: string;
  metricKey: string;
  periodStart: Date;
  periodEnd: Date;
  timezone: string;
  dimensionsHash: string;
  dimensions: Record<string, string>;
  value: number | null;
  unit: PerformanceMetricDefinition["unit"];
  availability: "available" | "unavailable";
  unavailableReason: string | null;
  definitionVersion: string;
  sourceWatermark: Date;
  sourceLineage: {
    sourceModels: readonly string[];
    sourceRows: number;
    storefrontId: string;
  };
}

export interface RestaurantMetricContext {
  organizationId: string;
  storefrontId: string;
  timezone: string;
  hoursConfirmedAt: Date | null;
  businessHours: Record<string, { open: string; close: string } | null> | null;
}

export interface BusinessMetricRollupDeps {
  listRestaurantContexts(): Promise<readonly RestaurantMetricContext[]>;
  loadRestaurantSource(
    context: RestaurantMetricContext,
    window: MetricWindow,
    computedAt: Date,
  ): Promise<RestaurantMetricSource>;
  upsert(row: BusinessMetricRollupInput, computedAt: Date): Promise<void>;
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function localMidnightUtc(periodKey: string, timezone: string): Date {
  const [year, month, day] = periodKey.split("-").map(Number);
  const target = Date.UTC(year!, month! - 1, day!);
  let candidate = new Date(target);
  // Two passes cover offsets that change around a DST boundary.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = zonedParts(candidate, timezone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate = new Date(candidate.getTime() + (target - represented));
  }
  return candidate;
}

function localTimeUtc(periodKey: string, hhmm: string, timezone: string): Date | null {
  const minute = minuteOfDay(hhmm);
  if (minute === null) return null;
  const [year, month, day] = periodKey.split("-").map(Number);
  const target = Date.UTC(
    year!,
    month! - 1,
    day!,
    Math.floor(minute / 60),
    minute % 60,
  );
  let candidate = new Date(target);
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = zonedParts(candidate, timezone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate = new Date(candidate.getTime() + (target - represented));
  }
  return candidate;
}

function shiftPeriodKey(periodKey: string, days: number): string {
  const [year, month, day] = periodKey.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

export function restaurantMetricWindow(at: Date, timezone: string): MetricWindow {
  const parts = zonedParts(at, timezone);
  const periodKey = [parts.year, parts.month, parts.day]
    .map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, "0")))
    .join("-");
  return {
    periodKey,
    start: localMidnightUtc(periodKey, timezone),
    end: localMidnightUtc(shiftPeriodKey(periodKey, 1), timezone),
    timezone,
  };
}

function minuteOfDay(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function operatingInterval(source: RestaurantMetricSource): [Date, Date] | null {
  if (!source.hoursConfirmedAt || !source.businessHours) return null;
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  })
    .format(new Date(`${source.window.periodKey}T12:00:00.000Z`))
    .toLowerCase();
  const hours = source.businessHours[weekday];
  if (!hours) return null;
  const start = minuteOfDay(hours.open);
  const end = minuteOfDay(hours.close);
  // The first definition version deliberately rejects overnight intervals:
  // assigning the post-midnight tail to a business date needs an explicit
  // cross-day policy, and guessing would corrupt utilization.
  if (start === null || end === null || end <= start) return null;
  const startsAt = localTimeUtc(source.window.periodKey, hours.open, source.window.timezone);
  const endsAt = localTimeUtc(source.window.periodKey, hours.close, source.window.timezone);
  return startsAt && endsAt ? [startsAt, endsAt] : null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function occupiedMinutes(
  source: RestaurantMetricSource,
  interval: readonly [Date, Date],
): number {
  const byResource = new Map<string, Array<[number, number]>>();
  for (const allocation of source.allocations) {
    if (!allocation.resourceId || !allocation.serviceTurnId) continue;
    const start = Math.max(
      allocation.startsAt.getTime(),
      source.window.start.getTime(),
      interval[0].getTime(),
    );
    const end = Math.min(
      allocation.endsAt.getTime(),
      source.window.end.getTime(),
      interval[1].getTime(),
    );
    if (end <= start) continue;
    const intervals = byResource.get(allocation.resourceId) ?? [];
    intervals.push([start, end]);
    byResource.set(allocation.resourceId, intervals);
  }

  let totalMs = 0;
  for (const intervals of byResource.values()) {
    intervals.sort((a, b) => a[0] - b[0]);
    let [currentStart, currentEnd] = intervals[0]!;
    for (const [start, end] of intervals.slice(1)) {
      if (start <= currentEnd) currentEnd = Math.max(currentEnd, end);
      else {
        totalMs += currentEnd - currentStart;
        currentStart = start;
        currentEnd = end;
      }
    }
    totalMs += currentEnd - currentStart;
  }
  return totalMs / 60_000;
}

function row(
  source: RestaurantMetricSource,
  metricKey: string,
  value: number | null,
  unavailableReason: string | null,
  sourceModels: readonly string[],
  sourceRows: number,
): BusinessMetricRollupInput {
  const definition = getPerformanceMetricDefinition(metricKey);
  if (!definition) throw new Error(`Unknown performance metric definition: ${metricKey}`);
  const dimensions = { storefrontId: source.storefrontId };
  return {
    organizationId: source.organizationId,
    metricKey,
    periodStart: source.window.start,
    periodEnd: source.window.end,
    timezone: source.window.timezone,
    dimensionsHash: createHash("sha256").update(JSON.stringify(dimensions)).digest("hex"),
    dimensions,
    value,
    unit: definition.unit,
    availability: unavailableReason ? "unavailable" : "available",
    unavailableReason,
    definitionVersion: RESTAURANT_METRIC_DEFINITION_VERSION,
    sourceWatermark: source.computedAt,
    sourceLineage: { sourceModels, sourceRows, storefrontId: source.storefrontId },
  };
}

export function buildRestaurantMetricRows(
  source: RestaurantMetricSource,
): BusinessMetricRollupInput[] {
  const coverValues = source.serviceTurns.map((turn) => turn.covers);
  const coversMissing = coverValues.some((value) => value === null);
  const covers = coversMissing
    ? null
    : coverValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);

  const completedMinutes = source.serviceTurns.flatMap((turn) =>
    turn.closedAt
      ? [(turn.closedAt.getTime() - turn.startedAt.getTime()) / 60_000]
      : [],
  );
  const turnTime = median(completedMinutes);

  const activeTables = source.resources.filter(
    (resource) => resource.kind === "table" && resource.status === "active",
  ).length;
  const openInterval = operatingInterval(source);
  const availableMinutes = openInterval
    ? (openInterval[1].getTime() - openInterval[0].getTime()) / 60_000
    : null;
  const utilizationDenominator =
    availableMinutes !== null && availableMinutes > 0 && activeTables > 0
      ? availableMinutes * activeTables
      : null;

  const eligibleBookings = source.bookings.filter(
    (booking) =>
      booking.scheduledAt <= source.computedAt &&
      !["cancelled", "canceled", "void"].includes(booking.status),
  );
  const missedBookings = eligibleBookings.filter(
    (booking) =>
      ["no_show", "no-show"].includes(booking.status) || !booking.hasServiceTurn,
  );

  return [
    row(
      source,
      "covers",
      covers,
      coversMissing ? "One or more seated parties has no recorded party size." : null,
      ["HospitalityServiceTurn", "StorefrontBooking"],
      source.serviceTurns.length,
    ),
    row(
      source,
      "turn-time",
      turnTime,
      turnTime === null ? "No completed service turns exist in this period." : null,
      ["HospitalityServiceTurn"],
      completedMinutes.length,
    ),
    row(
      source,
      "table-utilization",
      utilizationDenominator === null || openInterval === null
        ? null
        : occupiedMinutes(source, openInterval) / utilizationDenominator,
      !source.hoursConfirmedAt
        ? "Table utilization requires confirmed business hours."
        : availableMinutes === null || availableMinutes <= 0
          ? "No valid open interval exists for this period."
          : activeTables === 0
            ? "No active table resources exist for this storefront."
            : null,
      ["HospitalityCapacityAllocation", "HospitalityResource", "BusinessProfile"],
      source.allocations.length + source.resources.length,
    ),
    row(
      source,
      "wait-no-show-rate",
      eligibleBookings.length > 0 ? missedBookings.length / eligibleBookings.length : null,
      eligibleBookings.length === 0 ? "No eligible bookings exist in this period." : null,
      ["StorefrontBooking", "HospitalityServiceTurn"],
      eligibleBookings.length,
    ),
    row(
      source,
      "sales",
      null,
      "Recognized restaurant sales are not yet linked to service turns.",
      ["StorefrontOrder"],
      0,
    ),
    row(
      source,
      "average-check",
      null,
      "Average check requires recognized sales linked to closed restaurant checks.",
      ["StorefrontOrder", "HospitalityServiceTurn"],
      0,
    ),
    row(
      source,
      "labor-percentage",
      null,
      "Labor percentage requires canonical labor cost linked to restaurant sales.",
      ["StaffingAssignment", "StorefrontOrder"],
      0,
    ),
  ];
}

export async function aggregateBusinessMetrics(
  deps: BusinessMetricRollupDeps,
  at = new Date(),
): Promise<{ organizations: number; periods: number; upserted: number }> {
  const contexts = await deps.listRestaurantContexts();
  let periods = 0;
  let upserted = 0;

  for (const context of contexts) {
    const current = restaurantMetricWindow(at, context.timezone);
    const previous = restaurantMetricWindow(
      new Date(current.start.getTime() - 1),
      context.timezone,
    );
    for (const window of [previous, current]) {
      const source = await deps.loadRestaurantSource(context, window, at);
      for (const rollup of buildRestaurantMetricRows(source)) {
        await deps.upsert(rollup, at);
        upserted += 1;
      }
      periods += 1;
    }
  }

  return { organizations: contexts.length, periods, upserted };
}
