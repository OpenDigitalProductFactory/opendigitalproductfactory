// "Ask again": raise an expired, unanswered approval request again (BI-0012E6CA).
//
// A request nobody answered used to be lost: its window closed, the inbox
// dropped it, and only the coworker could bring it back — if it remembered to.
// The person it was for can now put the same exact request back in front of
// themselves from the inbox.
//
// What this does and does not authorize:
//   - It authorizes NOTHING. It mints a fresh `proposed` envelope copied from
//     the expired one; the person still has to Authorize it, and an approved
//     call still runs through the full coworker authority gate, which re-checks
//     grants, delegation, data policy and the exact binding at execution.
//   - Only the delegating user may ask again (the same rule as every other
//     envelope verb), only for a request that lapsed UNANSWERED, and only when
//     the stored binding still proves which exact call it was.
//   - The fresh lifetime follows the call's CURRENT classification
//     (approval-lifetime.ts), not the one it was raised under.
//   - Nothing re-raises on its own. There is no sweep: an automatic re-raise
//     would loop forever for a delegate who never comes back, and would add
//     escalations the escalation gate never decided.

import "server-only";

import { prisma, type Prisma } from "@dpf/db";

import { originalToolParameters } from "@/lib/attention/coworker-envelope-decision";
import {
  fingerprintCoworkerApprovalBinding,
  type CoworkerApprovalBinding,
} from "@/lib/govern/authority/coworker-authority-decision";
import { isRecord } from "@/lib/shared/coerce";

