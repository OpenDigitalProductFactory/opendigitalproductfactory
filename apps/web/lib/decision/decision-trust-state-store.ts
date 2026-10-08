// BI-7D1E43DE (EP-DECISION-OUTCOME-LOOP slice 3). The IO half of governed-
// decision TrustState: one idempotent recompute, and the report read.
//
// Why a scheduled full recompute rather than an update on every ledger write:
// slice 2 writes the ledger from two event sites (a new decision, a recorded
// outcome), but most attributed decisions predate the bridge and were never
// written to the ledger at all. A per-event update would leave those coworkers
// absent forever. One pass that (1) backfills the ledger through slice 2's own
// writer and (2) recomputes every governed-decision TrustState from the whole
// ledger is idempotent, self-healing after a failed event write, and cheap at
// this scale (thousands of rows). lastEvaluatedAt on each row says how fresh it is.
//
// REPORT ONLY. A TrustState row is created at `shadow`; an update never writes
// `currentLevel`. Nothing here can raise a level.

import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";

import { getErrorMessage } from "@/lib/shared/get-error-message";

import { readRecordedResolution } from "./decision-outcome";
import { readOptionIds } from "./decision-outcome-store";
import { syncDecisionShadowLedger, type DecisionShadowLedgerDb } from "./decision-shadow-ledger-bridge";
import {
  DECISION_ACTIVITY_TYPES,
  DECISION_LEDGER_SOURCE_KIND,
  decisionShadowLedgerId,
} from "./decision-shadow-ledger-mapping";
import {
  REPORT_ONLY_RECOMMENDATION,
  aggregateDecisionTrust,
  buildDecisionTrustReport,
  type DecisionTrustLedgerRow,
  type DecisionTrustReport,
} from "./decision-trust-state";

type Row = Record<string, unknown>;

