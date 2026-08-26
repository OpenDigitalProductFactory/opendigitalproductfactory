// Coworker-envelope source — CoworkerActionEnvelope rows in status `proposed`
// that belong to the reading user.
//
// A governed coworker whose authority decision returns `require-approval` gets a
// CoworkerActionEnvelope and its TaskRun is parked on `input-required`
// (lib/coworker/authority-approval-envelope.ts). Until BI-7CB2CCDE the inbox had
// no loader for that table at all, so the only Approve control on the page came
// from the AgentActionProposal source — a different record class entirely, whose
// button could only ever settle unrelated work. This source is the missing half.
//
// Two rules govern it:
//
//   1. Delegating-user isolation. `delegatingUserId` is the ONLY user who may
//      decide an envelope (assertCallerIsDelegate in envelope-actions.ts), so it
//      is a required query predicate here, not a post-filter. No user id, no
//      query, no items.
//   2. Only live proposals are actionable. Resolved and expired envelopes are
//      excluded in the query AND re-checked in the pure projector, so a stale
//      render cannot present a control the state machine would refuse.
//
// Spec: docs/superpowers/specs/2026-06-23-human-attention-surface-design.md §4.1.

import type { prisma } from "@dpf/db";

import { observeEnvelopeBacklog } from "@/lib/coworker/envelope-observability";
import {
  envelopeApproveRoute,
  envelopeDeclineRoute,
} from "@/lib/coworker/envelope-routes";
import {
  coworkerEnvelopesAwaitingDecision,
  coworkerEnvelopesExpiredUnactioned,
} from "@/lib/operate/metrics";
import { parseInitiativeReviewBinding } from "@/lib/mcp-task-submit";

import { attentionAuthorForAgent } from "../attribution";
import type {
  AttentionEnvelopeApproval,
  AttentionEnvelopeReviewBinding,
  AttentionItem,
  TimeToAct,
} from "../types";

type Db = typeof prisma;

/** The envelope columns this projection reads, plus the bound TaskRun's
 *  metadata. Structural so the pure projector is testable without Prisma. */
export type CoworkerEnvelopeRow = {
  id: string;
  coworkerAgentId: string;
  delegatingUserId: string;
  manifestActionId: string;
  rationale: string;
  status: string;
  taskRunId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  taskRun: { a2aMetadata: unknown } | null;
};

/** The one status that can still be decided. Every other value in the
 *  envelope state machine is either mid-flight or terminal. */
const DECIDABLE_STATUS = "proposed";

/** The immutable artifact the reviewer was bound to, when the task carries one.
 *  Reuses the canonical parser rather than re-reading the shape locally. */
function reviewBindingOf(
  row: CoworkerEnvelopeRow,
): AttentionEnvelopeReviewBinding | undefined {
  const metadata = row.taskRun?.a2aMetadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const binding = parseInitiativeReviewBinding(
    (metadata as Record<string, unknown>).initiativeReviewBinding,
  );
  if (!binding) return undefined;
  return {
    gate: binding.gate,
    itemId: binding.itemId,
    repositoryFullName: binding.artifactRef.repositoryFullName,
    commitSha: binding.artifactRef.commitSha,
    path: binding.artifactRef.path,
    providerBlobId: binding.artifactRef.providerBlobId,
  };
}

/** How close the approval window is to closing. An envelope with no expiry has
 *  no deadline to report. */
function timeToAct(expiresAt: Date | null, nowMs: number): TimeToAct {
  if (!expiresAt) return "none";
  const msLeft = expiresAt.getTime() - nowMs;
  if (msLeft <= 0) return "overdue";
  if (msLeft <= 86_400_000) return "due-today";
  return "due-soon";
}

