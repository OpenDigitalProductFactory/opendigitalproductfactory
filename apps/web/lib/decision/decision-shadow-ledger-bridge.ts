// BI-6082C235 (EP-DECISION-OUTCOME-LOOP slice 2). The IO half of the bridge
// from a governed decision into the shadow ledger.
//
// Two jobs, both deliberately small:
//
//   resolveDecisionAgentId   turn the coworker id a caller declared into one an
//                            Agent row actually carries, or null. The column is
//                            a real foreign key, so an unknown id is recorded as
//                            null rather than as a dangling reference.
//   syncDecisionShadowLedger write the decision's ledger row, or fill its
//                            outcome half once slice 1 knows the resolution.
//
// Both fail open. A decision must never be blocked by its own measurement, and
// a ledger write that did not happen is reported, never implied.
//
// Record only: the row is written at `shadow`, and nothing here reads a trust
// level back or changes one. Computing TrustState is slice 3.

import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";

import { getErrorMessage } from "@/lib/shared/get-error-message";

import {
  buildDecisionShadowLedgerEntry,
  type BridgeableDecisionRow,
  type DecisionLedgerRefusal,
} from "./decision-shadow-ledger-mapping";

export type DecisionAgentLookupDb = {
  agent: {
    findMany(args: {
      where: { agentId: { in: string[] } };
      select: { agentId: true };
    }): Promise<Array<{ agentId: string }>>;
  };
};

export type DecisionShadowLedgerDb = {
  decisionShadowLedger: {
    // `unknown`, as the other ledger writers declare it: Prisma's generic
    // upsert signature accepts no narrower structural type.
    upsert(args: unknown): Promise<unknown>;
  };
};

export type ShadowLedgerSyncOutcome =
  | { written: true; ledgerId: string; agreement: boolean | null }
  | { written: false; reason: DecisionLedgerRefusal | "write-failed"; detail: string };

/**
 * The Agent.agentId to record on a decision, or null. Prefers the canonical
 * AGT-* identity when its row exists, so one coworker is one attribution.
 */
export async function resolveDecisionAgentId(
  db: DecisionAgentLookupDb,
  declaredAgentId: string | null | undefined,
): Promise<string | null> {
  const declared = declaredAgentId?.trim() ?? "";
  if (!declared) return null;
  const canonical = resolveCanonicalAgentId(declared);
  const candidates = canonical === declared ? [declared] : [canonical, declared];
  try {
    const rows = await db.agent.findMany({
      where: { agentId: { in: candidates } },
      select: { agentId: true },
    });
    const present = new Set(rows.map((row) => row.agentId));
    return candidates.find((candidate) => present.has(candidate)) ?? null;
  } catch (error) {
    console.warn(
      `[decision-shadow-ledger] could not resolve coworker ${JSON.stringify(declared)}; recording no agent:`,
      error,
    );
    return null;
  }
}

/**
 * The same lookup for a gate whose client may not carry the Agent model (a
 * narrow test double, or a caller that predates attribution): no client, no
 * attribution, which is the honest null rather than an error.
 */
export async function resolveGateDecisionAgentId(
  db: unknown,
  declaredAgentId: string | null | undefined,
): Promise<string | null> {
  const agent = (db as Partial<DecisionAgentLookupDb> | null | undefined)?.agent;
  if (!agent || typeof agent.findMany !== "function") return null;
  return resolveDecisionAgentId({ agent }, declaredAgentId);
}

/**
 * Write (or complete) the one ledger row for this decision. Idempotent: the
 * ledger id is derived from the decision, so a repeat call updates that row.
 * An update without a known resolution touches only the proposed half, so a
 * recorded agreement is never overwritten with null.
 */
export async function syncDecisionShadowLedger(
  db: DecisionShadowLedgerDb,
  row: BridgeableDecisionRow,
): Promise<ShadowLedgerSyncOutcome> {
  const built = buildDecisionShadowLedgerEntry(row);
  if (!built.built) return { written: false, reason: built.reason, detail: built.detail };

  const { entry } = built;
  const { actualDecision, outcome, ...always } = entry;
  // Nullable Json columns take no bare null; an unknown outcome is left absent.
  const create: Record<string, unknown> = {
    ...always,
    ...(actualDecision ? { actualDecision } : {}),
    ...(outcome ? { outcome } : {}),
  };
  // The proposed half is derived from the decision's own recorded columns, so
  // rewriting it is idempotent; it is how a recommendation recovered after the
  // row was first written reaches the ledger (BI-AE416D75).
  const update: Record<string, unknown> = outcome
    ? {
        proposedDecision: entry.proposedDecision,
        actualDecision,
        outcome,
        agreement: entry.agreement,
        reconciledAt: entry.reconciledAt,
        metadata: entry.metadata,
      }
    : { proposedDecision: entry.proposedDecision };

  try {
    await db.decisionShadowLedger.upsert({ where: { ledgerId: entry.ledgerId }, create, update });
  } catch (error) {
    return { written: false, reason: "write-failed", detail: getErrorMessage(error) };
  }
  return { written: true, ledgerId: entry.ledgerId, agreement: entry.agreement };
}
