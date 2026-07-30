import { mapDemandRows } from "@/lib/demand/demand-data";
import { createContextSlice } from "./product-operating-context";
import { buildProductManagementProjectionWhere } from "./product-management-scope";
import type {
  BacklogRow,
  ProductOperatingContextQueryClient,
} from "./product-operating-context-query-types";

export function loadProductDemand(input: {
  db: ProductOperatingContextQueryClient;
  fullProfile: boolean;
  organizationId: string;
  productLineIds: string[];
  productIds: string[];
  digitalProductIds: string[];
}): Promise<BacklogRow[]> {
  if (!input.fullProfile) return Promise.resolve([]);
  return input.db.backlogItem.findMany({
    where: buildProductManagementProjectionWhere({
      organizationId: input.organizationId,
      productLineIds: input.productLineIds,
      businessProductIds: input.productIds,
      digitalProductIds: input.digitalProductIds,
    }),
    orderBy: [{ updatedAt: "desc" }, { itemId: "asc" }],
    take: 100,
    select: {
      itemId: true,
      title: true,
      body: true,
      status: true,
      workType: true,
      organizationId: true,
      productLineId: true,
      businessProductId: true,
      digitalProductId: true,
      demandStage: true,
      demandScore: true,
      demandScoreFramework: true,
      effortSize: true,
      jobSize: true,
      reach: true,
      occurrenceCount: true,
      impact: true,
      confidence: true,
      businessValue: true,
      timeCriticality: true,
      riskOpportunity: true,
      investmentBucket: true,
      estimateAiJobSize: true,
      estimateHumanJobSize: true,
      estimateSource: true,
      estimateAgreed: true,
      claimStatus: true,
      claimedByAgentId: true,
      demandEvidenceLinks: {
        where: { status: "active" },
        orderBy: { createdAt: "desc" },
        select: {
          evidenceLinkId: true,
          sourceKind: true,
          sourceRef: true,
          title: true,
          summary: true,
          confidence: true,
          reviewedAt: true,
        },
      },
      activities: {
        where: {
          kind: {
            in: [
              "demand_stage_transition",
              "demand_scored",
              "demand_funding_decision",
              "demand_evidence_linked",
              "demand_evidence_superseded",
            ],
          },
        },
        orderBy: { recordedAt: "desc" },
        take: 20,
        select: {
          kind: true,
          summary: true,
          recordedAt: true,
          payload: true,
        },
      },
      updatedAt: true,
      epic: {
        select: {
          epicId: true,
          title: true,
          status: true,
          updatedAt: true,
        },
      },
    },
  });
}

export function projectProductDemand(input: {
  demand: BacklogRow[];
  requestedAt: Date;
  fullProfile: boolean;
}) {
  const views = new Map(
    mapDemandRows(input.demand).map((view) => [view.itemId, view]),
  );
  return createContextSlice({
    requestedAt: input.requestedAt,
    sourceKind: "backlog-item",
    items: input.demand.map((row) => ({
      ...(views.get(row.itemId)?.activation
        ? {
            evidenceCount: views.get(row.itemId)!.activation!.score.evidenceCount,
            readiness: views.get(row.itemId)!.activation!.readiness,
            blockers: views.get(row.itemId)!.activation!.blockers,
            latestDecision: views.get(row.itemId)!.decisionHistory?.[0]
              ? {
                  summary: views.get(row.itemId)!.decisionHistory![0]!.summary,
                  recordedAt: new Date(
                    views.get(row.itemId)!.decisionHistory![0]!.recordedAt,
                  ),
                  payload: views.get(row.itemId)!.decisionHistory![0]!.payload,
                }
              : null,
          }
        : {}),
      id: row.itemId,
      sourceKind: "backlog-item",
      asOf: row.updatedAt,
      title: row.title,
      status: row.status,
      productLineId: row.productLineId,
      businessProductId: row.businessProductId,
      demandStage: row.demandStage,
      score: row.demandScore,
    })),
    partialReason:
      input.demand.length >= 250
        ? "Demand evidence is bounded to the 250 newest records."
        : undefined,
    unavailableReason: !input.fullProfile
      ? "Demand is outside the commercial-summary query profile."
      : undefined,
  });
}
