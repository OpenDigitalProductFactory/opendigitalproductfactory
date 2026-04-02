// apps/web/lib/proposal-data.ts
import { cache } from "react";
import { prisma } from "@dpf/db";

export type ProposalRow = {
  proposalId: string;
  agentId: string;
  actionType: string;
  parameters: Record<string, unknown>;
  status: string;
  proposedAt: string;
  decidedAt: string | null;
  decidedByEmail: string | null;
  executedAt: string | null;
  resultEntityId: string | null;
  resultError: string | null;
};

export type ProposalStats = {
  total: number;
  proposed: number;
  executed: number;
  rejected: number;
  failed: number;
};

export const getProposals = cache(async (): Promise<ProposalRow[]> => {
  const rows = await prisma.agentActionProposal.findMany({
    orderBy: { proposedAt: "desc" },
    include: {
      decidedBy: { select: { email: true } },
    },
  });

  return rows.map((r) => ({
    proposalId: r.proposalId,
    agentId: r.agentId,
    actionType: r.actionType,
    parameters: r.parameters as Record<string, unknown>,
    status: r.status,
    proposedAt: r.proposedAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decidedByEmail: r.decidedBy?.email ?? null,
    executedAt: r.executedAt?.toISOString() ?? null,
    resultEntityId: r.resultEntityId,
    resultError: r.resultError,
  }));
});

export const getProposalStats = cache(async (): Promise<ProposalStats> => {
  const [total, proposed, executed, rejected, failed] = await Promise.all([
    prisma.agentActionProposal.count(),
    prisma.agentActionProposal.count({ where: { status: "proposed" } }),
    prisma.agentActionProposal.count({ where: { status: "executed" } }),
    prisma.agentActionProposal.count({ where: { status: "rejected" } }),
    prisma.agentActionProposal.count({ where: { status: "failed" } }),
  ]);
  return { total, proposed, executed, rejected, failed };
});
