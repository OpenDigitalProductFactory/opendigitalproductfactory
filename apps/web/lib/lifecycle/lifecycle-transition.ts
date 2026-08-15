// Server lib — grammar-aware LifecycleEvent writer + two-axis reporting read-model.
// Spec: docs/superpowers/specs/2026-08-15-canonical-lifecycle-grammar-design.md §4.3.
//
// This is the funnel for GRAMMAR-driven lifecycle transitions (customer-account, opportunity, …).
// It coexists with lib/lifecycle/baseline-projector.ts, which logs backbone/estate transitions to
// the same universal LifecycleEvent ledger. Both append; neither is the sole producer.

import { prisma } from "@dpf/db";
import { GOVERNED_THING_KINDS } from "../governed-thing-ref";
import {
  canAdvance,
  getState,
  summarizeLifecycle,
  type LifecyclePoint,
  type LifecycleSummary,
} from "../lifecycle-grammar";
import {
  getGrammar,
  grammarKeyForKind,
  LIFECYCLE_GRAMMAR_KINDS,
  resolveCustomerAccountPoint,
  resolveOpportunityPoint,
} from "../lifecycle-grammars";

const GOVERNED_THING_KIND_SET = new Set<string>(GOVERNED_THING_KINDS);
const GRAMMAR_KIND_SET = new Set<string>(Object.keys(LIFECYCLE_GRAMMAR_KINDS));

/** governedThingKind accepted by the write path: EA governed things OR grammar entities (spec §4.2). */
export function isRecordableKind(kind: string): boolean {
  return GOVERNED_THING_KIND_SET.has(kind) || GRAMMAR_KIND_SET.has(kind);
}

export type RecordLifecycleTransitionInput = {
  /** An EA GovernedThingKind or a LIFECYCLE_GRAMMAR_KINDS entity kind (e.g. "CustomerAccount"). */
  governedThingKind: string;
  governedThingId: string;
  /** Grammar-state transition (finer axis). Provide when the entity is grammar-driven. */
  from?: LifecyclePoint;
  to?: LifecyclePoint;
  /** Backbone-condition transition (closed LifecycleStatus). Null for native-decomposition entities. */
  fromStatus?: string | null;
  toStatus?: string | null;
  fromStage?: string | null;
  toStage?: string | null;
  reason?: string | null;
  evidenceRef?: string | null;
  actorPrincipalId?: string | null;
  toolExecutionId?: string | null;
  /**
   * Skip the canAdvance readiness gate for an AUTHORITATIVE transition — an operator override
   * or a business-authoritative event (e.g. a closed-won deal activating an account) that is
   * allowed to jump stages. Point VALIDITY is still enforced (both points must be real states),
   * so authoritative never means unvalidated.
   */
  authoritative?: boolean;
};

export type RecordLifecycleTransitionResult =
  | { ok: true; eventId: string }
  | { ok: false; reason: string };

/**
 * Validate (when a grammar stage changes, the advancement must be legal) and append one
 * LifecycleEvent carrying the state axis. Returns a typed refusal rather than throwing so
 * callers can surface an operator-fixable message (not a redacted server error).
 */
export async function recordLifecycleTransition(
  input: RecordLifecycleTransitionInput,
): Promise<RecordLifecycleTransitionResult> {
  if (!isRecordableKind(input.governedThingKind)) {
    return { ok: false, reason: `"${input.governedThingKind}" is not a recordable lifecycle kind` };
  }

  // Validate (and gate) grammar entities. Both from/to points must resolve to real
  // (stage,state) pairs in the grammar — otherwise a bogus state would persist into the open
  // fromState/toState columns and silently resolve to `unresolved` in summarizeLifecycle,
  // corrupting the two-axis report. And when the stage changes, the advance must be legal.
  const grammarKey = grammarKeyForKind(input.governedThingKind);
  if (grammarKey) {
    const grammar = getGrammar(grammarKey);
    if (grammar) {
      for (const [label, point] of [["from", input.from], ["to", input.to]] as const) {
        if (point && getState(grammar, point.stage, point.state) === null) {
          return {
            ok: false,
            reason: `${label} point (${point.stage}/${point.state}) is not a valid state in grammar "${grammarKey}"`,
          };
        }
      }
      if (!input.authoritative && input.from && input.to && input.from.stage !== input.to.stage) {
        const check = canAdvance(grammar, input.from, input.to.stage);
        if (!check.allowed) {
          return { ok: false, reason: check.reason ?? "illegal lifecycle advancement" };
        }
      }
    }
  }

  const event = await prisma.lifecycleEvent.create({
    data: {
      governedThingKind: input.governedThingKind,
      governedThingId: input.governedThingId,
      fromStage: input.fromStage ?? input.from?.stage ?? null,
      toStage: input.toStage ?? input.to?.stage ?? null,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      fromState: input.from?.state ?? null,
      toState: input.to?.state ?? null,
      reason: input.reason ?? null,
      evidenceRef: input.evidenceRef ?? null,
      actorPrincipalId: input.actorPrincipalId ?? null,
      toolExecutionId: input.toolExecutionId ?? null,
    },
    select: { id: true },
  });
  return { ok: true, eventId: event.id };
}

/**
 * Resolve the live (stage,state) points for a grammar-driven entity kind and roll them up into
 * the two-axis summary (count-by-stage AND state-within-stage). Supports the two wired grammars;
 * other grammars are populated by their downstream BIs.
 */
export async function getLifecycleSummary(grammarKey: string): Promise<LifecycleSummary | null> {
  const grammar = getGrammar(grammarKey);
  if (!grammar) return null;

  let points: LifecyclePoint[] = [];
  if (grammarKey === "customer-account") {
    const rows = await prisma.customerAccount.findMany({ select: { status: true } });
    points = rows.map((r) => resolveCustomerAccountPoint(r.status));
  } else if (grammarKey === "opportunity") {
    const rows = await prisma.opportunity.findMany({ select: { stage: true } });
    points = rows.map((r) => resolveOpportunityPoint(r.stage));
  } else {
    // Grammar declared but not yet wired to a live entity source (owned by a downstream BI).
    return summarizeLifecycle(grammar, []);
  }
  return summarizeLifecycle(grammar, points);
}