import { approvalLifetimeMs } from "./approval-lifetime";
import { classifyApprovalCallAgainst, type ClassifyApprovalCall } from "./approval-classification";
import { err, ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";

type EnvelopeRecord = {
  id: string;
  coworkerAgentId: string;
  delegatingUserId: string;
  threadId: string;
  chatMessageId: string | null;
  manifestActionId: string;
  argsJson: unknown;
  rationale: string;
  status: string;
  taskRunId: string | null;
  delegationChainId: string | null;
  authorityDecisionId: string | null;
  inputFingerprint: string | null;
  approvalBindingFingerprint: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  resolvedAt: Date | null;
};

type PendingProposal = {
  threadId: string;
  agentId: string;
  userId: string;
  toolName: string;
  parameters: unknown;
  result: unknown;
  routeContext: string | null;
  auditClass: string | null;
  capabilityId: string | null;
  summary: string | null;
  apiTokenId: string | null;
  taskRunId: string | null;
  skillId: string | null;
  delegatingUserId: string | null;
  chatMessageId: string | null;
  delegationChainId: string | null;
};

type ReraiseTx = {
  coworkerActionEnvelope: {
    updateMany(args: unknown): Promise<{ count: number }>;
    create(args: unknown): Promise<EnvelopeRecord>;
  };
  toolExecution: { create(args: unknown): Promise<unknown> };
};

export type EnvelopeReraiseDb = {
  coworkerActionEnvelope: {
    findUnique(args: unknown): Promise<EnvelopeRecord | null>;
    findFirst(args: unknown): Promise<EnvelopeRecord | null>;
  };
  toolExecution: { findFirst(args: unknown): Promise<PendingProposal | null> };
  $transaction<T>(work: (tx: ReraiseTx) => Promise<T>): Promise<T>;
};

const REFUSED_NOT_LAPSED =
  "Only a request that expired before anyone answered it can be asked again.";
const REFUSED_NOT_PROVABLE =
  "This request cannot be asked again because the exact call it was for can no longer be proven. Ask your coworker to send a fresh request.";

function storedBinding(argsJson: unknown): CoworkerApprovalBinding | null {
  const binding = isRecord(argsJson) ? argsJson.approvalBinding : null;
  return isRecord(binding) ? binding as unknown as CoworkerApprovalBinding : null;
}

/** Expired, or still proposed past its window — and nobody approved it. */
function lapsedUnanswered(row: EnvelopeRecord, now: Date): boolean {
  const lapsed = row.status === "expired"
    || (row.status === "proposed" && row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime());
  if (!lapsed) return false;
  const args = isRecord(row.argsJson) ? row.argsJson : null;
  return !(args && ("humanApproval" in args || "policyAuthority" in args));
}

/** The re-raised request's stored arguments: the same binding, a link back. */
function reraisedArgs(argsJson: unknown, sourceId: string): Prisma.InputJsonObject {
  const args = isRecord(argsJson) ? { ...argsJson } : {};
  delete args.humanApproval;
  return { ...args, reraisedFrom: sourceId } as Prisma.InputJsonObject;
}

function reboundResult(result: unknown, envelopeId: string): Prisma.InputJsonObject {
  const record = isRecord(result) ? result : {};
  const data = isRecord(record.data) ? record.data : {};
  return { ...record, data: { ...data, envelopeId } } as Prisma.InputJsonObject;
}

/** Classify against the live tool registry, bound at the edge (see approval-classification.ts). */
const classifyAgainstRegistry: ClassifyApprovalCall = async (call) => {
  try {
    const { PLATFORM_TOOLS } = await import("@/lib/mcp-tools");
    return classifyApprovalCallAgainst(PLATFORM_TOOLS, call);
  } catch {
    return "unclassified";
  }
};

/** The new (or already-live) request, or a refusal carrying its HTTP status. */
export type ReraiseResult = ActionSuccess<EnvelopeRecord> | (ActionFailure & { httpStatus: number });

function refuse(reason: string, httpStatus: number): ReraiseResult {
  return { ...err(reason), httpStatus };
}

export async function reraiseEnvelope(
  envelopeId: string,
  callerUserId: string,
  deps: { db?: EnvelopeReraiseDb; classify?: ClassifyApprovalCall; now?: Date } = {},
): Promise<ReraiseResult> {
  const db = deps.db ?? (prisma as unknown as EnvelopeReraiseDb);
  const classify = deps.classify ?? classifyAgainstRegistry;
  const now = deps.now ?? new Date();

  const source = await db.coworkerActionEnvelope.findUnique({ where: { id: envelopeId } });
  if (!source) return refuse(`Envelope ${envelopeId} not found.`, 404);
  if (source.delegatingUserId !== callerUserId) {
    return refuse(
      `User ${callerUserId} cannot act on envelope ${source.id} — delegating user is ${source.delegatingUserId}.`,
      403,
    );
  }
  if (!lapsedUnanswered(source, now)) return refuse(REFUSED_NOT_LAPSED, 409);

  const binding = storedBinding(source.argsJson);
  if (
    !binding
    || !source.approvalBindingFingerprint
    || fingerprintCoworkerApprovalBinding(binding) !== source.approvalBindingFingerprint
    || binding.actingHumanUserId !== source.delegatingUserId
    || binding.actingAgentId !== source.coworkerAgentId
    || binding.toolName !== source.manifestActionId
  ) {
    return refuse(REFUSED_NOT_PROVABLE, 409);
  }

  // Asked again already (by the coworker, another tab, or a double press):
  // the live request for this exact call is the answer, not a second card.
  const active = await db.coworkerActionEnvelope.findFirst({
    where: {
      approvalBindingFingerprint: source.approvalBindingFingerprint,
      status: { in: ["proposed", "approved"] },
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });
  if (active) return ok(active);

  // The pending call the source was minted for, so the new card shows the
  // proposed content and an approved request can still find what to run.
  const proposal = await db.toolExecution.findFirst({
    where: {
      success: false,
      toolName: source.manifestActionId,
      userId: source.delegatingUserId,
      OR: [{ envelopeId: source.id }, { result: { path: ["data", "envelopeId"], equals: source.id } }],
      NOT: { toolName: "approval_outcome" },
    },
    orderBy: { createdAt: "desc" },
    select: {
      threadId: true, agentId: true, userId: true, toolName: true, parameters: true, result: true,
      routeContext: true, auditClass: true, capabilityId: true, summary: true, apiTokenId: true,
      taskRunId: true, skillId: true, delegatingUserId: true, chatMessageId: true, delegationChainId: true,
    },
  });
  const consequence = await classify({
    toolName: source.manifestActionId,
    params: originalToolParameters(proposal?.parameters) ?? {},
    userId: source.delegatingUserId,
  });

  try {
    const created = await db.$transaction(async (tx) => {
      // Settle a source no sweep has reached yet, so it reads as what it is.
      if (source.status === "proposed") {
        await tx.coworkerActionEnvelope.updateMany({
          where: { id: source.id, status: "proposed", resolvedAt: null, expiresAt: { lte: now } },
          data: { status: "expired", resolvedAt: now },
        });
      }
      const envelope = await tx.coworkerActionEnvelope.create({
        data: {
          coworkerAgentId: source.coworkerAgentId,
          delegatingUserId: source.delegatingUserId,
          threadId: source.threadId,
          chatMessageId: source.chatMessageId,
          manifestActionId: source.manifestActionId,
          argsJson: reraisedArgs(source.argsJson, source.id),
          rationale: source.rationale,
          status: "proposed",
          taskRunId: source.taskRunId,
          delegationChainId: source.delegationChainId,
          authorityDecisionId: source.authorityDecisionId,
          inputFingerprint: source.inputFingerprint,
          approvalBindingFingerprint: source.approvalBindingFingerprint,
          expiresAt: new Date(now.getTime() + approvalLifetimeMs(consequence)),
          resolvedAt: null,
        },
      });
      if (proposal) {
        await tx.toolExecution.create({
          data: {
            ...proposal,
            result: reboundResult(proposal.result, envelope.id),
            success: false,
            executionMode: "proposal",
            envelopeId: null,
          },
        });
      }
      return envelope;
    });
    return ok(created);
  } catch (error) {
    // The partial unique index on the active binding arbitrates a concurrent
    // ask: the loser returns the winner rather than a second card.
    const winner = await db.coworkerActionEnvelope.findFirst({
      where: {
        approvalBindingFingerprint: source.approvalBindingFingerprint,
        status: { in: ["proposed", "approved"] },
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });
    if (winner) return ok(winner);
    throw error;
  }
}
