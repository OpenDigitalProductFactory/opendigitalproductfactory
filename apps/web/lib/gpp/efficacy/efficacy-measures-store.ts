// BI-FEDD8F45 — load the counts the efficacy measures are computed from.
// Design: docs/superpowers/specs/2026-10-14-guard-outcome-efficacy-design.md §4.6.
//
// Every number comes from an execution or decision record, never from
// configuration (GPP §11). Counting happens in Postgres.

import type { PrismaClient } from "@dpf/db";

import { computeEfficacyMeasures, type EfficacyReport, type EnvelopeCounts, type GuardMeasureRow } from "./efficacy-measures";
import { guardMedianDurations, guardOutcomeCounts, guardRunDays } from "./guard-outcome-store";

export const DEFAULT_PERIOD_DAYS = 14;

/** Verdicts that are not a would-refusal: admitted, out of scope, or not the caller's to fix. */
const NON_REFUSING_SHADOW_VERDICTS = ["valid", "ungoverned", "unsigned", "unmediated"] as const;
const HELD_OUTCOMES = ["defer", "slip"];
const NOT_ADMITTED_OUTCOMES = ["escalate", "defer", "slip", "decline", "veto"];

export type EfficacyMeasuresDb = Pick<
  PrismaClient,
  "$queryRaw" | "externalEvidenceRecord" | "gppPermitObservation" | "toolExecution" | "decisionInteraction" | "authorizationDecisionLog" | "coworkerActionEnvelope"
>;

const ENVELOPE_STATUSES = ["proposed", "approved", "executed", "declined", "failed", "expired", "cancelled"] as const;

/** Envelope counts by stored status; an unknown status counts as waiting, never dropped. */
export function envelopeCounts(rows: ReadonlyArray<{ status: string; _count: { _all: number } }>): EnvelopeCounts {
  const counts = Object.fromEntries(ENVELOPE_STATUSES.map((s) => [s, 0])) as EnvelopeCounts;
  for (const row of rows) {
    const key = (ENVELOPE_STATUSES as readonly string[]).includes(row.status) ? (row.status as keyof EnvelopeCounts) : "proposed";
    counts[key] += row._count._all;
  }
  return counts;
}

