// BI-FEDD8F45 — reads and writes of guard outcome rows.
// Design: docs/superpowers/specs/2026-10-14-guard-outcome-efficacy-design.md §4.2–§4.5.
//
// Counting happens in Postgres (jsonb_array_elements over details->'guards');
// the application loads run rows only for the clone+branch series that hold a
// refusal, which is what the classifier needs. Rows live on
// ExternalEvidenceRecord, which has no lifecycle of its own, so the classify
// job prunes the guard-outcome.* operation types at 365 days here.

import type { Prisma, PrismaClient } from "@dpf/db";

import { classifyGuardRefusals, type GuardRefusalClassification, type GuardRunForClassification } from "./classify-guard-refusals";
import { GUARD_OUTCOME_OPERATION, guardOutcomeClassificationRowId, type GuardOutcomeRun } from "./guard-outcome-run";

export const CLASSIFY_LOOKBACK_DAYS = 30;
export const RETENTION_DAYS = 365;
export const MAX_SERIES_ROWS = 5_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type GuardOutcomeStoreDb = Pick<PrismaClient, "$queryRaw" | "externalEvidenceRecord">;

function toClassificationInput(details: GuardOutcomeRun): GuardRunForClassification {
  return {
    runId: details.runId,
    startedAt: new Date(details.startedAt),
    cloneKey: details.diff.cloneKey,
    branch: details.diff.branch,
    baseSha: details.diff.baseSha,
    headSha: details.diff.headSha,
    patchId: details.diff.patchId,
    dirty: details.diff.dirty,
    override: details.override,
    guards: details.guards,
  };
}

/** The clone+branch series holding a guard refusal in [since, until), oldest refusal first. */
async function seriesWithRefusals(db: GuardOutcomeStoreDb, since: Date, until: Date): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ target: string }>>`
    SELECT r."target"
    FROM "ExternalEvidenceRecord" r
    WHERE r."operationType" = ${GUARD_OUTCOME_OPERATION.run}
      AND r."createdAt" >= ${since} AND r."createdAt" < ${until}
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(r."details"->'guards') g
        WHERE g->>'verdict' = 'refused' AND g->>'kind' = 'guard'
      )
    GROUP BY r."target"
    ORDER BY MIN(r."createdAt") ASC, r."target" ASC`;
  return rows.map((row) => row.target);
}

export const SERIES_PAGE_SIZE = 500;
export const MAX_ROWS_PER_SERIES = 2_000;
export const MAX_SERIES_PER_RUN = 200;

export type SeriesPage = { cursor: { createdAt: Date; id: string } | null; take: number };
type SeriesRow = { id: string; createdAt: Date; details: unknown };

/**
 * Load one clone+branch series by a stable (createdAt, id) cursor. A series
 * longer than maxRows is reported incomplete and returns no rows: a truncated
 * series cannot settle a classification (design §5.1).
 */
export async function loadCompleteSeries(
  fetchPage: (page: SeriesPage) => Promise<SeriesRow[]>,
  { pageSize = SERIES_PAGE_SIZE, maxRows = MAX_ROWS_PER_SERIES }: { pageSize?: number; maxRows?: number } = {},
): Promise<{ complete: boolean; rows: SeriesRow[] }> {
  const rows: SeriesRow[] = [];
  let cursor: SeriesPage["cursor"] = null;
  for (;;) {
    const page = await fetchPage({ cursor, take: pageSize });
    rows.push(...page);
    if (rows.length > maxRows) return { complete: false, rows: [] };
    if (page.length < pageSize) return { complete: true, rows };
    const last = page[page.length - 1];
    cursor = { createdAt: last.createdAt, id: last.id };
  }
}

export type ClassifyRunResult = {
  series: number;
  seriesRemaining: number;
  incompleteSeries: string[];
  runsLoaded: number;
  classified: number;
  written: number;
  pruned: number;
};

/**
 * Classify every decidable refusal in the lookback, one complete series at a
 * time, write new classification rows (createMany skips the ones already
 * written: the id is the key), and prune guard-outcome rows past retention.
 * Series beyond the per-run cap wait for the next run, oldest refusal first;
 * an over-long series is named in incompleteSeries, never settled on a
 * partial page. A read or write failure throws: the job records it.
 */
