// apps/web/lib/evaluate/improvement-data.ts
// Read model for the Improvements EVIDENCE view (EP-INTAKE-UNIFY Phase 6).
//
// An improvement proposal is EVIDENCE of observed friction; the WORK lives in
// the backlog. So this read joins each proposal to its linked BacklogItem and
// surfaces the backlog item's canonical status — there is no separate
// improvement lifecycle to track. Skill proposals (category="skill") are
// excluded: they run the governed skill-revision lifecycle, not the backlog.

import { cache } from "react";
import { prisma } from "@dpf/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ImprovementEvidenceRow = {
  id: string;
  proposalId: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  agentId: string;
  routeContext: string;
  observedFriction: string | null;
  submittedByEmail: string;
  /** Semantic backlog id (BI-…) this proposal is filed as. Null only transiently. */
  backlogItemId: string | null;
  /** Canonical lifecycle status from the linked BacklogItem (the one lifecycle). */
  backlogStatus: string | null;
  /** Linked backlog item triage outcome (build/defer/discard/…), when triaged. */
  backlogTriageOutcome: string | null;
  createdAt: string;
};

/** Tally of evidence rows by their linked backlog status, for the header summary. */
export type ImprovementEvidenceSummary = {
  total: number;
  tracked: number;
  byBacklogStatus: Record<string, number>;
};

// ─── Queries ─────────────────────────────────────────────────────────────────

export const getImprovementProposals = cache(async (): Promise<ImprovementEvidenceRow[]> => {
  const rows = await prisma.improvementProposal.findMany({
    where: { category: { not: "skill" } },
    orderBy: { createdAt: "desc" },
    include: { submittedBy: { select: { email: true } } },
  });

  // Resolve linked backlog statuses in one batch (backlogItemId holds the
  // semantic BI-… id, which is BacklogItem.itemId — there is no Prisma relation).
  const linkedIds = Array.from(
    new Set(rows.map((r) => r.backlogItemId).filter((v): v is string => Boolean(v))),
  );
  const backlogItems = linkedIds.length
    ? await prisma.backlogItem.findMany({
        where: { itemId: { in: linkedIds } },
        select: { itemId: true, status: true, triageOutcome: true },
      })
    : [];
  const byItemId = new Map(backlogItems.map((b) => [b.itemId, b]));

  return rows.map((r) => {
    const linked = r.backlogItemId ? byItemId.get(r.backlogItemId) : undefined;
    return {
      id: r.id,
      proposalId: r.proposalId,
      title: r.title,
      description: r.description,
      category: r.category,
      severity: r.severity,
      agentId: r.agentId,
      routeContext: r.routeContext,
      observedFriction: r.observedFriction,
      submittedByEmail: r.submittedBy.email,
      backlogItemId: r.backlogItemId,
      backlogStatus: linked?.status ?? null,
      backlogTriageOutcome: linked?.triageOutcome ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  });
});

/** Summarize evidence rows by their linked backlog status. Pure. */
export function summarizeImprovementEvidence(
  rows: ImprovementEvidenceRow[],
): ImprovementEvidenceSummary {
  const byBacklogStatus: Record<string, number> = {};
  let tracked = 0;
  for (const r of rows) {
    if (r.backlogItemId) tracked += 1;
    const key = r.backlogStatus ?? "unlinked";
    byBacklogStatus[key] = (byBacklogStatus[key] ?? 0) + 1;
  }
  return { total: rows.length, tracked, byBacklogStatus };
}
