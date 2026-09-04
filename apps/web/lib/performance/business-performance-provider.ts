import {
  getPerformanceMetricDefinition,
  resolvePerformanceMetricPack,
  type PerformanceMetricDefinition,
} from "@dpf/storefront-templates";
import {
  resolvePerformanceOrganizationContext,
  type PerformanceOrganizationContextDataSource,
} from "./performance-organization-context";
import { archetypeHasPerformanceMetrics } from "./performance-metric-support";

export interface UnconfiguredBusinessPerformance {
  status: "not-configured";
  reason: string;
  asOf: null;
  metricValues: readonly [];
  source: "business-performance-read-model";
  /**
   * Whether a snapshot could ever appear here. `true` (default) means the data
   * is simply pending — the honest "not computed yet" case. `false` means the
   * metrics engine has no source loader for this install's archetype, so the
   * surface will never populate and the copy must not imply otherwise.
   */
  applicable: boolean;
}

export interface PersistedMetricRow {
  metricKey: string;
  periodStart: Date;
  periodEnd: Date;
  timezone: string;
  value: number | null;
  unit: string;
  availability: "available" | "unavailable";
  unavailableReason: string | null;
  definitionVersion: string;
  sourceWatermark: Date;
  computedAt: Date;
  sourceLineage: unknown;
}

export interface BusinessPerformanceMetricValue {
  key: string;
  label: string;
  unit: PerformanceMetricDefinition["unit"];
  value: number | null;
  comparisonValue: number | null;
  comparisonDelta: number | null;
  availability: "available" | "unavailable";
  unavailableReason: string | null;
  definition: string;
  definitionVersion: string | null;
  sourceOwner: string;
  sourceWatermark: Date | null;
  sourceLineage: unknown;
  drilldownRoute?: string;
}

export interface BusinessPerformanceTrendPoint {
  periodKey: string;
  periodLabel: string;
  values: Readonly<Record<string, number | null>>;
}

export interface ReadyBusinessPerformance {
  status: "ready";
  organizationId: string;
  archetypeId: string;
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  timezone: string;
  asOf: Date;
  freshness: "fresh" | "stale";
  periodState: "in-progress" | "finalized";
  availablePeriods: readonly { key: string; label: string; selected: boolean }[];
  metricValues: readonly BusinessPerformanceMetricValue[];
  trendPoints: readonly BusinessPerformanceTrendPoint[];
  sections: {
    headline: readonly string[];
    operating: readonly string[];
    financial: readonly string[];
    customer: readonly string[];
    workforce: readonly string[];
  };
  source: "business-performance-read-model";
}

export type BusinessPerformanceReadModel =
  | UnconfiguredBusinessPerformance
  | ReadyBusinessPerformance;

export interface BusinessPerformanceLoadInput {
  userId: string;
  period?: string;
}

export interface BusinessPerformanceProvider {
  load(input: BusinessPerformanceLoadInput): Promise<BusinessPerformanceReadModel>;
}

type StorefrontPerformanceContext = {
  organizationId: string;
  archetype: { archetypeId: string };
};

type PersistedMetricDbRow = Omit<PersistedMetricRow, "value" | "availability"> & {
  value: unknown;
  availability: string;
};

export interface BusinessPerformanceDataSource
  extends PerformanceOrganizationContextDataSource {
  businessMetricRollup: {
    findMany(args: unknown): Promise<PersistedMetricDbRow[]>;
  };
}

function unconfigured(
  reason: string,
  opts: { applicable?: boolean } = {},
): UnconfiguredBusinessPerformance {
  return {
    status: "not-configured",
    reason,
    asOf: null,
    metricValues: [],
    source: "business-performance-read-model",
    applicable: opts.applicable ?? true,
  };
}

function periodLabel(periodStart: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(periodStart);
}