export async function loadEfficacyReport(
  db: EfficacyMeasuresDb,
  { now = new Date(), periodDays = DEFAULT_PERIOD_DAYS }: { now?: Date; periodDays?: number } = {},
): Promise<EfficacyReport> {
  const from = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
  const createdAt = { gte: from, lt: now };

  const [
    perAgent,
    consequentialEffects,
    decisionTotal,
    humanResolved,
    agentResolved,
    escalated,
    held,
    admitted,
    admittedHumanChoice,
    admittedAgentChoice,
    envelopeStatuses,
    authorizationTotal,
    denied,
    deniedByAction,
    enforcedPermitRefusals,
    shadowWithExecution,
    shadowDivergent,
    runDays,
    outcomes,
    medians,
  ] = await Promise.all([
    db.$queryRaw<Array<{ agent: string; total: bigint; enforcedValid: bigint }>>`
      SELECT COALESCE(t."agentId", 'direct') AS "agent",
             COUNT(*) AS "total",
             COUNT(*) FILTER (WHERE o."enforcement" = 'enforced' AND o."verdict" = 'valid') AS "enforcedValid"
      FROM "GppPermitObservation" o
      LEFT JOIN "ToolExecution" t ON t."id" = o."toolExecutionId"
      WHERE o."createdAt" >= ${from} AND o."createdAt" < ${now}
      GROUP BY 1`,
    db.toolExecution.count({ where: { createdAt, success: true, gppPermitObservations: { some: { path: "monitor" } } } }),
    db.decisionInteraction.count({ where: { createdAt } }),
    db.decisionInteraction.count({ where: { createdAt, humanOutcome: { path: ["resolvedBy"], equals: "human" } } }),
    db.decisionInteraction.count({ where: { createdAt, humanOutcome: { path: ["resolvedBy"], equals: "agent" } } }),
    db.decisionInteraction.count({ where: { createdAt, outcomeType: "escalate" } }),
    db.decisionInteraction.count({ where: { createdAt, outcomeType: { in: HELD_OUTCOMES } } }),
    db.decisionInteraction.count({ where: { createdAt, outcomeType: { notIn: NOT_ADMITTED_OUTCOMES } } }),
    db.decisionInteraction.count({
      where: { createdAt, outcomeType: { notIn: NOT_ADMITTED_OUTCOMES }, humanOutcome: { path: ["resolvedBy"], equals: "human" } },
    }),
    db.decisionInteraction.count({
      where: { createdAt, outcomeType: { notIn: NOT_ADMITTED_OUTCOMES }, humanOutcome: { path: ["resolvedBy"], equals: "agent" } },
    }),
    db.coworkerActionEnvelope.groupBy({ by: ["status"], where: { createdAt }, _count: { _all: true } }),
    db.authorizationDecisionLog.count({ where: { createdAt } }),
    db.authorizationDecisionLog.count({ where: { createdAt, decision: "deny" } }),
    db.authorizationDecisionLog.groupBy({ by: ["actionKey"], where: { createdAt, decision: "deny" }, _count: { _all: true } }),
    db.gppPermitObservation.count({ where: { createdAt, enforcement: "enforced", verdict: { notIn: ["valid", "ungoverned"] } } }),
    db.gppPermitObservation.count({ where: { createdAt, enforcement: "shadow", toolExecutionId: { not: null } } }),
    db.gppPermitObservation.count({
      where: {
        createdAt,
        enforcement: "shadow",
        verdict: { notIn: [...NON_REFUSING_SHADOW_VERDICTS] },
        toolExecution: { is: { success: true } },
      },
    }),
    guardRunDays(db, from, now),
    guardOutcomeCounts(db, from, now),
    guardMedianDurations(db, from, now),
  ]);

  const guards = new Map<string, GuardMeasureRow>();
  const row = (guardId: string): GuardMeasureRow => {
    let existing = guards.get(guardId);
    if (!existing) {
      existing = {
        guardId,
        runs: 0,
        refusals: 0,
        caught: 0,
        falseRefusals: 0,
        overridden: 0,
        unresolved: 0,
        unresolvedByReason: {},
        totalDurationMs: 0,
        medianDurationMs: medians.get(guardId) ?? 0,
      };
      guards.set(guardId, existing);
    }
    return existing;
  };
  for (const day of runDays) {
    if (day.day >= now) continue;
    const r = row(day.guardId);
    r.runs += day.runs;
    r.refusals += day.refusals;
    r.totalDurationMs += day.totalDurationMs;
  }
  for (const outcome of outcomes) {
    const r = row(outcome.guardId);
    if (outcome.outcome === "caught") r.caught += outcome.count;
    else if (outcome.outcome === "false-refusal") r.falseRefusals += outcome.count;
    else if (outcome.outcome === "overridden") r.overridden += outcome.count;
    else if (outcome.outcome === "unresolved") {
      r.unresolved += outcome.count;
      r.unresolvedByReason[outcome.reason] = (r.unresolvedByReason[outcome.reason] ?? 0) + outcome.count;
    }
  }

  const permitTotals = perAgent.reduce(
    (sum, r) => ({ total: sum.total + Number(r.total), enforcedValid: sum.enforcedValid + Number(r.enforcedValid) }),
    { total: 0, enforcedValid: 0 },
  );

  return computeEfficacyMeasures({
    period: { from, to: now },
    permits: {
      ...permitTotals,
      perAgent: perAgent.map((r) => ({ agent: r.agent, total: Number(r.total), enforcedValid: Number(r.enforcedValid) })),
    },
    consequentialEffects,
    decisions: { total: decisionTotal, humanResolved, agentResolved, escalated, held, admitted, admittedHumanChoice, admittedAgentChoice },
    envelopes: envelopeCounts(envelopeStatuses),
    authorization: {
      total: authorizationTotal,
      denied,
      deniedByAction: Object.fromEntries(deniedByAction.map((g) => [g.actionKey, g._count._all])),
      enforcedPermitRefusals,
    },
    shadow: { withExecution: shadowWithExecution, divergentSucceeded: shadowDivergent },
    guards: [...guards.values()],
  });
}
