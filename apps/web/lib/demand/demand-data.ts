// Server-only loader for the Demand board. Selects the demand-scoring fields
// (added in the scoring-foundation slice) for every non-terminal backlog item
// so the board can render the funnel and the value x effort matrix.

import { cache } from "react";
import { prisma } from "@dpf/db";
import type { DemandItemView } from "./board";
import { isPrismaMissingColumnError } from "./prisma-missing-column";

type DemandRow = {
  itemId: string;
  title: string;
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
  epic: { epicId: string } | null;
};

/** Pure map from Prisma rows → board view models (unit-tested). */
export function mapDemandRows(rows: DemandRow[]): DemandItemView[] {
  return rows.map((r) => ({
    itemId: r.itemId,
    title: r.title,
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
  }));
}

export const getDemandItems = cache(async (): Promise<DemandItemView[]> => {
  try {
    const rows = await prisma.backlogItem.findMany({
      where: { status: { notIn: ["done", "deferred"] } },
      orderBy: [{ demandScore: "desc" }, { createdAt: "asc" }],
      select: {
        itemId: true,
        title: true,
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