function periodKey(periodStart: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(periodStart);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function uniqueMetricKeys(archetypeId: string): string[] {
  const pack = resolvePerformanceMetricPack(archetypeId);
  return [...new Set([
    ...pack.headline,
    ...pack.operating,
    ...pack.financial,
    ...pack.customer,
    ...pack.workforce,
  ])];
}

export function buildBusinessPerformanceReadModel(input: {
  organizationId?: string;
  archetypeId: string;
  rows: readonly PersistedMetricRow[];
  now?: Date;
  selectedPeriod?: string;
}): BusinessPerformanceReadModel {
  if (input.rows.length === 0) {
    return unconfigured("The first historical performance snapshot has not been computed yet.");
  }

  const periods = [...new Set(input.rows.map((row) => row.periodStart.getTime()))].sort(
    (a, b) => b - a,
  );
  const selectedStart = input.selectedPeriod
    ? periods.find((start) => {
        const candidate = input.rows.find((row) => row.periodStart.getTime() === start);
        return candidate ? periodKey(candidate.periodStart, candidate.timezone) === input.selectedPeriod : false;
      })
    : undefined;
  const currentStart = selectedStart ?? periods[0]!;
  const currentIndex = periods.indexOf(currentStart);
  const priorStart = periods[currentIndex + 1] ?? null;
  const currentRows = input.rows.filter((row) => row.periodStart.getTime() === currentStart);
  const priorRows = input.rows.filter((row) => row.periodStart.getTime() === priorStart);
  const currentByKey = new Map(currentRows.map((row) => [row.metricKey, row]));
  const priorByKey = new Map(priorRows.map((row) => [row.metricKey, row]));
  const reference = currentRows[0]!;
  // The dashboard-wide freshness boundary is the least-current contributing
  // metric. Using the newest watermark would let one fresh source conceal a
  // stale sibling while still labelling the whole snapshot fresh.
  const asOf = new Date(
    Math.min(...currentRows.map((row) => row.sourceWatermark.getTime())),
  );
  const now = input.now ?? new Date();
  const isFinalizedPeriod = asOf.getTime() >= reference.periodEnd.getTime();

  const metricValues = uniqueMetricKeys(input.archetypeId).flatMap((key) => {
    const definition = getPerformanceMetricDefinition(key);
    if (!definition) return [];
    const current = currentByKey.get(key);
    const prior = priorByKey.get(key);
    const currentValue = current?.availability === "available" ? current.value : null;
    const priorValue = prior?.availability === "available" ? prior.value : null;
    return [{
      key,
      label: definition.label,
      unit: definition.unit,
      value: currentValue,
      comparisonValue: priorValue,
      comparisonDelta:
        currentValue !== null && priorValue !== null && priorValue !== 0
          ? (currentValue - priorValue) / Math.abs(priorValue)
          : null,
      availability: current?.availability ?? "unavailable",
      unavailableReason:
        current?.unavailableReason ?? "No snapshot exists for this metric and period.",
      definition: definition.aggregation,
      definitionVersion: current?.definitionVersion ?? null,
      sourceOwner: definition.sourceOwner,
      sourceWatermark: current?.sourceWatermark ?? null,
      sourceLineage: current?.sourceLineage ?? null,
      ...(definition.drilldownRoute ? { drilldownRoute: definition.drilldownRoute } : {}),
    } satisfies BusinessPerformanceMetricValue];
  });
  const trendPoints = [...periods]
    .slice(0, 14)
    .reverse()
    .map((start) => {
      const periodRows = input.rows.filter((row) => row.periodStart.getTime() === start);
      const periodReference = periodRows[0]!;
      return {
        periodKey: periodKey(periodReference.periodStart, periodReference.timezone),
        periodLabel: periodLabel(periodReference.periodStart, periodReference.timezone),
        values: Object.fromEntries(
          uniqueMetricKeys(input.archetypeId).map((key) => {
            const metric = periodRows.find((row) => row.metricKey === key);
            return [key, metric?.availability === "available" ? metric.value : null];
          }),
        ),
      };
    });

  return {
    status: "ready",
    organizationId: input.organizationId ?? "unscoped-test-context",
    archetypeId: input.archetypeId,
    periodLabel: periodLabel(reference.periodStart, reference.timezone),
    periodStart: reference.periodStart,
    periodEnd: reference.periodEnd,
    timezone: reference.timezone,
    asOf,
    freshness:
      isFinalizedPeriod || now.getTime() - asOf.getTime() <= 2 * 60 * 60 * 1000
        ? "fresh"
        : "stale",
    periodState: isFinalizedPeriod ? "finalized" : "in-progress",
    availablePeriods: [
      ...new Set([...periods.slice(0, 3), currentStart]),
    ].sort((a, b) => b - a).map((start) => {
      const row = input.rows.find((candidate) => candidate.periodStart.getTime() === start)!;
      return {
        key: periodKey(row.periodStart, row.timezone),
        label: periodLabel(row.periodStart, row.timezone),
        selected: start === currentStart,
      };
    }),
    metricValues,
    trendPoints,
    sections: resolvePerformanceMetricPack(input.archetypeId),
    source: "business-performance-read-model",
  };
}

export function createBusinessPerformanceProvider(
  db: BusinessPerformanceDataSource,
): BusinessPerformanceProvider {
  return {
    async load(input) {
      const context = await resolvePerformanceOrganizationContext(db, input.userId);
      if (context.status === "unconfigured") return unconfigured(context.reason);

      // The metrics engine only has a source loader for some archetypes. On an
      // install whose archetype has none, no snapshot will ever be produced, so
      // say that plainly instead of implying a pending computation. BI-F359E1E9.
      if (!archetypeHasPerformanceMetrics(context.archetypeId)) {
        return unconfigured(
          "Performance snapshots are not available for this business type yet — the metrics engine currently covers hospitality operations.",
          { applicable: false },
        );
      }

      const rows = await db.businessMetricRollup.findMany({
        where: { organizationId: context.organizationId },
        orderBy: [{ periodStart: "desc" }, { metricKey: "asc" }],
        // Seven restaurant metrics × ~35 local-business days. The page still
        // reads one bounded indexed projection query, never source history.
        take: 250,
        select: {
          metricKey: true,
          periodStart: true,
          periodEnd: true,
          timezone: true,
          value: true,
          unit: true,
          availability: true,
          unavailableReason: true,
          definitionVersion: true,
          sourceWatermark: true,
          computedAt: true,
          sourceLineage: true,
        },
      });

      return buildBusinessPerformanceReadModel({
        organizationId: context.organizationId,
        archetypeId: context.archetypeId,
        ...(input.period ? { selectedPeriod: input.period } : {}),
        rows: rows.map((row) => ({
          ...row,
          value: row.value === null ? null : Number(row.value),
          availability: row.availability === "available" ? "available" : "unavailable",
        })),
      });
    },
  };
}

const defaultProvider: BusinessPerformanceProvider = {
  async load(input) {
    const { prisma } = await import("@dpf/db");
    return createBusinessPerformanceProvider(
      prisma as unknown as BusinessPerformanceDataSource,
    ).load(input);
  },
};

export async function loadBusinessPerformance(
  input: BusinessPerformanceLoadInput,
  provider: BusinessPerformanceProvider = defaultProvider,
): Promise<BusinessPerformanceReadModel> {
  return provider.load(input);
}
