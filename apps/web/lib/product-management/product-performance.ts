import {
  collectProductLineSubtreeIds,
  type ContextFreshness,
  type DemandContextItem,
  type ProductObjectiveContextItem,
  type ProductOperatingContext,
  type ProductSoldContextItem,
} from "./product-operating-context";
import { isRecognizedProductSoldStatus } from "../products/commercial-performance";
import {
  buildPerformanceRecommendations,
  type ProductPerformanceRecommendation,
} from "./product-performance-advice";

export {
  PRODUCT_PERFORMANCE_ISSUES,
  describeRecommendationForAudience,
  type ProductPerformanceIssue,
  type ProductPerformanceRecommendation,
} from "./product-performance-advice";

export const PRODUCT_PERFORMANCE_MEASURE_KEYS = [
  "recognized-revenue",
  "completed-sales",
  "demand",
  "conversion",
  "repeat-purchase",
  "package-attach-rate",
  "contribution-margin",
  "capacity-utilization",
  "stock-availability",
  "outcome-progress",
  "quality",
  "cannibalization",
] as const;
export type ProductPerformanceMeasureKey =
  (typeof PRODUCT_PERFORMANCE_MEASURE_KEYS)[number];

export type ProductPerformanceAvailability =
  | "available"
  | "partial"
  | "unavailable";
export type ProductPerformanceTrend =
  | "rising"
  | "falling"
  | "flat"
  | "unknown";
export type ProductPerformanceConfidence = "low" | "medium" | "high";
export type ProductPerformanceAudience = "owner-operator" | "professional-pm";

export type ProductPerformancePeriod = {
  from: Date;
  to: Date;
  label: "current" | "baseline";
};

export type ProductPerformanceEvidenceRef = {
  sourceKind: string;
  sourceId: string;
  asOf: Date;
  measureKey: ProductPerformanceMeasureKey;
};

export type ProductPerformanceMeasure = {
  key: ProductPerformanceMeasureKey;
  label: string;
  availability: ProductPerformanceAvailability;
  currentValue: number | null;
  baselineValue: number | null;
  unit: string | null;
  trend: ProductPerformanceTrend;
  asOf: Date | null;
  freshness: ContextFreshness;
  confidence: ProductPerformanceConfidence;
  evidence: ProductPerformanceEvidenceRef[];
  reason: string | null;
};

export type ReconciledProductSales = {
  recognizedSaleCount: number;
  recognizedRevenue: number;
  cancelledCount: number;
  refundedCount: number;
  unallocatedComponentCount: number;
  currency: string | null;
  mixedCurrencies: boolean;
  asOf: Date | null;
  evidence: ProductSoldContextItem[];
};

export type ProductPerformanceRow = {
  productId: string;
  semanticId: string;
  productLineId: string;
  name: string;
  href: string;
  current: ReconciledProductSales;
  baseline: ReconciledProductSales;
  measures: ProductPerformanceMeasure[];
};

export type ProductLinePerformanceRow = {
  productLineId: string;
  name: string;
  parentId: string | null;
  productIds: string[];
  current: ReconciledProductSales;
  baseline: ReconciledProductSales;
  measures: ProductPerformanceMeasure[];
  href: string;
};

