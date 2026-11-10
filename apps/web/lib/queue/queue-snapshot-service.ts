// apps/web/lib/queue/queue-snapshot-service.ts
//
// EP-3516E23D Phase 3 — the single read model over QueueMetricSnapshot that ALL
// visibility surfaces share (the coworker MCP pack, the portal-context
// awareness resolver, and the human report-kit tiles). One reader ⇒ the human
// tile and the coworker tool can never quote different numbers for the same
// queue. Spec §4.5.

import { queueMetricPeriod } from "./flow-metrics";

/** One queue's most-recent rolled-up flow metrics (a QueueMetricSnapshot row). */
export interface QueueSnapshotView {
  queueKey: string;
  period: string;
  depth: number;
  wip: number;
  arrivals: number;
  throughput: number;
  waitP50Ms: number | null;
  waitP95Ms: number | null;
  processP50Ms: number | null;
  processP95Ms: number | null;
  cycleP50Ms: number | null;
  cycleP95Ms: number | null;
  firstPassYield: number | null;
  slaAttainment: number | null;
  abandonmentRate: number | null;
  /**
   * When this queue last ATTEMPTED an item, as opposed to completing one.
   * Null when the producer records no attempts at all.
   *
   * throughput === 0 cannot separate the two failure shapes an operator must
   * act on differently: work being tried and failing, versus work not being
   * tried. On the install this was found (2026-09-15) a federation outbox held
   * 2,011 items with its last attempt 12 days earlier, and read as "no
   * completions with backlog" — the same phrase a healthy-but-blocked queue
   * produces. The operator was away from the peer and reasonably read the
   * backlog as expected; the silence underneath it was not.
   */
  lastAttemptAt?: string | null;
  computedAt: string;
}

/**
 * Health classification for a queue, derived purely from its snapshot. Pure so
 * tiles (intent color), the resolver (attention severity), and the coworker
 * tool all agree on when a queue is "at risk". Thresholds are deliberately
 * conservative defaults; a queue with no throughput yet is "idle", not "at risk".
 */
export type QueueHealth = "healthy" | "watch" | "at-risk" | "idle";

export interface QueueHealthAssessment {
  health: QueueHealth;
  reasons: string[];
}

const DEEP_BACKLOG_DEPTH = 10; // items waiting
const LOW_FIRST_PASS_YIELD = 0.7; // 70% — below this, rework is eating capacity
const LOW_SLA_ATTAINMENT = 0.8; // 80% on-time
const HIGH_ABANDONMENT = 0.2; // 20% balk/renege
const WAIT_P95_SLO_MS = 60 * 60 * 1000;
/**
 * How long a queue may hold work without attempting any before it is called
 * stalled. One hour: long enough that an ordinary backoff or a quiet period is
 * not mistaken for a stopped consumer, short enough that a stall is caught the
 * same day rather than the same fortnight.
 */
const QUEUE_STALL_MS = 60 * 60 * 1000;

/** Assess a snapshot's health. Pure — no I/O. */
export function assessQueueHealth(s: QueueSnapshotView): QueueHealthAssessment {
  const reasons: string[] = [];
  if (s.depth >= DEEP_BACKLOG_DEPTH) reasons.push(`${s.depth} items waiting`);
  if (s.firstPassYield != null && s.firstPassYield < LOW_FIRST_PASS_YIELD) {
    reasons.push(`first-pass yield ${Math.round(s.firstPassYield * 100)}%`);
  }
  if (s.slaAttainment != null && s.slaAttainment < LOW_SLA_ATTAINMENT) {
    reasons.push(`SLA attainment ${Math.round(s.slaAttainment * 100)}%`);
  }
  if (s.abandonmentRate != null && s.abandonmentRate > HIGH_ABANDONMENT) {
    reasons.push(`abandonment ${Math.round(s.abandonmentRate * 100)}%`);
  }
  if (s.waitP95Ms != null && s.waitP95Ms > WAIT_P95_SLO_MS) {
    reasons.push(`p95 wait ${Math.round(s.waitP95Ms / 60_000)}m exceeds 60m progress SLO`);
  }
  const noCompletionsWithBacklog = s.depth > 0 && s.throughput === 0;
  if (noCompletionsWithBacklog) reasons.push("no completions with backlog");

  // Not merely failing — not running. A queue with work in it that has not been
  // TRIED inside the stall window has lost its consumer, and that is a different
  // fault from a consumer that is trying and being refused. Reported separately
  // so "my peer is unreachable this week" stays legible next to "nothing has
  // driven this queue since the third".
  const stalled = s.depth > 0
    && s.lastAttemptAt != null
    && Date.now() - Date.parse(s.lastAttemptAt) > QUEUE_STALL_MS;
  if (stalled) {
    const hours = Math.floor((Date.now() - Date.parse(s.lastAttemptAt!)) / 3_600_000);
    reasons.push(
      hours >= 24
        ? `no attempt in ${Math.floor(hours / 24)}d — consumer may have stopped`
        : `no attempt in ${hours}h — consumer may have stopped`,
    );
  }

  // Idle: nothing waiting and nothing flowing — not a problem, just quiet.
  if (reasons.length === 0 && s.depth === 0 && s.throughput === 0 && s.arrivals === 0) {
    return { health: "idle", reasons };
  }
  if (reasons.length === 0) return { health: "healthy", reasons };
  // A deep backlog OR two-plus concurrent problems ⇒ at-risk; a single softer
  // signal ⇒ watch.
  const atRisk = s.depth >= DEEP_BACKLOG_DEPTH || noCompletionsWithBacklog || stalled || reasons.length >= 2;
  return { health: atRisk ? "at-risk" : "watch", reasons };
}

