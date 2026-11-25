// The one bounded read behind the closure scorecard (BI-97C56E20).
//
// Every number is an aggregate over an indexed timestamp or status, so the
// read is a fixed set of COUNTs regardless of table size. Flows (filed,
// closed, started) are counted inside [since, until); stocks (open, held,
// stranded, awaiting) are read as they stand at `until`, which is "now" for a
// scheduled run.

import { prisma } from "@dpf/db";

import type { ClosureCounts } from "./measures";

/** Marker a federated copy carries in its body; only its home install may close it (BI-C5794F1D). */
export const PEER_OWNED_BODY_MARKER = "[origin:federatedWork:inst_";

const STRANDED_AFTER_DAYS = 7;

type Row = Record<string, bigint | number | null>;
type QueryRaw = (query: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

const num = (value: bigint | number | null | undefined): number => (value === null || value === undefined ? 0 : Number(value));
const numOrNull = (value: bigint | number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10;

export async function loadClosureCounts(
  window: { since: Date; until: Date },
  db: { $queryRaw: QueryRaw } = prisma as unknown as { $queryRaw: QueryRaw },
): Promise<ClosureCounts> {
  const { since, until } = window;
  const strandedBefore = new Date(until.getTime() - STRANDED_AFTER_DAYS * 86_400_000);
  const peerLike = `%${PEER_OWNED_BODY_MARKER}%`;

  const [builds, signals, proposals, escalations, decisions, acceptance, backlog] = await Promise.all([
    db.$queryRaw`
      SELECT
        count(*) FILTER (WHERE "createdAt" >= ${since} AND "createdAt" < ${until}) AS started,
        count(*) FILTER (WHERE phase = 'complete' AND "updatedAt" >= ${since} AND "updatedAt" < ${until}) AS completed,
        count(*) FILTER (WHERE phase = 'abandoned' AND coalesce("abandonedAt", "updatedAt") >= ${since} AND coalesce("abandonedAt", "updatedAt") < ${until}) AS abandoned,
        count(*) FILTER (WHERE phase = 'failed' AND "updatedAt" >= ${since} AND "updatedAt" < ${until}) AS failed,
        count(*) FILTER (WHERE phase NOT IN ('complete', 'abandoned', 'failed') AND "updatedAt" < ${strandedBefore}) AS stranded
      FROM "FeatureBuild"`,
    db.$queryRaw`
      SELECT
        count(*) FILTER (WHERE "createdAt" >= ${since} AND "createdAt" < ${until}) AS filed,
        count(*) FILTER (WHERE status <> 'open' AND "updatedAt" >= ${since} AND "updatedAt" < ${until}) AS closed,
        count(*) FILTER (WHERE status = 'open') AS open
      FROM "ImprovementSignal"`,
    db.$queryRaw`
      SELECT
        count(*) FILTER (WHERE "createdAt" >= ${since} AND "createdAt" < ${until}) AS filed,
        count(*) FILTER (WHERE status NOT IN ('proposed', 'prioritized', 'reviewed') AND "updatedAt" >= ${since} AND "updatedAt" < ${until}) AS closed,
        count(*) FILTER (WHERE status IN ('proposed', 'prioritized', 'reviewed')) AS open
      FROM "ImprovementProposal"`,
    db.$queryRaw`
      SELECT
        count(*) FILTER (WHERE type = 'routed-repair' AND "createdAt" >= ${since} AND "createdAt" < ${until}) AS routed,
        count(*) FILTER (WHERE "selfFixClass" = 'needs-human' AND "createdAt" >= ${since} AND "createdAt" < ${until}) AS owner,
        count(*) FILTER (WHERE status = 'awaiting_escalation_ack') AS held,
        extract(epoch FROM (${until}::timestamp - min("createdAt") FILTER (WHERE status = 'awaiting_escalation_ack'))) / 86400 AS oldest_days
      FROM "PlatformIssueReport"`,
    db.$queryRaw`
      SELECT count(*) AS total, count("recommendedOptionId") AS recommended
      FROM "DecisionInteraction"
      WHERE "createdAt" >= ${since} AND "createdAt" < ${until}`,
    db.$queryRaw`
      SELECT
        count(*) FILTER (WHERE body IS NULL OR body NOT LIKE ${peerLike}) AS local,
        count(*) FILTER (WHERE body LIKE ${peerLike}) AS peer,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (${until}::timestamp - "updatedAt")) / 86400)
          FILTER (WHERE body IS NULL OR body NOT LIKE ${peerLike}) AS local_median_days
      FROM "BacklogItem"
      WHERE status = 'awaiting-acceptance'`,
    db.$queryRaw`
      SELECT
        count(*) FILTER (WHERE "createdAt" >= ${since} AND "createdAt" < ${until}) AS filed,
        count(*) FILTER (WHERE status = 'done' AND "completedAt" >= ${since} AND "completedAt" < ${until}) AS done,
        count(*) FILTER (WHERE status = 'retired' AND "updatedAt" >= ${since} AND "updatedAt" < ${until}) AS retired,
        count(*) FILTER (WHERE source = 'automated-detection' AND "createdAt" >= ${since} AND "createdAt" < ${until}) AS self_filed,
        count(*) FILTER (WHERE source = 'automated-detection' AND status = 'done' AND "completedAt" >= ${since} AND "completedAt" < ${until}) AS self_done
      FROM "BacklogItem"`,
  ]);

  const b = builds[0] ?? {};
  const s = signals[0] ?? {};
  const p = proposals[0] ?? {};
  const e = escalations[0] ?? {};
  const d = decisions[0] ?? {};
  const a = acceptance[0] ?? {};
  const k = backlog[0] ?? {};

  return {
    builds: { started: num(b.started), completed: num(b.completed), abandoned: num(b.abandoned), failed: num(b.failed), stranded: num(b.stranded) },
    signals: { filed: num(s.filed), closed: num(s.closed), open: num(s.open) },
    proposals: { filed: num(p.filed), closedOrVerified: num(p.closed), open: num(p.open) },
    escalations: { routedToAgent: num(e.routed), reachedOwner: num(e.owner), held: num(e.held), oldestHeldDays: numOrNull(e.oldest_days) },
    decisions: { total: num(d.total), recommended: num(d.recommended) },
    acceptance: { local: num(a.local), peerOwned: num(a.peer), localMedianAgeDays: numOrNull(a.local_median_days) },
    backlog: { filed: num(k.filed), done: num(k.done), retired: num(k.retired) },
    selfFiled: { filed: num(k.self_filed), done: num(k.self_done) },
  };
}