export type ProductLinePerformanceView = {
  currentPeriod: ProductPerformancePeriod;
  baselinePeriod: ProductPerformancePeriod;
  line: ProductLinePerformanceRow;
  lines: ProductLinePerformanceRow[];
  products: ProductPerformanceRow[];
  recommendations: ProductPerformanceRecommendation[];
  unavailableMeasureCount: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const UNAVAILABLE_MEASURES: Array<{
  key: ProductPerformanceMeasureKey;
  label: string;
  reason: string;
}> = [
  {
    key: "conversion",
    label: "Conversion",
    reason:
      "No canonical business-Product impression or qualified-opportunity denominator is connected.",
  },
  {
    key: "repeat-purchase",
    label: "Repeat purchase",
    reason:
      "Consumer identity is not stable enough across Product Sold records for a safe repeat-purchase calculation.",
  },
  {
    key: "package-attach-rate",
    label: "Package attach rate",
    reason:
      "Package component evidence is attribution-only and does not yet provide a complete eligible-sale denominator.",
  },
  {
    key: "contribution-margin",
    label: "Contribution margin",
    reason:
      "No canonical shared-cost and business-Product cost attribution adapter is connected.",
  },
  {
    key: "capacity-utilization",
    label: "Capacity or utilization",
    reason:
      "No canonical capacity evidence is attributed to these business Products.",
  },
  {
    key: "stock-availability",
    label: "Stock availability",
    reason:
      "No canonical inventory availability evidence is attributed to these business Products.",
  },
  {
    key: "quality",
    label: "Quality",
    reason:
      "Outcome measures are not assumed to be quality measures without an explicit classification.",
  },
  {
    key: "cannibalization",
    label: "Cannibalization",
    reason:
      "No evidence-backed substitution or lost-sale contract is connected.",
  },
];

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function periods(
  requestedAt: Date,
  windowDays: number,
): {
  current: ProductPerformancePeriod;
  baseline: ProductPerformancePeriod;
} {
  const currentFrom = addDays(requestedAt, -windowDays);
  return {
    current: { from: currentFrom, to: requestedAt, label: "current" },
    baseline: {
      from: addDays(currentFrom, -windowDays),
      to: currentFrom,
      label: "baseline",
    },
  };
}

function inPeriod(date: Date, period: ProductPerformancePeriod): boolean {
  const time = date.getTime();
  const from = period.from.getTime();
  const to = period.to.getTime();
  return (
    time >= from &&
    (period.label === "current" ? time <= to : time < to)
  );
}

export function reconcileProductSales(
  rows: readonly ProductSoldContextItem[],
): ReconciledProductSales {
  const unique = [
    ...new Map(rows.map((row) => [row.id, row])).values(),
  ];
  const recognized = unique.filter((row) =>
    isRecognizedProductSoldStatus(row.status),
  );
  const currencies = new Set(recognized.map((row) => row.currency));
  return {
    recognizedSaleCount: recognized.length,
    recognizedRevenue: recognized.reduce(
      (sum, row) => sum + row.totalAmount,
      0,
    ),
    cancelledCount: unique.filter((row) => row.status === "cancelled").length,
    refundedCount: unique.filter((row) => row.status === "refunded").length,
    unallocatedComponentCount: recognized.reduce(
      (sum, row) =>
        sum +
        row.componentAllocations.filter(
          (allocation) => allocation.allocatedAmount === null,
        ).length,
      0,
    ),
    currency: currencies.size === 1 ? [...currencies][0]! : null,
    mixedCurrencies: currencies.size > 1,
    asOf:
      unique.reduce<Date | null>(
        (latest, row) =>
          !latest || row.asOf.getTime() > latest.getTime()
            ? row.asOf
            : latest,
        null,
      ),
    evidence: unique,
  };
}

function salesEvidence(
  rows: readonly ProductSoldContextItem[],
  key: "recognized-revenue" | "completed-sales",
): ProductPerformanceEvidenceRef[] {
  return rows.map((row) => ({
    sourceKind: row.sourceKind,
    sourceId: row.id,
    asOf: row.asOf,
    measureKey: key,
  }));
}

function trendOf(current: number, baseline: number): ProductPerformanceTrend {
  if (baseline === 0) return current > 0 ? "rising" : "flat";
  const change = (current - baseline) / Math.abs(baseline);
  if (change > 0.05) return "rising";
  if (change < -0.05) return "falling";
  return "flat";
}

function freshnessOf(
  asOf: Date | null,
  requestedAt: Date,
): ContextFreshness {
  if (!asOf) return "unknown";
  return requestedAt.getTime() - asOf.getTime() > 30 * DAY_MS
    ? "stale"
    : "fresh";
}

function salesMeasures(
  current: ReconciledProductSales,
  baseline: ReconciledProductSales,
  requestedAt: Date,
): ProductPerformanceMeasure[] {
  const revenueEvidence = salesEvidence(
    current.evidence,
    "recognized-revenue",
  );
  const saleEvidence = salesEvidence(current.evidence, "completed-sales");
  const noEvidence = current.evidence.length === 0 && baseline.evidence.length === 0;
  const revenueAvailability = current.mixedCurrencies
    ? "partial"
    : noEvidence
      ? "unavailable"
      : "available";
  return [
    {
      key: "recognized-revenue",
      label: "Recognized revenue",
      availability: revenueAvailability,
      currentValue:
        revenueAvailability === "available"
          ? current.recognizedRevenue
          : null,
      baselineValue:
        revenueAvailability === "available"
          ? baseline.recognizedRevenue
          : null,
      unit: current.currency,
      trend:
        revenueAvailability === "available"
          ? trendOf(current.recognizedRevenue, baseline.recognizedRevenue)
          : "unknown",
      asOf: current.asOf,
      freshness: freshnessOf(current.asOf, requestedAt),
      confidence: current.unallocatedComponentCount > 0 ? "medium" : "high",
      evidence: revenueEvidence,
      reason: current.mixedCurrencies
        ? "Recorded sales use multiple currencies and no canonical conversion rate is connected."
        : noEvidence
          ? "No Product Sold evidence is recorded for either comparison period."
          : null,
    },
    {
      key: "completed-sales",
      label: "Recognized sales",
      availability: noEvidence ? "unavailable" : "available",
      currentValue: noEvidence ? null : current.recognizedSaleCount,
      baselineValue: noEvidence ? null : baseline.recognizedSaleCount,
      unit: "sales",
      trend: noEvidence
        ? "unknown"
        : trendOf(
            current.recognizedSaleCount,
            baseline.recognizedSaleCount,
          ),
      asOf: current.asOf,
      freshness: freshnessOf(current.asOf, requestedAt),
      confidence: "high",
      evidence: saleEvidence,
      reason: noEvidence
        ? "No Product Sold evidence is recorded for either comparison period."
        : null,
    },
  ];
}

function demandMeasure(
  demand: readonly DemandContextItem[],
  requestedAt: Date,
): ProductPerformanceMeasure {
  const evidenceReady = demand.filter(
    (item) => item.readiness?.evidenceReady || (item.evidenceCount ?? 0) > 0,
  );
  return {
    key: "demand",
    label: "Evidence-backed demand",
    availability: demand.length === 0 ? "unavailable" : "available",
    currentValue: demand.length === 0 ? null : evidenceReady.length,
    baselineValue: null,
    unit: "items",
    trend: "unknown",
    asOf: demand[0]?.asOf ?? null,
    freshness: freshnessOf(demand[0]?.asOf ?? null, requestedAt),
    confidence:
      demand.length > 0 && evidenceReady.length === demand.length
        ? "high"
        : "medium",
    evidence: demand.map((item) => ({
      sourceKind: item.sourceKind,
      sourceId: item.id,
      asOf: item.asOf,
      measureKey: "demand",
    })),
    reason:
      demand.length === 0
        ? "No demand items are attributed to this Product."
        : null,
  };
}

function outcomeMeasure(
  objectives: readonly ProductObjectiveContextItem[],
  requestedAt: Date,
): ProductPerformanceMeasure {
  const comparable = objectives.filter(
    (objective) => objective.posture.availability === "available",
  );
  const onTarget = comparable.filter(
    (objective) =>
      objective.posture.availability === "available" &&
      objective.posture.state === "on-target",
  );
  return {
    key: "outcome-progress",
    label: "Comparable objectives on target",
    availability:
      objectives.length === 0
        ? "unavailable"
        : comparable.length === 0
          ? "partial"
          : "available",
    currentValue:
      comparable.length > 0 ? (onTarget.length / comparable.length) * 100 : null,
    baselineValue: null,
    unit: "% of comparable objectives",
    trend: "unknown",
    asOf: objectives[0]?.asOf ?? null,
    freshness: freshnessOf(objectives[0]?.asOf ?? null, requestedAt),
    confidence: comparable.length > 0 ? "medium" : "low",
    evidence: objectives.map((objective) => ({
      sourceKind: objective.sourceKind,
      sourceId: objective.objectiveId,
      asOf: objective.asOf,
      measureKey: "outcome-progress",
    })),
    reason:
      objectives.length === 0
        ? "No product objectives are recorded."
        : comparable.length === 0
          ? "Objectives exist, but none has compatible baseline, target, and observation evidence."
          : null,
  };
}

function unavailableMeasures(): ProductPerformanceMeasure[] {
  return UNAVAILABLE_MEASURES.map((measure) => ({
    ...measure,
    availability: "unavailable",
    currentValue: null,
    baselineValue: null,
    unit: null,
    trend: "unknown",
    asOf: null,
    freshness: "unknown",
    confidence: "low",
    evidence: [],
  }));
}

function measuresFor(
  current: ReconciledProductSales,
  baseline: ReconciledProductSales,
  demand: readonly DemandContextItem[],
  objectives: readonly ProductObjectiveContextItem[],
  requestedAt: Date,
): ProductPerformanceMeasure[] {
  return [
    ...salesMeasures(current, baseline, requestedAt),
    demandMeasure(demand, requestedAt),
    ...unavailableMeasures().slice(0, 6),
    outcomeMeasure(objectives, requestedAt),
    ...unavailableMeasures().slice(6),
  ];
}

function applySourcePosture(
  measures: ProductPerformanceMeasure[],
  context: ProductOperatingContext,
): ProductPerformanceMeasure[] {
  return measures.map((measure) => {
    const slice =
      measure.key === "recognized-revenue" ||
      measure.key === "completed-sales" ||
      measure.key === "package-attach-rate"
        ? context.productSold
        : measure.key === "demand"
          ? context.demand
          : measure.key === "outcome-progress" ||
              measure.key === "quality"
            ? context.objectives
            : null;
    if (!slice || slice.availability === "available") return measure;
    const reason = [measure.reason, slice.reason].filter(Boolean).join(" ");
    return {
      ...measure,
      availability:
        slice.availability === "unavailable" ? "unavailable" : "partial",
      confidence:
        slice.availability === "unavailable" ? "low" : "medium",
      reason: reason || "The source projection is incomplete.",
    };
  });
}

function aggregateSales(
  products: readonly ProductPerformanceRow[],
  period: "current" | "baseline",
): ReconciledProductSales {
  return reconcileProductSales(
    products.flatMap((product) => product[period].evidence),
  );
}

function productIdsForLine(
  context: ProductOperatingContext,
  lineId: string,
): string[] {
  const subtree = new Set(
    collectProductLineSubtreeIds(context.productLines, lineId),
  );
  return context.products
    .filter((product) => subtree.has(product.productLineId))
    .map((product) => product.id)
    .sort();
}

export function buildProductLinePerformance(
  context: ProductOperatingContext,
  options: { windowDays?: number } = {},
): ProductLinePerformanceView {
  const windowDays = Math.max(1, Math.floor(options.windowDays ?? 30));
  const period = periods(context.requestedAt, windowDays);
  const products = [...context.products]
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    )
    .map((product): ProductPerformanceRow => {
      const sold = context.productSold.items.filter(
        (row) => row.productId === product.id,
      );
      const current = reconcileProductSales(
        sold.filter((row) => inPeriod(row.asOf, period.current)),
      );
      const baseline = reconcileProductSales(
        sold.filter((row) => inPeriod(row.asOf, period.baseline)),
      );
      const demand = context.demand.items.filter(
        (item) => item.businessProductId === product.id,
      );
      const objectives = context.objectives.items.filter(
        (objective) => objective.productId === product.id,
      );
      return {
        productId: product.id,
        semanticId: product.productId,
        productLineId: product.productLineId,
        name: product.name,
        href: `/portfolio/product/${product.id}/direction`,
        current,
        baseline,
        measures: applySourcePosture(
          measuresFor(
            current,
            baseline,
            demand,
            objectives,
            context.requestedAt,
          ),
          context,
        ),
      };
    });

  const lines = [...context.productLines]
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    )
    .map((line): ProductLinePerformanceRow => {
      const productIds = productIdsForLine(context, line.id);
      const children = products.filter((product) =>
        productIds.includes(product.productId),
      );
      const current = aggregateSales(children, "current");
      const baseline = aggregateSales(children, "baseline");
      const demand = context.demand.items.filter(
        (item) =>
          (item.businessProductId &&
            productIds.includes(item.businessProductId)) ||
          item.productLineId === line.id,
      );
      const objectives = context.objectives.items.filter((objective) =>
        productIds.includes(objective.productId),
      );
      return {
        productLineId: line.id,
        name: line.name,
        parentId: line.parentId,
        productIds,
        current,
        baseline,
        measures: applySourcePosture(
          measuresFor(
            current,
            baseline,
            demand,
            objectives,
            context.requestedAt,
          ),
          context,
        ),
        href: `/portfolio/product-line/${line.id}/direction`,
      };
    });
  const selected =
    lines.find((line) => line.productLineId === context.productLine?.id) ??
    ({
      productLineId: context.provider.id,
      name: context.provider.name,
      parentId: null,
      productIds: products.map((product) => product.productId).sort(),
      current: aggregateSales(products, "current"),
      baseline: aggregateSales(products, "baseline"),
      measures: [],
      href: "/portfolio",
    } satisfies ProductLinePerformanceRow);
  if (selected.measures.length === 0) {
    selected.measures = applySourcePosture(
      measuresFor(
        selected.current,
        selected.baseline,
        context.demand.items,
        context.objectives.items,
        context.requestedAt,
      ),
      context,
    );
  }
  const selectedProducts = products.filter((product) =>
    selected.productIds.includes(product.productId),
  );
  const recommendations = buildPerformanceRecommendations({
    line: selected,
    products: selectedProducts,
    demand: context.demand.items,
    objectives: context.objectives.items,
    commercialEvidenceFreshness: context.productSold.freshness,
  });
  return {
    currentPeriod: period.current,
    baselinePeriod: period.baseline,
    line: selected,
    lines,
    products,
    recommendations,
    unavailableMeasureCount: selected.measures.filter(
      (measure) => measure.availability !== "available",
    ).length,
  };
}