/** Structural contract for the Prisma delegate the reader touches. */
export interface QueueSnapshotFinder {
  findMany: (args: {
    where?: Record<string, unknown>;
    orderBy?: unknown;
    take?: number;
  }) => Promise<Array<Record<string, unknown>>>;
}

export interface QueueSnapshotReadDeps {
  getFinder?: () => Promise<QueueSnapshotFinder>;
  now?: Date;
}

function toView(row: Record<string, unknown>): QueueSnapshotView {
  const n = (k: string): number | null => {
    const v = row[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const i = (k: string): number => n(k) ?? 0;
  const computedAt = row["computedAt"];
  return {
    queueKey: String(row["queueKey"] ?? ""),
    period: String(row["period"] ?? ""),
    depth: i("depth"),
    wip: i("wip"),
    arrivals: i("arrivals"),
    throughput: i("throughput"),
    waitP50Ms: n("waitP50Ms"),
    waitP95Ms: n("waitP95Ms"),
    processP50Ms: n("processP50Ms"),
    processP95Ms: n("processP95Ms"),
    cycleP50Ms: n("cycleP50Ms"),
    cycleP95Ms: n("cycleP95Ms"),
    firstPassYield: n("firstPassYield"),
    slaAttainment: n("slaAttainment"),
    abandonmentRate: n("abandonmentRate"),
    computedAt:
      computedAt instanceof Date
        ? computedAt.toISOString()
        : String(computedAt ?? ""),
  };
}

async function defaultGetFinder(): Promise<QueueSnapshotFinder> {
  const { prisma } = await import("@dpf/db");
  return prisma.queueMetricSnapshot as unknown as QueueSnapshotFinder;
}

/**
 * Read the current-day snapshots for all queues (or a single queueKey), newest
 * period first. Returns [] on any read failure — visibility is best-effort and
 * must never throw into a coworker turn or a page render.
 */
export async function readQueueSnapshots(
  opts: { queueKey?: string; limit?: number } = {},
  deps?: QueueSnapshotReadDeps,
): Promise<QueueSnapshotView[]> {
  try {
    const now = deps?.now ?? new Date();
    const period = queueMetricPeriod(now);
    const getFinder = deps?.getFinder ?? defaultGetFinder;
    const finder = await getFinder();
    const where: Record<string, unknown> = { period };
    if (opts.queueKey) where["queueKey"] = opts.queueKey;
    const rows = await finder.findMany({
      where,
      orderBy: [{ depth: "desc" }],
      take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
    });
    return rows.map(toView);
  } catch (err) {
    console.warn(
      `[queue-snapshot-service] read failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

/** Snapshots whose health is at-risk (for attention signals / alerts). */
/**
 * Latest attempt per queue, read live rather than from the snapshot row.
 *
 * QueueMetricSnapshot carries no attempt column and adding one is a migration;
 * WorkItem.lastAttemptAt is already the authoritative record of when a consumer
 * last TOUCHED an item, so the stall signal reads it directly. Null for any queue
 * whose items record no attempt — indistinguishable from a queue that has never
 * needed one, so the stall check treats null as "no evidence" and stays quiet.
 */
export type WorkItemAttemptFinder = {
  groupBy: (args: never) => Promise<unknown>;
};

export async function readLastAttemptByQueue(
  finder: WorkItemAttemptFinder | undefined,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!finder?.groupBy) return out;
  const rows = (await (finder.groupBy as (a: unknown) => Promise<unknown>)({
    by: ["queueId"],
    _max: { lastAttemptAt: true },
    where: { status: { in: ["queued", "in-progress"] } },
  })) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const queueId = row["queueId"];
    const max = (row["_max"] as { lastAttemptAt?: unknown } | undefined)?.lastAttemptAt;
    if (typeof queueId !== "string" || !max) continue;
    out.set(`cwq:${queueId}`, max instanceof Date ? max.toISOString() : String(max));
  }
  return out;
}

export async function readAtRiskQueues(
  deps?: QueueSnapshotReadDeps & { workItemFinder?: WorkItemAttemptFinder },
): Promise<Array<{ snapshot: QueueSnapshotView; assessment: QueueHealthAssessment }>> {
  const snapshots = await readQueueSnapshots({}, deps);
  const lastAttempts = await readLastAttemptByQueue(deps?.workItemFinder);
  return snapshots
    .map((snapshot) => {
      const enriched = lastAttempts.has(snapshot.queueKey)
        ? { ...snapshot, lastAttemptAt: lastAttempts.get(snapshot.queueKey)! }
        : snapshot;
      return { snapshot: enriched, assessment: assessQueueHealth(enriched) };
    })
    .filter((x) => x.assessment.health === "at-risk");
}