export async function classifyAndStore(input: {
  db: GuardOutcomeStoreDb;
  now: Date;
  ownerUserId: string;
}): Promise<ClassifyRunResult> {
  const { db, now } = input;
  const since = new Date(now.getTime() - CLASSIFY_LOOKBACK_DAYS * DAY_MS);
  const targets = await seriesWithRefusals(db, since, now);
  const batch = targets.slice(0, MAX_SERIES_PER_RUN);

  const incompleteSeries: string[] = [];
  let runsLoaded = 0;
  let classified = 0;
  let written = 0;
  for (const target of batch) {
    const series = await loadCompleteSeries(({ cursor, take }) =>
      db.externalEvidenceRecord.findMany({
        where: {
          operationType: GUARD_OUTCOME_OPERATION.run,
          target,
          createdAt: { gte: since, lt: now },
          ...(cursor
            ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }
            : {}),
        },
        select: { id: true, createdAt: true, details: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take,
      }),
    );
    if (!series.complete) {
      incompleteSeries.push(target);
      continue;
    }
    const runs = series.rows
      .map((row) => row.details as unknown as GuardOutcomeRun | null)
      .filter((details): details is GuardOutcomeRun => Boolean(details?.runId && Array.isArray(details?.guards)))
      .map(toClassificationInput);
    runsLoaded += runs.length;
    const classifications = classifyGuardRefusals(runs, { now });
    classified += classifications.length;
    if (classifications.length > 0) {
      const result = await db.externalEvidenceRecord.createMany({
        data: classifications.map((c) => classificationRow(c, input.ownerUserId)),
        skipDuplicates: true,
      });
      written += result.count;
    }
  }

  const pruned = await pruneGuardOutcomeTelemetry(db, now);
  return {
    series: batch.length,
    seriesRemaining: targets.length - batch.length,
    incompleteSeries,
    runsLoaded,
    classified,
    written,
    pruned,
  };
}

/**
 * Delete guard-outcome rows past retention. Runs and classifications go at
 * 365 days; a declarations row goes only when no retained run cites its
 * digest. Other operation types are never touched.
 */
async function pruneGuardOutcomeTelemetry(db: GuardOutcomeStoreDb, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const telemetry = await db.externalEvidenceRecord.deleteMany({
    where: {
      operationType: { in: [GUARD_OUTCOME_OPERATION.run, GUARD_OUTCOME_OPERATION.classification] },
      createdAt: { lt: cutoff },
    },
  });
  const referenced = await db.$queryRaw<Array<{ digest: string }>>`
    SELECT DISTINCT r."details"->>'declarationsDigest' AS "digest"
    FROM "ExternalEvidenceRecord" r
    WHERE r."operationType" = ${GUARD_OUTCOME_OPERATION.run}
      AND r."details"->>'declarationsDigest' IS NOT NULL`;
  const declarations = await db.externalEvidenceRecord.deleteMany({
    where: {
      operationType: GUARD_OUTCOME_OPERATION.declarations,
      createdAt: { lt: cutoff },
      target: { notIn: referenced.map((r) => r.digest) },
    },
  });
  return telemetry.count + declarations.count;
}

function classificationRow(
  c: GuardRefusalClassification,
  ownerUserId: string,
): Prisma.ExternalEvidenceRecordCreateManyInput {
  return {
    id: guardOutcomeClassificationRowId(c.runId, c.guardId),
    actorUserId: ownerUserId,
    routeContext: "ops/guard-outcome-classify",
    operationType: GUARD_OUTCOME_OPERATION.classification,
    target: c.guardId,
    provider: "platform",
    resultSummary: `${c.guardId}: ${c.outcome} (${c.reason})`.slice(0, 240),
    details: {
      runId: c.runId,
      guardId: c.guardId,
      cloneKey: c.cloneKey,
      branch: c.branch,
      refusedAt: c.refusedAt.toISOString(),
      outcome: c.outcome,
      reason: c.reason,
      decidingRunId: c.decidingRunId,
    },
  };
}

// ─── Aggregates ───────────────────────────────────────────────────────────────

export type GuardRunDay = {
  guardId: string;
  guardDigest: string;
  day: Date;
  runs: number;
  refusals: number;
  totalDurationMs: number;
};

