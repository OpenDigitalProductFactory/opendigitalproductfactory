/**
 * Coworker regression detector — Task 1: latency detection over existing
 * `AdapterRunTelemetry`.
 *
 * Pure helpers (`groupDispatchRowsIntoTurns`, `computeP95`,
 * `shouldFileLatencyRegression`) are framework-free and unit-tested. The
 * orchestrator `detectCoworkerLatencyRegressions` reads recent + baseline
 * dispatch telemetry, recovers route/task via the `AgentMessage` join,
 * buckets by `(agentId, routeContext)`, compares trailing-window p95, and
 * files a deduplicated `PlatformIssueReport` through the single server-side
 * PIR writer.
 *
 * Architecture grounding (see
 * docs/superpowers/plans/2026-06-05-self-diagnosing-coworker-regressions.md):
 *  - Latency source of truth is `AdapterRunTelemetry.durationMs` (there is no
 *    `inferenceMs` on that model).
 *  - PIRs are written only via `createPlatformIssueReport()` — never a direct
 *    `prisma.platformIssueReport.create`.
 *  - The existing 15-minute issue-report triage job promotes open PIRs to bug
 *    backlog items; this detector only files PIRs.
 */

import { ISSUE_REPORT_STATUS } from "@/lib/quality/issue-report-status";

// ── Pure helper contracts ────────────────────────────────────────────────

export type AdapterTurnDispatchRow = {
  threadId: string | null;
  agentMessageId: string | null;
  agentId: string | null;
  routeContext: string | null;
  taskType: string | null;
  durationMs: number | null;
  startedAt: Date;
};

export type CoworkerTurnSample = {
  threadId: string;
  agentMessageId: string;
  agentId: string | null;
  routeContext: string | null;
  taskType: string | null;
  totalMs: number;
  startedAt: Date;
};

/**
 * Group per-dispatch telemetry rows into one sample per coworker turn.
 *
 * Rules (per plan Step 3):
 *  - Skip rows missing `threadId`, missing `agentMessageId`, or lacking a
 *    positive `durationMs`.
 *  - Group by `threadId::agentMessageId`; sum `durationMs` into `totalMs`.
 *  - Use the earliest `startedAt` as the turn timestamp.
 *  - Attribution fields (`agentId`, `routeContext`, `taskType`) are taken
 *    from the first surviving row in the group and never coerced to
 *    `"unknown"` placeholders here.
 */
export function groupDispatchRowsIntoTurns(
  rows: AdapterTurnDispatchRow[],
): CoworkerTurnSample[] {
  const byTurn = new Map<string, CoworkerTurnSample>();

  for (const row of rows) {
    if (!row.threadId || !row.agentMessageId) continue;
    if (row.durationMs == null || row.durationMs <= 0) continue;

    const key = `${row.threadId}::${row.agentMessageId}`;
    const existing = byTurn.get(key);

    if (!existing) {
      byTurn.set(key, {
        threadId: row.threadId,
        agentMessageId: row.agentMessageId,
        agentId: row.agentId,
        routeContext: row.routeContext,
        taskType: row.taskType,
        totalMs: row.durationMs,
        startedAt: row.startedAt,
      });
      continue;
    }

    existing.totalMs += row.durationMs;
    if (row.startedAt < existing.startedAt) {
      existing.startedAt = row.startedAt;
    }
    // Backfill attribution from later rows if the first surviving row lacked it.
    existing.agentId ??= row.agentId;
    existing.routeContext ??= row.routeContext;
    existing.taskType ??= row.taskType;
  }

  return [...byTurn.values()];
}

/**
 * Linear-interpolation-free p95: nearest-rank on the sorted values.
 * Returns null for an empty input.
 */
