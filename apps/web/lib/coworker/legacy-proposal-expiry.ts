// Legacy AgentActionProposal expiry (BI-753D69A9, WWMD DI-738A194A7A61).
//
// Since approval convergence (spec 2026-10-07 D8) nothing creates
// AgentActionProposal rows, and the Needs-you inbox routes the generic legacy
// card to the custodian lane, so a row still `proposed` has no one who can
// decide it. Coworker approval envelopes lapse under one lifetime rule
// (approval-lifetime.ts); this applies the same durable lifetime to the legacy
// rows. A lapsed row becomes `expired`: a status change only. The row, its
// parameters and its history are kept (D8). If the action still matters, the
// coworker raises a fresh, governed envelope.
//
// Excluded:
//   - leave.decide: a recommendation the manager settles on the leave page with
//     Approve leave / Deny leave (lib/actions/leave.ts), not an approval request.
//     It has its own decision surface and lifecycle (D2 S5).
//   - propose_proactivity_change: D8 keeps its legacy handlers so "any pending
//     row on any install" stays decidable. Its Needs-you card carries its own
//     scope as blast radius, so it is not routed to the hidden custodian lane.

import * as crypto from "crypto";
import type { prisma } from "@dpf/db";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { LEAVE_DECISION_ACTION } from "@/lib/workforce/leave/leave-decision-proposal-contract";
import { PROACTIVITY_CHANGE_ACTION } from "@/lib/proactivity/proactivity-change-proposal";
import { DURABLE_APPROVAL_LIFETIME_MS } from "./approval-lifetime";

export const LEGACY_PROPOSAL_EXPIRY_DECISION_REF = "DI-738A194A7A61";
export const LEGACY_PROPOSAL_EXPIRY_ACTOR = "legacy-proposal-expiry-sweep";
export const LEGACY_PROPOSAL_EXPIRED_STATUS = "expired";

export const LEGACY_PROPOSAL_EXPIRY_EXCLUDED_ACTIONS: readonly string[] = [
  LEAVE_DECISION_ACTION,
  PROACTIVITY_CHANGE_ACTION,
];

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_BATCHES = 20;
const DAY_MS = 86_400_000;

export type LegacyProposalExpiryDb = Pick<typeof prisma, "agentActionProposal" | "$transaction">;

export type LegacyProposalExpiryResult = {
  expired: number;
  alreadySettled: number;
  failed: number;
  truncated: boolean;
  errors: string[];
};

export function legacyProposalExpiredMessage(actionType: string): string {
  const days = Math.round(DURABLE_APPROVAL_LIFETIME_MS / DAY_MS);
  return `${actionType} was not decided within its ${days}-day approval window and has expired; nothing ran. Ask again if it is still needed.`;
}

type PendingRow = { id: string; proposalId: string; threadId: string; agentId: string; actionType: string; proposedAt: Date };

async function expireOne(db: LegacyProposalExpiryDb, row: PendingRow, now: Date): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const claimed = await tx.agentActionProposal.updateMany({
      where: { id: row.id, status: "proposed" },
      data: { status: LEGACY_PROPOSAL_EXPIRED_STATUS, decidedAt: now },
    });
    if (claimed.count === 0) return false;
    await tx.authorizationDecisionLog.create({
      data: {
        decisionId: `DEC-${crypto.randomUUID()}`,
        actionKey: row.actionType,
        objectRef: row.proposalId,
        actorType: "system",
        actorRef: LEGACY_PROPOSAL_EXPIRY_ACTOR,
        decision: "deny",
        rationale: {
          proposalId: row.proposalId,
          rule: "approval-lifetime",
          lifetimeMs: DURABLE_APPROVAL_LIFETIME_MS,
          proposedAt: row.proposedAt.toISOString(),
          decisionRef: LEGACY_PROPOSAL_EXPIRY_DECISION_REF,
          reason: "Not decided within the durable approval lifetime; expired, nothing ran.",
        },
      },
    });
    await tx.agentMessage.create({
      data: {
        threadId: row.threadId,
        role: "system",
        content: legacyProposalExpiredMessage(row.actionType),
        agentId: row.agentId,
      },
    });
    return true;
  });
}

/**
 * Expire every legacy proposal still `proposed` after the durable approval
 * lifetime, in bounded batches. Each row is a compare-and-set on
 * `status: "proposed"`, so a concurrent decision or a second run is a no-op.
 */
export async function expireLapsedLegacyProposals(
  db: LegacyProposalExpiryDb,
  options: { now?: Date; batchSize?: number; maxBatches?: number } = {},
): Promise<LegacyProposalExpiryResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;
  const cutoff = new Date(now.getTime() - DURABLE_APPROVAL_LIFETIME_MS);
  const result: LegacyProposalExpiryResult = { expired: 0, alreadySettled: 0, failed: 0, truncated: false, errors: [] };
  const failedIds: string[] = [];

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const rows: PendingRow[] = await db.agentActionProposal.findMany({
      where: {
        status: "proposed",
        proposedAt: { lt: cutoff },
        actionType: { notIn: [...LEGACY_PROPOSAL_EXPIRY_EXCLUDED_ACTIONS] },
        ...(failedIds.length > 0 ? { id: { notIn: [...failedIds] } } : {}),
      },
      orderBy: { proposedAt: "asc" },
      take: batchSize,
      select: { id: true, proposalId: true, threadId: true, agentId: true, actionType: true, proposedAt: true },
    });

    for (const row of rows) {
      try {
        if (await expireOne(db, row, now)) result.expired += 1;
        else result.alreadySettled += 1;
      } catch (error) {
        result.failed += 1;
        failedIds.push(row.id);
        result.errors.push(`${row.proposalId}: ${getErrorMessage(error)}`);
      }
    }

    if (rows.length < batchSize) return result;
    if (batch === maxBatches - 1) result.truncated = true;
  }
  return result;
}
