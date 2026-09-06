// Measurement-runtime boot mode (BI-232BA634).
//
// The UX route sweep boots a REAL production portal and measures every route
// against a frozen baseline. Same-tree sweep runs have flipped pass/fail
// (merge-group runs 30434754297 fail / 30438124151 pass shared git tree
// 79055b61) because instrumentation's fire-and-forget boot reconcilers keep
// WRITING operational state — self-upgrade/quiescence/backup reconciles, org
// backfills, version sync — while the crawl is measuring the routes that
// render that state. Which side of each write a route lands on is a race.
//
// Under DPF_MEASUREMENT_RUNTIME=1 the boot contract changes to "deterministic
// by construction":
//   - render-relevant idempotent syncs are AWAITED inside register(), so every
//     request observes the same post-sync state (Next serves no traffic until
//     register() resolves);
//   - operational self-heal maintenance (stuck-run reconciles, watchdog
//     intervals) is SKIPPED — an ephemeral measurement portal has nothing to
//     heal, and its writes are exactly the nondeterminism being removed.
// Production and dev boots (flag unset) are byte-for-byte unchanged.

import { envFlagEnabled } from "@/lib/runtime/env-flags";

export function isMeasurementRuntime(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envFlagEnabled(env, "DPF_MEASUREMENT_RUNTIME");
}

/**
 * Run a render-relevant idempotent boot sync. Awaited under measurement
 * runtime so it completes before the portal serves its first request;
 * fire-and-forget otherwise (the pre-existing production behavior). Failures
 * never block boot in either mode — these tasks carry their own logging.
 */
export async function settleBootSync(
  measurementRuntime: boolean,
  task: () => Promise<unknown>,
): Promise<void> {
  if (!measurementRuntime) {
    void task();
    return;
  }
  try {
    await task();
  } catch {
    // Boot syncs are non-fatal by contract; the task logs its own failure.
  }
}

/**
 * Apply the boot-settlement contract to a related set of render-relevant
 * reconcilers. Measurement mode runs them in declaration order so the first
 * served request observes one deterministic post-reconciliation database.
 * Normal boots still start every task without waiting for completion.
 */
export async function settleBootSyncs(
  measurementRuntime: boolean,
  tasks: ReadonlyArray<() => Promise<unknown>>,
): Promise<void> {
  for (const task of tasks) {
    await settleBootSync(measurementRuntime, task);
  }
}
