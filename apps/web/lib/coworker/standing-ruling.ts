// An owner's written approval, made standing (BI-E5631708, child of BI-88D51B8F).
//
// Owner direction 2026-11-04: approvals that are always granted, for requests
// the owner cannot interpret, add delay with no decision value; a written
// approval should become a ruling that lets coworkers just work. The WWWD
// decision path already does this for business decisions
// (lib/wiki/org-decision-capture.ts, `makeStanding`). This is the equivalent
// for a coworker tool-authority approval envelope.
//
// WHERE IT LIVES (WWMD DI-023E0412A43C). On the approved envelope itself, as
// `argsJson.standingRuling`. The envelope already names the coworker, the tool
// and the person whose authority was lent, and its AuthorizationDecisionLog row
// records whether the call was damaging. No new table, no migration.
//
// WHAT IT STEERS. Exactly one action class: this coworker, this tool, on this
// owner's authority. The authority resolver looks it up per call and hands the
// escalation gate `standing-ruling` steering. The gate orders damage before
// steering, so a damaging call of the same tool still reaches a person, and an
// operator HITL policy of "always" resolves no steering at all.
//
// WHO MAY MAKE ONE. Only the delegating owner, only while approving, and only
// when the envelope's own decision was non-damaging and asked a person solely
// because nothing recorded could steer it (`unsteered-side-effect`). An admin
// deciding on the owner's behalf cannot make one: a standing ruling lends the
// owner's authority to future calls, which is the owner's to give.
import { prisma, type Prisma } from "@dpf/db";

import {
  readStandingRuling,
  rulingCovers,
  type StandingRuling,
} from "./standing-ruling-policy";

export * from "./standing-ruling-policy";

import {
  fingerprintCoworkerApprovalBinding,
  type CoworkerApprovalBinding,
} from "@/lib/govern/authority/coworker-authority-decision";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type RulingRow = {
  id: string;
  coworkerAgentId: string;
  delegatingUserId: string;
  manifestActionId: string;
  argsJson: unknown;
  status?: string;
  approvalBindingFingerprint?: string | null;
};

/**
 * Statuses an owner-approved request can be in. A request reaches "expired" or
 * "cancelled" after approval when its call lapses or recovery supersedes it;
 * the ruling is about the action class, not that one call, so it still stands.
 * The owner's own humanApproval marker (required below) is what proves a person
 * decided: a request that expired or was cancelled while still proposed has
 * none, and only approveEnvelope writes one onto a bound authority request.
 * "Ask me again" (revokeStandingRuling) is how a ruling ends.
 */
const RULED_APPROVAL_STATUSES = ["approved", "executed", "failed", "expired", "cancelled"] as const;