/** Guard-kind results per guard, digest and day since `since`. Small: guards × digests × days. */
export async function guardRunDays(db: GuardOutcomeStoreDb, since: Date, until: Date): Promise<GuardRunDay[]> {
  const rows = await db.$queryRaw<
    Array<{ guardId: string; guardDigest: string; day: Date; runs: bigint; refusals: bigint; totalDurationMs: bigint | null }>
  >`
    SELECT g->>'guardId' AS "guardId",
           g->>'guardDigest' AS "guardDigest",
           date_trunc('day', (r."details"->>'startedAt')::timestamptz) AS "day",
           COUNT(*) AS "runs",
           COUNT(*) FILTER (WHERE g->>'verdict' = 'refused') AS "refusals",
           SUM((g->>'durationMs')::bigint) AS "totalDurationMs"
    FROM "ExternalEvidenceRecord" r, jsonb_array_elements(r."details"->'guards') g
    WHERE r."operationType" = ${GUARD_OUTCOME_OPERATION.run}
      AND r."createdAt" >= ${since}
      AND (r."details"->>'startedAt')::timestamptz >= ${since}
      AND (r."details"->>'startedAt')::timestamptz < ${until}
      AND g->>'kind' = 'guard'
      AND g->>'verdict' IN ('passed', 'refused')
    GROUP BY 1, 2, 3`;
  return rows.map((row) => ({
    guardId: row.guardId,
    guardDigest: row.guardDigest,
    day: new Date(row.day),
    runs: Number(row.runs),
    refusals: Number(row.refusals),
    totalDurationMs: Number(row.totalDurationMs ?? 0),
  }));
}

export type GuardOutcomeCount = { guardId: string; outcome: string; reason: string; refusedAt: Date; count: number };

/** Classification outcomes per guard and day of refusal since `since`. */
export async function guardOutcomeCounts(db: GuardOutcomeStoreDb, since: Date, until: Date): Promise<GuardOutcomeCount[]> {
  const rows = await db.$queryRaw<Array<{ guardId: string; outcome: string; reason: string; day: Date; count: bigint }>>`
    SELECT r."details"->>'guardId' AS "guardId",
           r."details"->>'outcome' AS "outcome",
           r."details"->>'reason' AS "reason",
           date_trunc('day', (r."details"->>'refusedAt')::timestamptz) AS "day",
           COUNT(*) AS "count"
    FROM "ExternalEvidenceRecord" r
    WHERE r."operationType" = ${GUARD_OUTCOME_OPERATION.classification}
      AND (r."details"->>'refusedAt')::timestamptz >= ${since}
      AND (r."details"->>'refusedAt')::timestamptz < ${until}
    GROUP BY 1, 2, 3, 4`;
  return rows.map((row) => ({
    guardId: row.guardId,
    outcome: row.outcome,
    reason: row.reason,
    refusedAt: new Date(row.day),
    count: Number(row.count),
  }));
}

/** Median guard duration over a period, for the guards named. */
export async function guardMedianDurations(
  db: GuardOutcomeStoreDb,
  since: Date,
  until: Date,
): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<Array<{ guardId: string; median: number | null }>>`
    SELECT g->>'guardId' AS "guardId",
           percentile_cont(0.5) WITHIN GROUP (ORDER BY (g->>'durationMs')::numeric) AS "median"
    FROM "ExternalEvidenceRecord" r, jsonb_array_elements(r."details"->'guards') g
    WHERE r."operationType" = ${GUARD_OUTCOME_OPERATION.run}
      AND r."createdAt" >= ${since}
      AND (r."details"->>'startedAt')::timestamptz >= ${since}
      AND (r."details"->>'startedAt')::timestamptz < ${until}
      AND g->>'kind' = 'guard'
    GROUP BY 1`;
  return new Map(rows.map((row) => [row.guardId, Math.round(Number(row.median ?? 0))]));
}

/** The latest submitted declarations file's guards map, or {} when none was ever submitted. */
export async function latestDeclarations(db: GuardOutcomeStoreDb): Promise<Record<string, unknown>> {
  const row = await db.externalEvidenceRecord.findFirst({
    where: { operationType: GUARD_OUTCOME_OPERATION.declarations },
    orderBy: { createdAt: "desc" },
    select: { details: true },
  });
  const guards = (row?.details as { guards?: unknown } | null)?.guards;
  return guards && typeof guards === "object" && !Array.isArray(guards) ? (guards as Record<string, unknown>) : {};
}
