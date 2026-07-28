// Research proposal + approval gate (BI-8A58C65A, EP-CORPUS-BOOTSTRAP) — slice B.
//
// The founder's open-Q#4 model: AI research is SCHEDULED, PROPOSED, and
// requests human APPROVAL before any web/LLM execution. This module owns the
// proposal lifecycle on the ResearchProposal table:
//   propose (schedule/gap/user) → pending
//   approve → approved  (fires the onApproved seam → slice C execution)
//   decline → declined
//
// Execution and scheduling are separate slices; the `onApproved` seam keeps
// this layer pure and testable and decoupled from how research runs.

import { prisma } from "@dpf/db";

export type ResearchProposalStatus =
  | "pending"
  | "approved"
  | "declined"
  | "executed"
  | "failed";

export type ProposedBy = "schedule" | "gap-detection" | "user";

/** The fields a downstream executor (slice C) needs from an approved proposal. */
export type ApprovedProposal = {
  proposalId: string;
  organizationId: string;
  digitalProductId: string | null;
  topic: string;
  query: string;
};

/** Seam to slice C (execution). Invoked exactly once when a proposal is approved. */
export type OnApproved = (proposal: ApprovedProposal) => Promise<void>;

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type ResearchProposalClient = {
  researchProposal: {
    findFirst: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
};

function db(deps: { db?: ResearchProposalClient }): ResearchProposalClient {
  return deps.db ?? (prisma as unknown as ResearchProposalClient);
}

// ─── Propose ─────────────────────────────────────────────────────────────────

export type ProposeResearchInput = {
  organizationId: string;
  /** Null/omitted means organization-wide research. Never infer this link. */
  digitalProductId?: string | null;
  topic: string;
  query: string;
  proposedBy?: ProposedBy;
};

export type ProposeResearchResult = { proposalId: string; created: boolean };

/** Create a pending proposal, deduping to an existing pending one for the same
 *  (org, topic) so a recurring schedule / repeated gap doesn't pile up
 *  duplicate approvals. */
export async function proposeResearch(
  input: ProposeResearchInput,
  deps: { db?: ResearchProposalClient } = {},
): Promise<ProposeResearchResult> {
  const client = db(deps);

  const existing = (await client.researchProposal.findFirst({
    where: {
      organizationId: input.organizationId,
      digitalProductId: input.digitalProductId ?? null,
      topic: input.topic,
      status: "pending",
    },
    select: { proposalId: true },
  })) as { proposalId: string } | null;
  if (existing) return { proposalId: existing.proposalId, created: false };

  const created = (await client.researchProposal.create({
    data: {
      organizationId: input.organizationId,
      digitalProductId: input.digitalProductId ?? null,
      topic: input.topic,
      query: input.query,
      status: "pending",
      proposedBy: input.proposedBy ?? "schedule",
    },
  })) as { proposalId: string };
  return { proposalId: created.proposalId, created: true };
}

// ─── Approve ─────────────────────────────────────────────────────────────────

export type ApproveResearchInput = { proposalId: string; decidedByUserId?: string | null };
export type ApproveResearchResult = { approved: boolean; proposal: ApprovedProposal | null };

/** Transition pending → approved and fire the onApproved seam exactly once.
 *  A no-op (approved=false, seam not fired) for any non-pending proposal, so a
 *  double-click or replay never re-runs execution. */
export async function approveResearch(
  input: ApproveResearchInput,
  deps: { db?: ResearchProposalClient; onApproved?: OnApproved } = {},
): Promise<ApproveResearchResult> {
  const client = db(deps);

  const row = (await client.researchProposal.findFirst({
    where: { proposalId: input.proposalId },
    select: {
      proposalId: true,
      organizationId: true,
      digitalProductId: true,
      topic: true,
      query: true,
      status: true,
    },
  })) as (ApprovedProposal & { status: string }) | null;

  if (!row || row.status !== "pending") return { approved: false, proposal: null };

  await client.researchProposal.update({
    where: { proposalId: input.proposalId },
    data: { status: "approved", decidedByUserId: input.decidedByUserId ?? null, decidedAt: new Date() },
  });

  const proposal: ApprovedProposal = {
    proposalId: row.proposalId,
    organizationId: row.organizationId,
    digitalProductId: row.digitalProductId,
    topic: row.topic,
    query: row.query,
  };
  if (deps.onApproved) await deps.onApproved(proposal);
  return { approved: true, proposal };
}

// ─── Decline ─────────────────────────────────────────────────────────────────

export type DeclineResearchInput = { proposalId: string; decidedByUserId?: string | null };
export type DeclineResearchResult = { declined: boolean };

export async function declineResearch(
  input: DeclineResearchInput,
  deps: { db?: ResearchProposalClient } = {},
): Promise<DeclineResearchResult> {
  const client = db(deps);

  const row = (await client.researchProposal.findFirst({
    where: { proposalId: input.proposalId },
    select: { status: true },
  })) as { status: string } | null;
  if (!row || row.status !== "pending") return { declined: false };

  await client.researchProposal.update({
    where: { proposalId: input.proposalId },
    data: { status: "declined", decidedByUserId: input.decidedByUserId ?? null, decidedAt: new Date() },
  });
  return { declined: true };
}

// ─── List (approval UI) ──────────────────────────────────────────────────────

export type PendingResearchProposal = {
  proposalId: string;
  digitalProductId: string | null;
  topic: string;
  query: string;
  proposedBy: string;
  proposedAt: Date;
};

/** Pending proposals for an org, newest first — feeds the approval UI. */
export async function listPendingResearchProposals(
  organizationId: string,
  deps: { db?: ResearchProposalClient } = {},
): Promise<PendingResearchProposal[]> {
  const client = db(deps);
  return (await client.researchProposal.findMany({
    where: { organizationId, status: "pending" },
    orderBy: { proposedAt: "desc" },
    select: {
      proposalId: true,
      digitalProductId: true,
      topic: true,
      query: true,
      proposedBy: true,
      proposedAt: true,
    },
  })) as PendingResearchProposal[];
}