export type StandingRulingDb = {
  coworkerActionEnvelope: {
    findMany(args: unknown): Promise<RulingRow[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

const RULING_SELECT = {
  id: true,
  coworkerAgentId: true,
  delegatingUserId: true,
  manifestActionId: true,
  argsJson: true,
  status: true,
  approvalBindingFingerprint: true,
} as const;

/**
 * PROVENANCE (independent review of PR #6905). A ruling is trusted only where
 * approveEnvelope can have written it: a server-minted authority envelope
 * (its stored approvalBinding re-fingerprints to the row's own fingerprint and
 * names this exact coworker, tool and owner), decided by a person (any status
 * after approval, never proposed), and approved by that owner in person
 * (a humanApproval marker naming them, with no on-behalf decision). A screen
 * envelope stores caller arguments verbatim and has no binding fingerprint, so
 * a ruling-shaped value a coworker writes there is never read as a ruling, and
 * a recovery copy of an approval is "proposed" until a person decides it.
 */
function rulingHasApprovalProvenance(row: RulingRow, ruling: StandingRuling): boolean {
  const args = record(row.argsJson);
  const binding = record(args?.approvalBinding);
  const approval = record(args?.humanApproval);
  if (!args || !binding || !approval || !row.approvalBindingFingerprint) return false;
  if (!RULED_APPROVAL_STATUSES.includes(row.status as (typeof RULED_APPROVAL_STATUSES)[number])) return false;
  if (approval.userId !== ruling.actionClass.delegatingUserId || "onBehalfOf" in approval || "by" in approval) return false;
  if (
    binding.actingAgentId !== ruling.actionClass.coworkerAgentId
    || binding.actingHumanUserId !== ruling.actionClass.delegatingUserId
    || binding.toolName !== ruling.actionClass.toolName
  ) return false;
  try {
    return fingerprintCoworkerApprovalBinding(binding as unknown as CoworkerApprovalBinding) === row.approvalBindingFingerprint;
  } catch {
    return false;
  }
}

function activeRulingWhere(call: { coworkerAgentIds: readonly string[]; toolName: string; delegatingUserId: string }) {
  return {
    coworkerAgentId: { in: [...new Set(call.coworkerAgentIds)] },
    delegatingUserId: call.delegatingUserId,
    manifestActionId: call.toolName,
    argsJson: { path: ["standingRuling", "state"], equals: "active" },
  };
}

/** Only rows that could carry a genuine ruling, so forged rows cannot crowd them out. */
function ruledApprovalWhere(call: { coworkerAgentIds: readonly string[]; toolName: string; delegatingUserId: string }) {
  return {
    ...activeRulingWhere(call),
    status: { in: [...RULED_APPROVAL_STATUSES] },
    approvalBindingFingerprint: { not: null },
  };
}

/**
 * The envelope whose standing ruling covers this call, or null. Server-side
 * only: every term comes from the resolved coworker, tool and human, never
 * from the caller's arguments. The stored ruling is re-checked in full, so a
 * row the JSON filter matched loosely still has to name this exact class.
 */
export async function findStandingRuling(
  call: { coworkerAgentIds: readonly string[]; toolName: string; delegatingUserId: string },
  db: StandingRulingDb = prisma as unknown as StandingRulingDb,
): Promise<{ envelopeId: string; ruling: StandingRuling } | null> {
  const ids = call.coworkerAgentIds.filter((id) => Boolean(id?.trim()));
  if (ids.length === 0 || !call.toolName || !call.delegatingUserId) return null;
  // A narrow store without the query has no rulings to offer: ask, as before.
  if (typeof db.coworkerActionEnvelope?.findMany !== "function") return null;
  const rows = await db.coworkerActionEnvelope.findMany({
    where: ruledApprovalWhere({ ...call, coworkerAgentIds: ids }),
    orderBy: { createdAt: "desc" },
    take: 10,
    select: RULING_SELECT,
  });
  for (const row of rows) {
    const ruling = readStandingRuling(row.argsJson);
    if (
      rulingCovers(ruling, { ...call, coworkerAgentIds: ids })
      && row.coworkerAgentId === ruling!.actionClass.coworkerAgentId
      && row.manifestActionId === ruling!.actionClass.toolName
      && row.delegatingUserId === ruling!.actionClass.delegatingUserId
      && rulingHasApprovalProvenance(row, ruling!)
    ) {
      return { envelopeId: row.id, ruling: ruling! };
    }
  }
  return null;
}

export type RevokeStandingRulingResult =
  | { outcome: "revoked"; revoked: number }
  | { outcome: "refused"; reason: string; httpStatus: number };

/**
 * Withdraw the standing ruling an envelope carries, and any other active ruling
 * for the same class, so "ask me again" means exactly that. Only the owner the
 * ruling lends authority from may revoke it.
 */
export async function revokeStandingRuling(
  envelopeId: string,
  callerUserId: string,
  now: Date = new Date(),
  db: StandingRulingDb = prisma as unknown as StandingRulingDb,
): Promise<RevokeStandingRulingResult> {
  const [source] = await db.coworkerActionEnvelope.findMany({
    where: { id: envelopeId },
    take: 1,
    select: RULING_SELECT,
  });
  const ruling = source ? readStandingRuling(source.argsJson) : null;
  if (!source || !ruling) {
    return { outcome: "refused", reason: "This request carries no standing ruling.", httpStatus: 404 };
  }
  if (ruling.actionClass.delegatingUserId !== callerUserId) {
    return { outcome: "refused", reason: "Only the person whose approval this is can withdraw it.", httpStatus: 403 };
  }
  const rows = await db.coworkerActionEnvelope.findMany({
    where: activeRulingWhere({ ...ruling.actionClass, coworkerAgentIds: [ruling.actionClass.coworkerAgentId] }),
    select: RULING_SELECT,
  });
  let revoked = 0;
  for (const row of rows) {
    const args = record(row.argsJson);
    const current = readStandingRuling(row.argsJson);
    if (!args || !current || current.state !== "active") continue;
    const next: StandingRuling = { ...current, state: "revoked", revokedBy: callerUserId, revokedAt: now.toISOString() };
    // Compare-and-set on the state, so a concurrent revoke is counted once.
    const result = await db.coworkerActionEnvelope.updateMany({
      where: { id: row.id, argsJson: { path: ["standingRuling", "state"], equals: "active" } },
      data: { argsJson: { ...args, standingRuling: next } as Prisma.InputJsonObject },
    });
    revoked += result.count;
  }
  return { outcome: "revoked", revoked };
}
