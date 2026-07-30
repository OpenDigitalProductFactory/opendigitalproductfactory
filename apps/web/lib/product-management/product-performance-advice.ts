import type {
  DemandContextItem,
  ProductObjectiveContextItem,
} from "./product-operating-context";
import type {
  ProductLinePerformanceRow,
  ProductPerformanceAudience,
  ProductPerformanceConfidence,
  ProductPerformanceEvidenceRef,
  ProductPerformanceRow,
} from "./product-performance";

export const PRODUCT_PERFORMANCE_ISSUES = [
  "demand-opportunity",
  "capacity-constraint",
  "margin-risk",
  "stock-risk",
  "quality-risk",
  "cannibalization-risk",
  "attribution-gap",
  "outcome-review",
  "stale-evidence",
  "evidence-gap",
] as const;
export type ProductPerformanceIssue =
  (typeof PRODUCT_PERFORMANCE_ISSUES)[number];

export type ProductPerformanceRecommendation = {
  recommendationId: string;
  issue: ProductPerformanceIssue;
  action:
    | "investigate"
    | "market"
    | "adjust-capacity"
    | "test-offering"
    | "defer";
  productId: string | null;
  title: string;
  interpretation: string;
  expectedEffect: string;
  confidence: ProductPerformanceConfidence;
  evidence: ProductPerformanceEvidenceRef[];
  blindSpots: string[];
  approvalBoundary: "recommend-only";
  followUpMeasure: string;
};

function recommendationId(
  issue: ProductPerformanceIssue,
  productId: string | null,
): string {
  return `performance:${issue}:${productId ?? "line"}`;
}

export function buildPerformanceRecommendations(input: {
  line: ProductLinePerformanceRow;
  products: readonly ProductPerformanceRow[];
  demand: readonly DemandContextItem[];
  objectives: readonly ProductObjectiveContextItem[];
  commercialEvidenceFreshness: "fresh" | "stale" | "unknown";
}): ProductPerformanceRecommendation[] {
  const recommendations: ProductPerformanceRecommendation[] = [];
  if (input.line.current.unallocatedComponentCount > 0) {
    recommendations.push({
      recommendationId: recommendationId("attribution-gap", null),
      issue: "attribution-gap",
      action: "investigate",
      productId: null,
      title: "Package attribution needs review",
      interpretation: `${input.line.current.unallocatedComponentCount} package component ${
        input.line.current.unallocatedComponentCount === 1
          ? "allocation is"
          : "allocations are"
      } missing.`,
      expectedEffect:
        "Product and product-line comparisons can be interpreted without double counting or hidden allocation.",
      confidence: "high",
      evidence:
        input.line.measures.find(
          (measure) => measure.key === "recognized-revenue",
        )?.evidence ?? [],
      blindSpots: [
        "Unallocated package revenue is not assigned to a component Product.",
      ],
      approvalBoundary: "recommend-only",
      followUpMeasure: "Unallocated package components",
    });
  }

  for (const product of input.products) {
    const readyDemand = input.demand.filter(
      (item) =>
        item.businessProductId === product.productId &&
        item.readiness?.fundingReady,
    );
    if (
      readyDemand.length > 0 &&
      product.current.recognizedSaleCount === 0
    ) {
      recommendations.push({
        recommendationId: recommendationId(
          "demand-opportunity",
          product.productId,
        ),
        issue: "demand-opportunity",
        action: "investigate",
        productId: product.productId,
        title: `Investigate demand for ${product.name}`,
        interpretation: `${readyDemand.length} funded-ready demand ${
          readyDemand.length === 1 ? "item has" : "items have"
        } evidence, while no recognized sale is recorded in the current period.`,
        expectedEffect:
          "A reviewed test can determine whether the demand should become an offering, market action, or deferred learning.",
        confidence: "medium",
        evidence: readyDemand.map((item) => ({
          sourceKind: item.sourceKind,
          sourceId: item.id,
          asOf: item.asOf,
          measureKey: "demand",
        })),
        blindSpots: [
          "Capacity is unavailable.",
          "Contribution margin is unavailable.",
          "No sale may mean missing Product Sold evidence rather than zero real-world sales.",
        ],
        approvalBoundary: "recommend-only",
        followUpMeasure: "Recognized sales after a reviewed demand test",
      });
    }
  }

  const overdue = input.objectives.filter(
    (objective) => objective.reviewDue,
  );
  if (overdue.length > 0) {
    recommendations.push({
      recommendationId: recommendationId("outcome-review", null),
      issue: "outcome-review",
      action: "investigate",
      productId: null,
      title: "Review overdue outcome evidence",
      interpretation: `${overdue.length} active product ${
        overdue.length === 1 ? "objective is" : "objectives are"
      } due for review.`,
      expectedEffect:
        "The next product-line decision uses current outcome evidence and explicit missing data.",
      confidence: "high",
      evidence: overdue.map((objective) => ({
        sourceKind: objective.sourceKind,
        sourceId: objective.objectiveId,
        asOf: objective.asOf,
        measureKey: "outcome-progress",
      })),
      blindSpots: [],
      approvalBoundary: "recommend-only",
      followUpMeasure: "Overdue active objectives",
    });
  }

  if (input.commercialEvidenceFreshness === "stale") {
    recommendations.push({
      recommendationId: recommendationId("stale-evidence", null),
      issue: "stale-evidence",
      action: "investigate",
      productId: null,
      title: "Refresh commercial evidence",
      interpretation:
        "The newest Product Sold evidence is older than the freshness window.",
      expectedEffect:
        "Comparisons and any later WWWD consultation use a current evidence window.",
      confidence: "high",
      evidence:
        input.line.measures.find(
          (measure) => measure.key === "completed-sales",
        )?.evidence ?? [],
      blindSpots: [],
      approvalBoundary: "recommend-only",
      followUpMeasure: "Newest Product Sold evidence date",
    });
  }
  return recommendations;
}

export function describeRecommendationForAudience(
  recommendation: ProductPerformanceRecommendation,
  audience: ProductPerformanceAudience,
): {
  actionLabel: string;
  detailLevel: "plain" | "technical";
  summary: string;
} {
  if (audience === "owner-operator") {
    return {
      actionLabel:
        recommendation.issue === "attribution-gap"
          ? "Check the package split"
          : recommendation.issue === "outcome-review"
            ? "Review what changed"
            : "Look into this",
      detailLevel: "plain",
      summary: `${recommendation.interpretation} ${recommendation.expectedEffect}`,
    };
  }
  return {
    actionLabel:
      recommendation.issue === "attribution-gap"
        ? "Investigate attribution"
        : recommendation.issue === "outcome-review"
          ? "Review outcome evidence"
          : "Investigate evidence",
    detailLevel: "technical",
    summary: recommendation.interpretation,
  };
}
