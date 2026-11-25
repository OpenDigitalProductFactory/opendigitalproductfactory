// The bounded read behind the closure scorecard (BI-97C56E20).
//
// Every query reads through an index:
//   state counts   GROUP BY the indexed status / phase column
//                  (FeatureBuild.phase, ImprovementSignal.status,
//                  ImprovementProposal.status, BacklogItem.status,
//                  BacklogItem(source, status), PlatformIssueReport(status, createdAt));
//   window events  WHERE an indexed createdAt falls in the window
//                  (PlatformIssueReport.createdAt, DecisionInteraction.createdAt).
// No query filters on updatedAt to count a flow; flows are snapshot
// differences (measures.ts). The status-to-bucket mapping is pure and exported
// so the classifications are tested without a database.

import { prisma } from "@dpf/db";

import type { ClosureCounts, ClosureSnapshot, ClosureWindowFlows } from "./measures";

/** Marker a federated copy carries in its body; only its home install may close it (BI-C5794F1D). */
export const PEER_OWNED_BODY_MARKER = "[origin:federatedWork:inst_";

const STRANDED_AFTER_DAYS = 7;
const TERMINAL_BUILD_PHASES = ["complete", "abandoned", "failed"] as const;
const SIGNAL_CLOSED_STATUSES = new Set(["resolved", "dismissed"]);
const PROPOSAL_OPEN_STATUSES = new Set(["proposed", "reviewed", "prioritized", "in_progress"]);
const PROPOSAL_IMPLEMENTED_STATUSES = new Set(["implemented", "verified"]);

export type CountRow = { key: string | null; n: bigint | number };

const num = (value: bigint | number | null | undefined): number => (value === null || value === undefined ? 0 : Number(value));
const oneDecimal = (value: number | null | undefined): number | null =>
  value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) * 10) / 10;

function tally(rows: readonly CountRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) out.set(row.key ?? "", (out.get(row.key ?? "") ?? 0) + num(row.n));
  return out;
}

const total = (counts: Map<string, number>) => [...counts.values()].reduce((a, b) => a + b, 0);
const pick = (counts: Map<string, number>, keys: Iterable<string>) => [...keys].reduce((a, k) => a + (counts.get(k) ?? 0), 0);
const pickWhere = (counts: Map<string, number>, test: (key: string) => boolean) =>
  [...counts.entries()].reduce((a, [k, v]) => a + (test(k) ? v : 0), 0);

export function buildsFromRows(byPhase: readonly CountRow[], stranded: number): ClosureSnapshot["builds"] {
  const c = tally(byPhase);
  return { total: total(c), complete: c.get("complete") ?? 0, abandoned: c.get("abandoned") ?? 0, failed: c.get("failed") ?? 0, stranded };
}

/** A signal is closed only in a terminal state; any other status (open or unknown) counts as open. */
export function signalsFromRows(byStatus: readonly CountRow[]): ClosureSnapshot["signals"] {
  const c = tally(byStatus);
  const closed = pick(c, SIGNAL_CLOSED_STATUSES);
  return { total: total(c), closed, open: total(c) - closed };
}

/** Implemented and rejected are counted apart; rejection is never a delivered improvement. */
export function proposalsFromRows(byStatus: readonly CountRow[]): ClosureSnapshot["proposals"] {
  const c = tally(byStatus);
  return {
    total: total(c),
    open: pick(c, PROPOSAL_OPEN_STATUSES),
    implemented: pick(c, PROPOSAL_IMPLEMENTED_STATUSES),
    rejected: c.get("rejected") ?? 0,
  };
}

export function backlogFromRows(byStatus: readonly CountRow[]): ClosureSnapshot["backlog"] {
  const c = tally(byStatus);
  return { total: total(c), done: c.get("done") ?? 0, retired: c.get("retired") ?? 0 };
}

export function selfFiledFromRows(byStatus: readonly CountRow[]): ClosureSnapshot["selfFiled"] {
  const c = tally(byStatus);
  return { total: total(c), done: pickWhere(c, (k) => k === "done") };
}

/** One row per distinct ask: whether any report for it was for the owner, and whether it was routed. */
export type AskRow = { for_owner: boolean | null; routed: boolean | null };