/** Pure projection of one envelope row into an attention item. */
export function coworkerEnvelopeToAttentionItem(
  row: CoworkerEnvelopeRow,
  nowMs: number,
): AttentionItem {
  const expired = row.expiresAt !== null && row.expiresAt.getTime() <= nowMs;
  const reviewBinding = reviewBindingOf(row);
  const approval: AttentionEnvelopeApproval = {
    envelopeId: row.id,
    coworkerAgentId: row.coworkerAgentId,
    delegatingUserId: row.delegatingUserId,
    manifestActionId: row.manifestActionId,
    rationale: row.rationale,
    status: row.status,
    taskRunId: row.taskRunId,
    expiresAtIso: row.expiresAt?.toISOString() ?? null,
    actionable: row.status === DECIDABLE_STATUS && !expired,
    ...(reviewBinding ? { reviewBinding } : {}),
    approveHref: envelopeApproveRoute(row.id),
    declineHref: envelopeDeclineRoute(row.id),
  };

  const deadline = row.expiresAt?.toISOString();
  return {
    id: `coworker-envelope:${row.id}`,
    source: "coworker-envelope",
    // Raw, for technical detail only. The owner headline comes from the copy layer.
    title: `Approve ${row.manifestActionId} for ${row.coworkerAgentId}`,
    // The coworker's own stated reason — the rationale the owner decides on.
    context: row.rationale,
    decisionClass: { scorability: "unscorable" },
    riskClass: "bounded-write",
    triage: {
      timeToAct: timeToAct(row.expiresAt, nowMs),
      ...(deadline ? { deadlineIso: deadline } : {}),
      residueReason: "policy-approval",
      blastRadius: "the coworker task waiting on this approval",
      decideEffort: "review",
      // The approved action runs for real and its receipt cannot be unrecorded.
      irreversible: true,
    },
    createdAtIso: row.createdAt.toISOString(),
    portfolio: "for-employees",
    // Deliberately link-free. The decision belongs on THIS card, through the
    // envelope endpoints; an href here would become an owner button that
    // navigates away from the only surface that can settle the envelope.
    actions: [
      { kind: "approve", label: "Approve action" },
      { kind: "reject", label: "Decline" },
    ],
    deepLink: "/workspace/inbox",
    audience: { operator: true },
    technical: {
      detectedBy: row.coworkerAgentId,
      ...(approval.reviewBinding ? { backlogItemId: approval.reviewBinding.itemId } : {}),
    },
    author: attentionAuthorForAgent(row.coworkerAgentId, { trustLevel: "propose" }),
    envelope: approval,
  };
}

/**
 * Load the reading user's live envelope proposals.
 *
 * `delegatingUserId` is required. An anonymous or unresolved caller gets an
 * empty list and no query at all — an inbox must never fall back to "every
 * user's envelopes" when it cannot name the reader.
 */
export async function loadCoworkerEnvelopeItems(
  db: Db,
  delegatingUserId: string | undefined,
  nowMs: number = Date.now(),
): Promise<AttentionItem[]> {
  if (!delegatingUserId) return [];
  const now = new Date(nowMs);
  const rows = await db.coworkerActionEnvelope.findMany({
    where: {
      delegatingUserId,
      status: DECIDABLE_STATUS,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      coworkerAgentId: true,
      delegatingUserId: true,
      manifestActionId: true,
      rationale: true,
      status: true,
      taskRunId: true,
      expiresAt: true,
      createdAt: true,
      taskRun: { select: { a2aMetadata: true } },
    },
  });
  // Fire-and-forget backlog observation (BI-78D3CF1E). The query above
  // deliberately EXCLUDES expired envelopes, because an expired one is not
  // actionable — which is exactly why nothing could see them lapsing. This
  // publishes the two gauges beside it: how many are waiting on a person, and
  // how many closed unanswered. Install-wide, because the operator's question is
  // "are consent requests lapsing here", not "are mine".
  void observeEnvelopeBacklog(
    {
      countProposedWithin: (at) =>
        db.coworkerActionEnvelope.count({
          where: {
            status: DECIDABLE_STATUS,
            OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
          },
        }),
      countProposedExpired: (at) =>
        db.coworkerActionEnvelope.count({
          where: {
            status: DECIDABLE_STATUS,
            resolvedAt: null,
            expiresAt: { lte: at },
          },
        }),
    },
    {
      awaiting: coworkerEnvelopesAwaitingDecision,
      expiredUnactioned: coworkerEnvelopesExpiredUnactioned,
    },
    now,
  ).catch(() => {
    // Observability must never affect the inbox it rides on.
  });

  return (rows as unknown as CoworkerEnvelopeRow[]).map((row) =>
    coworkerEnvelopeToAttentionItem(row, nowMs),
  );
}
