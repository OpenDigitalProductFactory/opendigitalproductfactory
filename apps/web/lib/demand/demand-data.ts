// Server-only loader for the Demand board. Selects the demand-scoring fields
// (added in the scoring-foundation slice) for every non-terminal backlog item
// so the board can render the funnel and the value x effort matrix.

import { cache } from "react";
import { prisma } from "@dpf/db";
import type { DemandItemView } from "./board";

export const getDemandItems = cache(async (): Promise<DemandItemView[]> => {
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
      epic: { select: { epicId: true } },
    },
  });
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
  }));
});
