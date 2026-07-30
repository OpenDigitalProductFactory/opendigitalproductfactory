// Server-only loader for the Demand board. Selects the demand-scoring fields
// (added in the scoring-foundation slice) for every non-terminal backlog item
// so the board can render the funnel and the value x effort matrix.

import { cache } from "react";
import { prisma } from "@dpf/db";
import type { DemandItemView } from "./board";
import { isPrismaMissingColumnError } from "./prisma-missing-column";
import { buildDemandActivationState } from "./activation";
import { resolveEstimateProvenance } from "./estimate-provenance";
import {
  DEMAND_SCORE_FRAMEWORKS,
  type DemandScoreFramework,
} from "../explore/backlog";
import { buildProductManagementProjectionWhere } from "../product-management/product-management-scope";

type DemandRow = {
  itemId: string;
  title: string;
  body?: string | null;
  status: string;
  workType: string | null;
  demandStage: string | null;
  demandScore: number | null;
  demandScoreFramework: string | null;
  effortSize: string | null;
  jobSize: number | null;
  impact: number | null;
  investmentBucket: string | null;
  estimateAiJobSize: number | null;
  estimateHumanJobSize: number | null;
  estimateSource: string | null;
  estimateAgreed: boolean | null;
  claimStatus: string | null;
  claimedByAgentId: string | null;
  organizationId?: string | null;
  productLineId?: string | null;
  businessProductId?: string | null;
  digitalProductId?: string | null;
  reach?: number | null;
  occurrenceCount?: number | null;
  confidence?: number | null;
  businessValue?: number | null;
  timeCriticality?: number | null;
  riskOpportunity?: number | null;
  demandEvidenceLinks?: Array<{
    evidenceLinkId: string;
    sourceKind: string;
    sourceRef: string;
    title: string;
    summary: string | null;
    confidence: number | null;
    reviewedAt: Date | null;
  }>;
  activities?: Array<{
    kind: string;
    summary: string;
    recordedAt: Date;
    payload: unknown;
  }>;
  _count?: { activities: number };
  epic: { epicId: string } | null;
};

/** Pure map from Prisma rows → board view models (unit-tested). */
export function mapDemandRows(rows: DemandRow[]): DemandItemView[] {
  return rows.map((r) => {
    const framework = (
      DEMAND_SCORE_FRAMEWORKS as readonly string[]
    ).includes(r.demandScoreFramework ?? "")
      ? (r.demandScoreFramework as DemandScoreFramework)
      : "rice";
    const estimate = resolveEstimateProvenance({
      aiJobSize: r.estimateAiJobSize,
      humanJobSize: r.estimateHumanJobSize,
      agreed: r.estimateAgreed,
    });
    const evidenceLinks = (r.demandEvidenceLinks ?? []).map((link) => ({
      ...link,
      reviewedAt: link.reviewedAt?.toISOString() ?? null,
    }));
    return {
      itemId: r.itemId,
      title: r.title,
      problemStatement: r.body ?? null,
      status: r.status,
      workType: r.workType,
      epicId: r.epic?.epicId ?? null,
      demandStage: r.demandStage,
      demandScore: r.demandScore,
      demandScoreFramework: r.demandScoreFramework,
      effortSize: r.effortSize,
      jobSize: r.jobSize,
      impact: r.impact,
      investmentBucket: r.investmentBucket,
      estimateAiJobSize: r.estimateAiJobSize,
      estimateHumanJobSize: r.estimateHumanJobSize,
      estimateSource: r.estimateSource,
      estimateAgreed: r.estimateAgreed,
      claimStatus: r.claimStatus,
      claimedByAgentId: r.claimedByAgentId,
      organizationId: r.organizationId ?? null,
      productLineId: r.productLineId ?? null,
      businessProductId: r.businessProductId ?? null,
      digitalProductId: r.digitalProductId ?? null,
      evidenceLinks,
      decisionHistory: (r.activities ?? []).map((activity) => ({
        kind: activity.kind,
        summary: activity.summary,
        recordedAt: activity.recordedAt.toISOString(),
        payload:
          activity.payload &&
          typeof activity.payload === "object" &&
          !Array.isArray(activity.payload)
            ? (activity.payload as Record<string, unknown>)
            : {},
      })),
      activation: buildDemandActivationState({
        demandStage: r.demandStage,
        status: r.status,
        problemStatement: r.body ?? null,
        evidenceCount: evidenceLinks.length,
        framework,
        scoreInputs: {
          reach: r.reach ?? null,
          occurrenceCount: r.occurrenceCount ?? null,
          impact: r.impact,
          confidence: r.confidence ?? null,
          businessValue: r.businessValue ?? null,
          timeCriticality: r.timeCriticality ?? null,
          riskOpportunity: r.riskOpportunity ?? null,
          jobSize: r.jobSize,
          effortSize: r.effortSize,
        },
        investmentBucket: r.investmentBucket,
        estimateSource: estimate.source,
        estimateAgreed: r.estimateAgreed,
        estimateDiverged: estimate.diverged,
        fundingDecisionAllowed: false,
      }),
      fundingDecisionCount: r._count?.activities ?? 0,
    };
  });
}

export type DemandScopeFilter = {
  organizationId?: string;
  productLineId?: string;
  businessProductId?: string;
  digitalProductId?: string;
};

export const getDemandItems = cache(async (
  scope: DemandScopeFilter = {},
): Promise<DemandItemView[]> => {
  try {
    const scopedWhere = scope.organizationId?.trim()
      ? buildProductManagementProjectionWhere({
          organizationId: scope.organizationId,
          productLineIds: scope.productLineId ? [scope.productLineId] : [],
          businessProductIds: scope.businessProductId
            ? [scope.businessProductId]
            : [],
          digitalProductIds: scope.digitalProductId
            ? [scope.digitalProductId]
            : [],
        })
      : {};
    const rows = await prisma.backlogItem.findMany({
      where: {
        status: { notIn: ["done", "deferred"] },
        ...scopedWhere,
      },
      orderBy: [{ demandScore: "desc" }, { createdAt: "asc" }],
      select: {
        itemId: true,
        title: true,
        body: true,
        status: true,
        workType: true,
        demandStage: true,
        demandScore: true,
        demandScoreFramework: true,
        effortSize: true,
        jobSize: true,
        impact: true,
        investmentBucket: true,
        estimateAiJobSize: true,
        estimateHumanJobSize: true,
        estimateSource: true,
        estimateAgreed: true,
        claimStatus: true,
        claimedByAgentId: true,
        organizationId: true,
        productLineId: true,
        businessProductId: true,
        digitalProductId: true,
        reach: true,
        occurrenceCount: true,
        confidence: true,
        businessValue: true,
        timeCriticality: true,
        riskOpportunity: true,
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
        _count: {
          select: {
            activities: {
              where: { kind: "demand_funding_decision" },
            },
          },
        },
        epic: { select: { epicId: true } },
      },
    });
    return mapDemandRows(rows);
  } catch (err) {
    // Install lagging the estimate-provenance migration must not 500 the board
    // (BI-PIR-1d2d84a3). Empty list + log is the fail-soft path until migrate.
    if (isPrismaMissingColumnError(err)) {
      console.warn(
        "[getDemandItems] BacklogItem schema behind migrations (missing estimate columns) — returning empty demand board. Advance via self-upgrade/migrate.",
        err,
      );
      return [];
    }
    throw err;
  }
});
