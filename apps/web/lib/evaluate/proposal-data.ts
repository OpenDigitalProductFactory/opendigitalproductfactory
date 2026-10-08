// apps/web/lib/proposal-data.ts
import { cache } from "react";
import { prisma } from "@dpf/db";
import { CONVERTED_ENVELOPE_WHERE } from "@/lib/coworker/converted-approval-requests";

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
  // BI-C8EC05C9 dual read: legacy proposals and the envelopes raised in their
  // place. No envelope is converted before PR-B, so the rows are unchanged.
  const [rows, envelopes] = await Promise.all([
    prisma.agentActionProposal.findMany({
      orderBy: { proposedAt: "desc" },
      include: {
        decidedBy: { select: { email: true } },
      },
    }),
    prisma.coworkerActionEnvelope.findMany({
      where: CONVERTED_ENVELOPE_WHERE,
      orderBy: { createdAt: "desc" },
      select: { id: true, coworkerAgentId: true, manifestActionId: true, status: true, createdAt: true, resolvedAt: true },
    }),
  ]);

  const proposals = rows.map((r): ProposalRow => ({
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
  if (envelopes.length === 0) return proposals;
  // An envelope stores no raw arguments (authority-approval-envelope.ts); the
  // request id and its status are what the history can show.
  const converted = envelopes.map((e): ProposalRow => ({
    proposalId: e.id,
    agentId: e.coworkerAgentId,
    actionType: e.manifestActionId,
    parameters: {},
    status: e.status,
    proposedAt: e.createdAt.toISOString(),
    decidedAt: e.resolvedAt?.toISOString() ?? null,
    decidedByEmail: null,
    executedAt: e.status === "executed" ? e.resolvedAt?.toISOString() ?? null : null,
    resultEntityId: null,
    resultError: null,
  }));
  return [...converted, ...proposals].sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
});

export const getProposalStats = cache(async (): Promise<ProposalStats> => {
  const converted = (status?: string) => prisma.coworkerActionEnvelope.count({
    where: { ...CONVERTED_ENVELOPE_WHERE, ...(status ? { status } : {}) },
  });
  const [total, proposed, executed, rejected, failed, cTotal, cProposed, cExecuted, cDeclined, cFailed] = await Promise.all([
    prisma.agentActionProposal.count(),
    prisma.agentActionProposal.count({ where: { status: "proposed" } }),
    prisma.agentActionProposal.count({ where: { status: "executed" } }),
    prisma.agentActionProposal.count({ where: { status: "rejected" } }),
    prisma.agentActionProposal.count({ where: { status: "failed" } }),
    converted(),
    converted("proposed"),
    converted("executed"),
    converted("declined"),
    converted("failed"),
  ]);
  return {
    total: total + cTotal,
    proposed: proposed + cProposed,
    executed: executed + cExecuted,
    rejected: rejected + cDeclined,
    failed: failed + cFailed,
  };
});