export function computeP95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank index for the 95th percentile.
  const rank = Math.ceil(0.95 * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

/**
 * Anti-flap gate: file only when the recent window has enough samples AND its
 * p95 exceeds the trailing baseline p95 by at least `factor`.
 *
 * `ratio` is reported whenever both p95 values are present and the baseline is
 * positive, so callers can surface it even when not filing; it is null when the
 * ratio is undefined (missing p95 or zero baseline).
 */
export function shouldFileLatencyRegression(input: {
  recentP95Ms: number | null;
  baselineP95Ms: number | null;
  recentSampleCount: number;
  minSamples: number;
  factor: number;
}): { file: boolean; ratio: number | null } {
  const { recentP95Ms, baselineP95Ms, recentSampleCount, minSamples, factor } =
    input;

  if (recentP95Ms == null || baselineP95Ms == null || baselineP95Ms <= 0) {
    return { file: false, ratio: null };
  }

  const ratio = recentP95Ms / baselineP95Ms;
  const file = recentSampleCount >= minSamples && ratio >= factor;
  return { file, ratio };
}

// ── Orchestration ────────────────────────────────────────────────────────

const DEFAULT_RECENT_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_BASELINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MIN_SAMPLES = 10;
const DEFAULT_FACTOR = 3;

const DETECTOR_SOURCE = "coworker-regression-detector";
const LATENCY_TRIGGER_KIND = "latency-regression";

/** Null/empty attribution collapses to this key only — never persisted. */
function bucketKeyPart(value: string | null): string {
  return value && value.trim().length > 0 ? value : "unknown";
}

export type DetectLatencyDeps = {
  now?: () => Date;
  recentWindowMs?: number;
  baselineWindowMs?: number;
  minSamples?: number;
  factor?: number;
  /** Fetch dispatch rows with `startedAt` in [from, to). */
  fetchDispatchRows: (
    from: Date,
    to: Date,
  ) => Promise<AdapterTurnDispatchRow[]>;
  /**
   * Returns true if an OPEN PIR already exists for this
   * source/trigger/agent/route tuple.
   */
  hasOpenDuplicate: (input: {
    agentId: string | null;
    routeContext: string | null;
  }) => Promise<boolean>;
  /** Files a PIR via the single server-side writer. */
  fileReport: (input: {
    title: string;
    description: string;
    severity: string;
    routeContext: string | null;
    threadId: string | null;
    agentId: string | null;
  }) => Promise<void>;
};

export type DetectLatencyResult = {
  bucketsEvaluated: number;
  filed: number;
  skippedDuplicates: number;
};

/**
 * Map ratio + absolute recent p95 to a severity. Deliberately conservative:
 * the detector should not page on a marginal regression.
 */
function severityFor(ratio: number, recentP95Ms: number): string {
  if (ratio >= 6 || recentP95Ms >= 60_000) return "critical";
  if (ratio >= 4 || recentP95Ms >= 30_000) return "high";
  return "medium";
}

/**
 * Detect coworker latency regressions and file deduplicated PIRs.
 *
 * Deps are injected so the orchestration is testable without a live database;
 * the Inngest entry point binds them to Prisma + `createPlatformIssueReport`.
 */
export async function detectCoworkerLatencyRegressions(
  deps?: Partial<DetectLatencyDeps>,
): Promise<DetectLatencyResult> {
  const resolved = await resolveDeps(deps);
  const {
    now,
    recentWindowMs,
    baselineWindowMs,
    minSamples,
    factor,
    fetchDispatchRows,
    hasOpenDuplicate,
    fileReport,
  } = resolved;

  const nowDate = now();
  const recentFrom = new Date(nowDate.getTime() - recentWindowMs);
  const baselineFrom = new Date(nowDate.getTime() - baselineWindowMs);

  const [recentRows, baselineRows] = await Promise.all([
    fetchDispatchRows(recentFrom, nowDate),
    // Baseline window ends where the recent window begins so the two do not overlap.
    fetchDispatchRows(baselineFrom, recentFrom),
  ]);

  const recentTurns = groupDispatchRowsIntoTurns(recentRows);
  const baselineTurns = groupDispatchRowsIntoTurns(baselineRows);

  const recentBuckets = bucketByAgentRoute(recentTurns);
  const baselineBuckets = bucketByAgentRoute(baselineTurns);

  let filed = 0;
  let skippedDuplicates = 0;
  let bucketsEvaluated = 0;

  for (const [key, recent] of recentBuckets) {
    bucketsEvaluated++;
    const baseline = baselineBuckets.get(key) ?? [];

    const recentP95 = computeP95(recent.map((t) => t.totalMs));
    const baselineP95 = computeP95(baseline.map((t) => t.totalMs));

    const decision = shouldFileLatencyRegression({
      recentP95Ms: recentP95,
      baselineP95Ms: baselineP95,
      recentSampleCount: recent.length,
      minSamples,
      factor,
    });

    if (!decision.file || decision.ratio == null || recentP95 == null) continue;

    // Representative attribution + worst exemplar come from the recent bucket.
    const agentId = recent[0].agentId;
    const routeContext = recent[0].routeContext;
    const exemplar = recent.reduce((worst, t) =>
      t.totalMs > worst.totalMs ? t : worst,
    );

    if (await hasOpenDuplicate({ agentId, routeContext })) {
      skippedDuplicates++;
      continue;
    }

    const severity = severityFor(decision.ratio, recentP95);
    const agentLabel = agentId ?? "unknown-agent";
    const routeLabel = routeContext ?? "unknown-route";

    const description = [
      `Coworker turn latency regression detected.`,
      ``,
      `Agent: ${agentLabel}`,
      `Route: ${routeLabel}`,
      `Recent p95: ${recentP95}ms (n=${recent.length})`,
      `Baseline p95: ${baselineP95}ms (n=${baseline.length})`,
      `Ratio: ${decision.ratio.toFixed(2)}x (threshold ${factor}x)`,
      `Window: last ${Math.round(recentWindowMs / 60000)}m vs prior ${Math.round(
        baselineWindowMs / (24 * 60 * 60 * 1000),
      )}d`,
      ``,
      `Worst exemplar turn:`,
      `  thread: ${exemplar.threadId}`,
      `  agentMessage: ${exemplar.agentMessageId}`,
      `  totalMs: ${exemplar.totalMs}`,
      `  taskType: ${exemplar.taskType ?? "unknown"}`,
    ].join("\n");

    await fileReport({
      title: `Coworker latency regression: ${agentLabel} on ${routeLabel}`,
      description,
      severity,
      routeContext,
      threadId: exemplar.threadId,
      agentId,
    });
    filed++;
  }

  return { bucketsEvaluated, filed, skippedDuplicates };
}

function bucketByAgentRoute(
  turns: CoworkerTurnSample[],
): Map<string, CoworkerTurnSample[]> {
  const buckets = new Map<string, CoworkerTurnSample[]>();
  for (const turn of turns) {
    const key = `${bucketKeyPart(turn.agentId)}::${bucketKeyPart(
      turn.routeContext,
    )}`;
    const list = buckets.get(key);
    if (list) list.push(turn);
    else buckets.set(key, [turn]);
  }
  return buckets;
}

/**
 * Bind detector deps to live substrate (Prisma + the single PIR writer) for
 * any caller that does not inject its own. Prisma and the route/task join are
 * imported lazily so the pure helpers stay importable in tests without pulling
 * the database client into the module graph.
 */
async function resolveDeps(
  deps?: Partial<DetectLatencyDeps>,
): Promise<Required<DetectLatencyDeps>> {
  const now = deps?.now ?? (() => new Date());
  const recentWindowMs = deps?.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;
  const baselineWindowMs = deps?.baselineWindowMs ?? DEFAULT_BASELINE_WINDOW_MS;
  const minSamples = deps?.minSamples ?? DEFAULT_MIN_SAMPLES;
  const factor = deps?.factor ?? DEFAULT_FACTOR;

  const fetchDispatchRows =
    deps?.fetchDispatchRows ??
    (async (from: Date, to: Date) => {
      const { prisma } = await import("@dpf/db");
      // Pull dispatch telemetry for coworker turns in the window, then recover
      // route/task by joining AgentMessage on agentMessageId.
      const rows = await prisma.adapterRunTelemetry.findMany({
        where: {
          startedAt: { gte: from, lt: to },
          threadId: { not: null },
          agentMessageId: { not: null },
          durationMs: { gt: 0 },
        },
        select: {
          threadId: true,
          agentMessageId: true,
          agentId: true,
          durationMs: true,
          startedAt: true,
        },
      });

      const messageIds = [
        ...new Set(
          rows
            .map((r) => r.agentMessageId)
            .filter((id): id is string => id != null),
        ),
      ];

      const messages = messageIds.length
        ? await prisma.agentMessage.findMany({
            where: { id: { in: messageIds } },
            select: { id: true, routeContext: true, taskType: true },
          })
        : [];
      const byMessageId = new Map(messages.map((m) => [m.id, m]));

      return rows.map((r) => {
        const msg = r.agentMessageId
          ? byMessageId.get(r.agentMessageId)
          : undefined;
        return {
          threadId: r.threadId,
          agentMessageId: r.agentMessageId,
          agentId: r.agentId,
          routeContext: msg?.routeContext ?? null,
          taskType: msg?.taskType ?? null,
          durationMs: r.durationMs,
          startedAt: r.startedAt,
        } satisfies AdapterTurnDispatchRow;
      });
    });

  const hasOpenDuplicate =
    deps?.hasOpenDuplicate ??
    (async ({ agentId, routeContext }) => {
      const { prisma } = await import("@dpf/db");
      const existing = await prisma.platformIssueReport.findFirst({
        where: {
          status: ISSUE_REPORT_STATUS.OPEN,
          source: DETECTOR_SOURCE,
          triggerKind: LATENCY_TRIGGER_KIND,
          agentId: agentId ?? null,
          routeContext: routeContext ?? null,
        },
        select: { id: true },
      });
      return existing != null;
    });

  const fileReport =
    deps?.fileReport ??
    (async ({ title, description, severity, routeContext, threadId, agentId }) => {
      const { createPlatformIssueReport } = await import(
        "@/lib/quality/platform-issue-reports"
      );
      await createPlatformIssueReport({
        type: "regression",
        source: DETECTOR_SOURCE,
        triggerKind: LATENCY_TRIGGER_KIND,
        title,
        description,
        severity,
        routeContext,
        threadId,
        agentId,
      });
    });

  return {
    now,
    recentWindowMs,
    baselineWindowMs,
    minSamples,
    factor,
    fetchDispatchRows,
    hasOpenDuplicate,
    fileReport,
  };
}