/** Each ask lands on exactly one side: owner wins, otherwise routed; neither counts on neither side. */
export function asksFromRows(rows: readonly AskRow[]): ClosureWindowFlows["asks"] {
  let forOwner = 0;
  let routedToAgent = 0;
  for (const row of rows) {
    if (row.for_owner) forOwner += 1;
    else if (row.routed) routedToAgent += 1;
  }
  return { forOwner, routedToAgent };
}

type Raw = <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
export type ClosureDb = { $queryRaw: Raw };

export async function loadClosureCounts(
  window: { since: Date; until: Date },
  db: ClosureDb = prisma as unknown as ClosureDb,
): Promise<ClosureCounts> {
  const { since, until } = window;
  const strandedBefore = new Date(until.getTime() - STRANDED_AFTER_DAYS * 86_400_000);
  const terminal = [...TERMINAL_BUILD_PHASES];

  const [buildPhases, stranded, signals, proposals, backlog, selfFiled, acceptance, held, asks, decisions] = await Promise.all([
    db.$queryRaw<CountRow[]>`SELECT phase AS key, count(*) AS n FROM "FeatureBuild" GROUP BY phase`,
    db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM "FeatureBuild"
      WHERE phase <> ALL(${terminal}::text[]) AND "updatedAt" < ${strandedBefore}`,
    db.$queryRaw<CountRow[]>`SELECT status AS key, count(*) AS n FROM "ImprovementSignal" GROUP BY status`,
    db.$queryRaw<CountRow[]>`SELECT status AS key, count(*) AS n FROM "ImprovementProposal" GROUP BY status`,
    db.$queryRaw<CountRow[]>`SELECT status AS key, count(*) AS n FROM "BacklogItem" GROUP BY status`,
    db.$queryRaw<CountRow[]>`
      SELECT status AS key, count(*) AS n FROM "BacklogItem"
      WHERE source = 'automated-detection' GROUP BY status`,
    // position() matches the marker literally; LIKE would read its "_" as a wildcard.
    db.$queryRaw<Array<{ local: bigint; peer: bigint; local_median_days: number | null }>>`
      SELECT
        count(*) FILTER (WHERE position(${PEER_OWNED_BODY_MARKER} IN coalesce(body, '')) = 0) AS local,
        count(*) FILTER (WHERE position(${PEER_OWNED_BODY_MARKER} IN coalesce(body, '')) > 0) AS peer,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (${until}::timestamp - "updatedAt")) / 86400)
          FILTER (WHERE position(${PEER_OWNED_BODY_MARKER} IN coalesce(body, '')) = 0) AS local_median_days
      FROM "BacklogItem" WHERE status = 'awaiting-acceptance'`,
    db.$queryRaw<Array<{ n: bigint; oldest_days: number | null }>>`
      SELECT count(*) AS n,
             extract(epoch FROM (${until}::timestamp - min("createdAt"))) / 86400 AS oldest_days
      FROM "PlatformIssueReport" WHERE status = 'awaiting_escalation_ack'`,
    db.$queryRaw<AskRow[]>`
      SELECT bool_or("selfFixClass" = 'needs-human') AS for_owner, bool_or(type = 'routed-repair') AS routed
      FROM "PlatformIssueReport"
      WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
        AND ("selfFixClass" = 'needs-human' OR type = 'routed-repair')
      GROUP BY coalesce("dedupeKey", id)`,
    db.$queryRaw<Array<{ total: bigint; recommended: bigint }>>`
      SELECT count(*) AS total, count("recommendedOptionId") AS recommended
      FROM "DecisionInteraction"
      WHERE "createdAt" >= ${since} AND "createdAt" < ${until}`,
  ]);

  const a = acceptance[0];
  const h = held[0];
  const d = decisions[0];
  return {
    snapshot: {
      builds: buildsFromRows(buildPhases, num(stranded[0]?.n)),
      signals: signalsFromRows(signals),
      proposals: proposalsFromRows(proposals),
      backlog: backlogFromRows(backlog),
      selfFiled: selfFiledFromRows(selfFiled),
      acceptance: { local: num(a?.local), peerOwned: num(a?.peer), localMedianDaysSinceChange: oneDecimal(a?.local_median_days) },
      escalations: { held: num(h?.n), oldestHeldDays: oneDecimal(h?.oldest_days) },
    },
    window: {
      asks: asksFromRows(asks),
      decisions: { total: num(d?.total), recommended: num(d?.recommended) },
    },
  };
}
