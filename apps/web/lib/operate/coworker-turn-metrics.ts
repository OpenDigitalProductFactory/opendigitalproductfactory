/**
 * Coworker turn-metric writer — Task 2: persist one durable rollup per coworker
 * turn so the regression detector can compute nudge-rate windows without
 * re-parsing console `[turn]` logs.
 *
 * `recordCoworkerTurnMetric` is the single fire-and-forget writer. It is called
 * from `agentic-loop.ts` at the existing `logTurnSummary()` point as
 * `void recordCoworkerTurnMetric({...})` and MUST NEVER throw or reject in a way
 * that disturbs the turn — failures are caught and logged via `console.warn`.
 *
 * Architecture grounding (see
 * docs/superpowers/plans/2026-06-05-self-diagnosing-coworker-regressions.md):
 *  - Upsert by the natural key `(threadId, agentMessageId)` so a duplicated
 *    `logTurnSummary()` call does not duplicate a turn row.
 *  - Store `null` for absent provider/model/route/agent/task values — never a
 *    synthetic `"unknown"` placeholder; bucketing collapses null to a key part
 *    in the detector, not in storage.
 *  - The Prisma client is imported lazily (and is dependency-injectable) so this
 *    module — and any unit test importing it — does not pull the generated
 *    `@dpf/db` client into the module graph at load time. This mirrors the DI
 *    pattern in `coworker-regression-detector.ts`.
 */

export type RecordCoworkerTurnMetricInput = {
  threadId: string | null;
  agentMessageId: string | null;
  agentId?: string | null;
  routeContext?: string | null;
  taskType?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  dispatches?: number | null;
  nudges?: number | null;
  toolsAttached?: boolean | null;
  executedTools?: number | null;
  totalMs?: number | null;
};

/**
 * Minimal structural contract for the Prisma delegate this writer touches.
 * Declared locally so the module never has to import the generated client type.
 */
export type CoworkerTurnMetricUpserter = {
  upsert: (args: {
    where: { threadId_agentMessageId: { threadId: string; agentMessageId: string } };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<unknown>;
};

export type RecordCoworkerTurnMetricDeps = {
  /** Injectable for tests; defaults to the lazily-imported `@dpf/db` delegate. */
  getDelegate?: () => Promise<CoworkerTurnMetricUpserter>;
};

/** Coerce an optional numeric to a stored value, defaulting absent to 0. */
function intOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Coerce an optional numeric to a nullable stored value (totalMs). */
function intOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Normalize an absent string field to `null` — never a placeholder. */
function strOrNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function defaultGetDelegate(): Promise<CoworkerTurnMetricUpserter> {
  const { prisma } = await import("@dpf/db");
  return prisma.coworkerTurnMetric as unknown as CoworkerTurnMetricUpserter;
}

/**
 * Persist (upsert) one turn rollup. Fire-and-forget safe: on any failure —
 * including a missing key or a Prisma error — it catches, warns, and resolves
 * without throwing.
 */
export async function recordCoworkerTurnMetric(
  input: RecordCoworkerTurnMetricInput,
  deps?: RecordCoworkerTurnMetricDeps,
): Promise<void> {
  try {
    const threadId = strOrNull(input.threadId);
    const agentMessageId = strOrNull(input.agentMessageId);

    // The natural key requires both correlation fields; without either there is
    // no stable row identity, so skip the write rather than insert an
    // un-joinable orphan.
    if (!threadId || !agentMessageId) return;

    const getDelegate = deps?.getDelegate ?? defaultGetDelegate;
    const delegate = await getDelegate();

    const data = {
      agentId: strOrNull(input.agentId),
      routeContext: strOrNull(input.routeContext),
      taskType: strOrNull(input.taskType),
      providerId: strOrNull(input.providerId),
      modelId: strOrNull(input.modelId),
      dispatches: intOrZero(input.dispatches),
      nudges: intOrZero(input.nudges),
      toolsAttached: Boolean(input.toolsAttached),
      executedTools: intOrZero(input.executedTools),
      totalMs: intOrNull(input.totalMs),
    };

    await delegate.upsert({
      where: { threadId_agentMessageId: { threadId, agentMessageId } },
      create: { threadId, agentMessageId, ...data },
      update: data,
    });
  } catch (err) {
    // Fire-and-forget: turn observability must never break a coworker turn.
    console.warn(
      `[coworker-turn-metrics] failed to record turn metric: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
