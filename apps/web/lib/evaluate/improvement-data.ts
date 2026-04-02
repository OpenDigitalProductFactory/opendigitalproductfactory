// apps/web/lib/improvement-data.ts
// Cached query functions for improvement proposals.

import { cache } from "react";
import { prisma } from "@dpf/db";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ImprovementRow = {
  id: string;
  proposalId: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  agentId: string;
  routeContext: string;
  threadId: string | null;
  observedFriction: string | null;
  conversationExcerpt: string | null;
  status: string;
  submittedByEmail: string;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  prioritizedAt: string | null;
  backlogItemId: string | null;
  rejectionReason: string | null;
  verifiedAt: string | null;
  contributionStatus: string;
  createdAt: string;
};

// ─── Queries ─────────────────────────────────────────────────────────────────

export const getImprovementProposals = cache(async (): Promise<ImprovementRow[]> => {
  const rows = await prisma.improvementProposal.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      submittedBy: { select: { email: true } },
      reviewedBy: { select: { email: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    proposalId: r.proposalId,
    title: r.title,
    description: r.description,
    category: r.category,
    severity: r.severity,
    agentId: r.agentId,
    routeContext: r.routeContext,
    threadId: r.threadId,
    observedFriction: r.observedFriction,
    conversationExcerpt: r.conversationExcerpt,
    status: r.status,
    submittedByEmail: r.submittedBy.email,
    reviewedByEmail: r.reviewedBy?.email ?? null,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    prioritizedAt: r.prioritizedAt?.toISOString() ?? null,
    backlogItemId: r.backlogItemId,
    rejectionReason: r.rejectionReason,
    verifiedAt: r.verifiedAt?.toISOString() ?? null,
    contributionStatus: r.contributionStatus,
    createdAt: r.createdAt.toISOString(),
  }));
});

export const getImprovementCounts = cache(async (): Promise<Record<string, number>> => {
  const rows = await prisma.improvementProposal.groupBy({
    by: ["status"],
    _count: true,
  });
  const counts: Record<string, number> = {};
  for (const r of rows) {
    counts[r.status] = r._count;
  }
  return counts;
});