// `unknown` args, as the other ledger writers declare them: Prisma's generic
// signatures accept no narrower structural type.
export type DecisionTrustDb = {
  decisionInteraction: { findMany(args: unknown): Promise<Row[]> };
  decisionShadowLedger: DecisionShadowLedgerDb["decisionShadowLedger"] & {
    findMany(args: unknown): Promise<Row[]>;
  };
  trustState: {
    upsert(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<Row[]>;
  };
};

/** Bounded so one pass cannot monopolise the database on a large install. */
export const DEFAULT_BACKFILL_MAX_WRITES = 1000;

const GOVERNED_DECISION_ACTIVITY_TYPES: string[] = Object.values(DECISION_ACTIVITY_TYPES);

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export type DecisionLedgerBackfillResult = {
  examined: number;
  alreadyCurrent: number;
  written: number;
  refused: Record<string, number>;
  failed: number;
  deferred: number;
};

/**
 * Bring the ledger level with the attributed decisions: write a row for every
 * attributed decision that has none, and complete a row whose decision has
 * since been resolved. Uses slice 2's writer, so the row is exactly what a live
 * decision would have produced, stamped with the decision's own time.
 */
export async function backfillDecisionShadowLedger(
  db: DecisionTrustDb,
  options: { maxWrites?: number } = {},
): Promise<DecisionLedgerBackfillResult> {
  const maxWrites = options.maxWrites ?? DEFAULT_BACKFILL_MAX_WRITES;
  const ledgerRows = await db.decisionShadowLedger.findMany({
    where: { sourceKind: DECISION_LEDGER_SOURCE_KIND },
    select: { ledgerId: true, reconciledAt: true },
  });
  const reconciledByLedgerId = new Map(
    ledgerRows.map((row) => [String(row.ledgerId), row.reconciledAt != null] as const),
  );
  const decisions = await db.decisionInteraction.findMany({
    where: { agentId: { not: null } },
    select: {
      interactionId: true,
      agentId: true,
      domainClass: true,
      riskTier: true,
      outcomeType: true,
      recommendedOptionId: true,
      options: true,
      rationale: true,
      chosenOptionId: true,
      humanOutcome: true,
      taskRunId: true,
      autonomous: true,
      subjectKind: true,
      subjectRef: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const result: DecisionLedgerBackfillResult = {
    examined: decisions.length,
    alreadyCurrent: 0,
    written: 0,
    refused: {},
    failed: 0,
    deferred: 0,
  };

  for (const decision of decisions) {
    const interactionId = String(decision.interactionId);
    const reconciled = reconciledByLedgerId.get(decisionShadowLedgerId(interactionId));
    const resolved = readRecordedResolution(decision.humanOutcome) !== null;
    if (reconciled === true || (reconciled === false && !resolved)) {
      result.alreadyCurrent += 1;
      continue;
    }
    if (result.written + result.failed >= maxWrites) {
      result.deferred += 1;
      continue;
    }
    const outcome = await syncDecisionShadowLedger(db, {
      interactionId,
      agentId: str(decision.agentId),
      domainClass: String(decision.domainClass ?? ""),
      riskTier: String(decision.riskTier ?? ""),
      outcomeType: String(decision.outcomeType ?? ""),
      recommendedOptionId: str(decision.recommendedOptionId),
      options: readOptionIds(decision.options),
      rationale: str(decision.rationale),
      chosenOptionId: str(decision.chosenOptionId),
      humanOutcome: decision.humanOutcome ?? null,
      taskRunId: str(decision.taskRunId),
      autonomous: decision.autonomous === true,
      subjectKind: str(decision.subjectKind),
      subjectRef: str(decision.subjectRef),
      observedAt: decision.createdAt instanceof Date ? decision.createdAt : null,
    });
    if (outcome.written) result.written += 1;
    else if (outcome.reason === "write-failed") result.failed += 1;
    else result.refused[outcome.reason] = (result.refused[outcome.reason] ?? 0) + 1;
  }
  return result;
}

async function readGovernedDecisionLedger(db: DecisionTrustDb): Promise<DecisionTrustLedgerRow[]> {
  const rows = await db.decisionShadowLedger.findMany({
    where: { sourceKind: DECISION_LEDGER_SOURCE_KIND },
    select: {
      ledgerId: true,
      agentId: true,
      activityType: true,
      riskClass: true,
      agreement: true,
      observedAt: true,
      proposedDecision: true,
      metadata: true,
    },
  });
  return rows.map((row) => {
    const proposed = (row.proposedDecision ?? {}) as Row;
    const metadata = (row.metadata ?? {}) as Row;
    return {
      ledgerId: String(row.ledgerId),
      agentId: String(row.agentId),
      activityType: String(row.activityType),
      riskClass: String(row.riskClass),
      agreement: typeof row.agreement === "boolean" ? row.agreement : null,
      resolvedBy: str(metadata.resolvedBy),
      recommendedOptionId: str(proposed.recommendedOptionId),
      observedAt: row.observedAt instanceof Date ? row.observedAt : new Date(String(row.observedAt)),
    };
  });
}

export type DecisionTrustRecomputeResult = { trustStates: number; failed: number; firstError: string | null };

/** Recompute every governed-decision TrustState from the whole ledger. Idempotent. */
export async function recomputeDecisionTrustStates(
  db: DecisionTrustDb,
  now: Date,
): Promise<DecisionTrustRecomputeResult> {
  const aggregates = aggregateDecisionTrust(await readGovernedDecisionLedger(db));
  const result: DecisionTrustRecomputeResult = { trustStates: 0, failed: 0, firstError: null };
  for (const agg of aggregates) {
    const key = { agentId: agg.agentId, activityType: agg.activityType, riskClass: agg.riskClass };
    const measured = {
      sampleCount: agg.sampleCount,
      agreementCount: agg.agreementCount,
      agreementRate: agg.agreementRate,
      lastLedgerId: agg.lastLedgerId,
      recommendation: REPORT_ONLY_RECOMMENDATION,
      lastEvaluatedAt: now,
    };
    try {
      await db.trustState.upsert({
        where: { agentId_activityType_riskClass: key },
        // Born at shadow. The update deliberately omits currentLevel.
        create: { ...key, currentLevel: "shadow", ...measured },
        update: measured,
      });
      result.trustStates += 1;
    } catch (error) {
      result.failed += 1;
      result.firstError ??= getErrorMessage(error);
    }
  }
  return result;
}

export async function runDecisionTrustRecompute(
  db: DecisionTrustDb,
  now: Date = new Date(),
  options: { maxWrites?: number } = {},
): Promise<{ backfill: DecisionLedgerBackfillResult; recompute: DecisionTrustRecomputeResult }> {
  const backfill = await backfillDecisionShadowLedger(db, options);
  const recompute = await recomputeDecisionTrustStates(db, now);
  return { backfill, recompute };
}

/** The report. Read-only: it computes nothing it then stores. */
export async function loadDecisionTrustReport(db: DecisionTrustDb): Promise<DecisionTrustReport> {
  const [states, ledger, attributed] = await Promise.all([
    db.trustState.findMany({
      where: { activityType: { in: GOVERNED_DECISION_ACTIVITY_TYPES } },
      select: {
        agentId: true,
        activityType: true,
        riskClass: true,
        currentLevel: true,
        sampleCount: true,
        agreementCount: true,
        agreementRate: true,
        lastEvaluatedAt: true,
      },
    }),
    readGovernedDecisionLedger(db),
    db.decisionInteraction.findMany({ where: { agentId: { not: null } }, select: { agentId: true } }),
  ]);

  const attributedDecisionsByAgent: Record<string, number> = {};
  for (const row of attributed) {
    const agentId = str(row.agentId);
    if (!agentId) continue;
    // The ledger keys on the canonical identity; count the same way.
    const canonical = resolveCanonicalAgentId(agentId);
    attributedDecisionsByAgent[canonical] = (attributedDecisionsByAgent[canonical] ?? 0) + 1;
  }

  return buildDecisionTrustReport({
    trustStates: states.map((s) => ({
      agentId: String(s.agentId),
      activityType: String(s.activityType),
      riskClass: String(s.riskClass),
      currentLevel: String(s.currentLevel),
      sampleCount: Number(s.sampleCount ?? 0),
      agreementCount: Number(s.agreementCount ?? 0),
      agreementRate: typeof s.agreementRate === "number" ? s.agreementRate : null,
      lastEvaluatedAt: s.lastEvaluatedAt instanceof Date ? s.lastEvaluatedAt : null,
    })),
    ledger: aggregateDecisionTrust(ledger),
    attributedDecisionsByAgent,
  });
}
