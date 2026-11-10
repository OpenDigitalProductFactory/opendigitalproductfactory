/**
 * The self-upgrade job as three kinds of step: pre-drain, wait, swap
 * (BI-F9EE05E5, plan slice A item 8).
 *
 * Before this, the whole of runSelfUpgrade ran inside ONE step.run, so the
 * drain's wait was a DB poll inside a single job-engine HTTP request. That was
 * tolerable for a 5-minute drain; an upgrade now waits up to an hour for work
 * and can then pause for the operator for longer, which no single request
 * should hold. Splitting it means:
 *   - pre-drain: every gate, source prep, candidate preflight, startQuiescence;
 *   - wait: short status-read steps between waitForEvent sleeps, woken at once
 *     by the coordinator's ready-to-swap event (one read per minute otherwise);
 *   - settle + swap: the outcome is recorded, then recovery point and promoter.
 *
 * The phases are injected (self-upgrade.ts supplies them) so this module does
 * not import the orchestrator, and every value crossing a step boundary is
 * plain JSON. Secrets never cross one: the swap step reloads the install-state
 * signing context itself.
 */
import type { JobStepTools } from "@/lib/jobs";
import type { QuiescenceOutcome } from "@/lib/self-upgrade/quiescence";
import { QUIESCENCE_READY_EVENT, readQuiescenceOutcome } from "@/lib/self-upgrade/drain-wait";
import type { SelfUpgradeRunEventData } from "./self-upgrade-contract";
import type { SelfUpgradeSwapContext } from "./self-upgrade-swap";

export type SelfUpgradeBegin =
  | { done: Record<string, unknown> }
  | { draining: SelfUpgradeSwapContext; awaitReady?: () => Promise<QuiescenceOutcome> };

export type SelfUpgradePhases = {
  begin: (params: SelfUpgradeRunEventData) => Promise<SelfUpgradeBegin>;
  /** Record a drain outcome. Returns the run's final result to stop, or null to swap. */
  settle: (ctx: SelfUpgradeSwapContext, outcome: QuiescenceOutcome) => Promise<Record<string, unknown> | null>;
  finish: (ctx: SelfUpgradeSwapContext) => Promise<Record<string, unknown>>;
};

type StepTools = Pick<JobStepTools, "run" | "waitForEvent">;

// One status read per minute while waiting, woken early by ready-to-swap. The
// coordinator gives up after ~5h (MAX_WAIT_CHECKS in quiescence-run.ts), so 400
// reads (~800 steps) outlast it while staying under the engine's step cap.
const DRAIN_STATUS_TIMEOUT = "60s";
const MAX_DRAIN_STATUS_READS = 400;

export async function runSelfUpgradeInSteps(
  step: StepTools,
  data: SelfUpgradeRunEventData,
  phases: SelfUpgradePhases,
): Promise<Record<string, unknown>> {
  const begun = (await step.run("self-upgrade-pre-drain", async () => {
    const r = await phases.begin(data);
    // Drop the in-process awaitReady closure: it cannot cross a step boundary.
    return "done" in r ? { done: r.done } : { draining: r.draining };
  })) as SelfUpgradeBegin;
  if ("done" in begun) return begun.done;
  const ctx = begun.draining;

  if (ctx.quiescenceRunId) {
    const outcome = await waitForDrainOutcome(step, ctx.quiescenceRunId);
    const settled = (await step.run("self-upgrade-drain-outcome", () =>
      phases.settle(ctx, outcome),
    )) as Record<string, unknown> | null;
    if (settled) return settled;
  }
  return (await step.run("self-upgrade-swap", () => phases.finish(ctx))) as Record<string, unknown>;
}

async function waitForDrainOutcome(step: StepTools, quiescenceRunId: string): Promise<QuiescenceOutcome> {
  for (let i = 0; i < MAX_DRAIN_STATUS_READS; i++) {
    const out = (await step.run(`drain-status-${i}`, () => readQuiescenceOutcome(quiescenceRunId))) as
      | QuiescenceOutcome
      | { waiting: true };
    if (!("waiting" in out)) return out;
    await step.waitForEvent(`drain-ready-${i}`, {
      event: QUIESCENCE_READY_EVENT,
      timeout: DRAIN_STATUS_TIMEOUT,
      if: `async.data.runId == "${quiescenceRunId}"`,
    });
  }
  return {
    ok: false,
    outcome: "failed",
    runId: quiescenceRunId,
    reason: `self-upgrade stopped waiting after ${MAX_DRAIN_STATUS_READS} status reads`,
  };
}
