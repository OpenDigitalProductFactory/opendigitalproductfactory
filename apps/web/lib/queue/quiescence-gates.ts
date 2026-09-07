/**
 * Activity Quiescence Protocol — Inngest function gates.
 *
 * Two gate helpers that wrap Inngest functions to refuse new work during
 * quiescence drain:
 *
 *   - gateAtEntry: for cron-triggered functions. Called at the top of the
 *     handler; returns early with skipped:true if level ≥ draining. The
 *     function exits cleanly and re-fires on the next cron tick (after
 *     platform.quiescence-cleared returns level to normal).
 *
 *   - gateBetweenSteps: for long-running event-driven functions. Called
 *     between major step boundaries; suspends the function via
 *     step.waitForEvent("platform.quiescence-cleared") so it resumes
 *     after the swap rather than being killed mid-execution.
 *
 * Exemptions: selfUpgradeScheduled and selfUpgradeManual MUST NOT be
 * wrapped — they are the callers of quiescence and gating them would
 * deadlock the upgrade.
 *
 * Spec: docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md
 *   §6.1 (this design)
 * BI-QUIESCE-004a (cron wraps), BI-QUIESCE-004b (event-driven wraps).
 */

export type GateAtEntryResult = { proceed: true } | { proceed: false; skipped: true; reason: string };

/**
 * Step-runner shape we depend on. Subset of Inngest's StepTools — kept
 * narrow so tests can stub without pulling in the full Inngest framework.
 *
 * Inngest's actual step.run returns Promise<Jsonify<T>> rather than
 * Promise<T> (it stringifies through the durable store). Since the gate's
 * own callbacks return only string-typed level values, the Jsonify wrap
 * is a no-op for our usage — we type as Promise<unknown> here and cast
 * inside the gate to keep the helper framework-agnostic.
 */
export type GateStepRunner = {
  run(name: string, fn: () => Promise<unknown>): Promise<unknown>;
};

/** Skip reason returned when an operator has set ScheduledJob.enabled=false. */
export const DISABLED_BY_OPERATOR_REASON = "disabled-by-operator";

/**
 * Call at the top of every cron function (except self-upgrade callers).
 *
 * Two checks, in order, each its own checkpointed `step.run` (Inngest
 * re-running the function after a worker restart replays the gate result
 * deterministically rather than re-querying state):
 *
 *   1. Quiescence — returns `quiescing(<level>)` when level ≥ draining.
 *   2. Per-job kill switch (BI-7E49FA15) — resolves `inngestId` through the
 *      scheduled-job catalog and returns `disabled-by-operator` when the
 *      catalogued job's ScheduledJob.enabled is false. Only entries that
 *      declare `honorsEnabledGate: true` are enforced; an entry carrying an
 *      `ungatedReason` (the quiescence callers) and an id with no catalog
 *      entry (event-driven run-now functions) proceed. A failed read also
 *      proceeds — see isJobEnabled().
 *
 * `inngestId` is REQUIRED so the compiler, not review attention, enforces
 * that every gated cron declares which job it is. Pass the same value as the
 * enclosing createFunction's `id`; the source-scan test in
 * quiescence-gates.test.ts fails the build on a mismatch.
 *
 * Callers return early with the same shape so Inngest run history records
 * the skip with a recognizable label — a skip, never a failure, which is why
 * this lives in the entry gate rather than client middleware (design doc
 * 2026-08-28-scheduled-job-kill-switch-design.md).
 */
export async function gateAtEntry(
  step: GateStepRunner,
  inngestId: string,
): Promise<GateAtEntryResult> {
  const level = (await step.run("quiescence-gate-at-entry", async () => {
    // Dynamic import to avoid loading prisma into every Inngest function's
    // module graph at definition time.
    const { getQuiescenceLevel } = await import("@/lib/self-upgrade/quiescence");
    return getQuiescenceLevel();
  })) as string;
  if (level !== "normal") {
    return { proceed: false, skipped: true, reason: `quiescing(${level})` };
  }
  const enabled = (await step.run("kill-switch-gate-at-entry", async () => {
    const { getCatalogEntryByInngestId } = await import(
      "@/lib/operate/scheduled-jobs/catalog"
    );
    const entry = getCatalogEntryByInngestId(inngestId);
    if (!entry || entry.honorsEnabledGate !== true) return true;
    const { isJobEnabled } = await import("@/lib/operate/scheduled-jobs/core");
    return isJobEnabled(entry.jobId);
  })) as boolean;
  if (!enabled) {
    return { proceed: false, skipped: true, reason: DISABLED_BY_OPERATOR_REASON };
  }
  return { proceed: true };
}

/**
 * Step-runner shape with the event-waiting primitive we need. Subset of
 * Inngest's StepTools.
 */
export type GateBetweenStepsRunner = GateStepRunner & {
  waitForEvent(
    name: string,
    opts: { event: string; timeout: string; if?: string },
  ): Promise<unknown>;
};

/**
 * Call between major step boundaries in long-running event-driven functions.
 *
 * If level ≥ draining: suspend the function via
 * step.waitForEvent("platform.quiescence-cleared", { timeout: "30m" }) so
 * it resumes after the swap.
 *
 * If level returns to normal within 30 minutes: returns and the function
 * continues. If timeout exceeds: returns anyway with a "timed-out" reason
 * so the function can decide whether to proceed or skip remaining work.
 */
export async function gateBetweenSteps(
  step: GateBetweenStepsRunner,
  stepLabel: string,
): Promise<{ resumedAfterWait: boolean; reason?: string }> {
  const level = (await step.run(`quiescence-gate-${stepLabel}`, async () => {
    const { getQuiescenceLevel } = await import("@/lib/self-upgrade/quiescence");
    return getQuiescenceLevel();
  })) as string;
  if (level === "normal") {
    return { resumedAfterWait: false };
  }
  // Wait for terminal transition event. The coordinator guarantees this
  // fires on every terminal state (spec §5.2 invariant).
  const cleared = await step.waitForEvent(`await-quiescence-cleared-${stepLabel}`, {
    event: "platform.quiescence-cleared",
    timeout: "30m",
  });
  if (!cleared) {
    return { resumedAfterWait: false, reason: "timed-out-waiting-for-cleared" };
  }
  return { resumedAfterWait: true };
}
