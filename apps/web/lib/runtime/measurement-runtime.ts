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

// ─── Pinned measurement clock (BI-99909E53) ──────────────────────────────────
//
// Some surfaces render CALENDAR arithmetic over facts that live in code, not in
// the database: the provider-compliance source registry stamps each source with
// a retrieval date and a trust window, and the inbox projects "lapses in N
// days" / "lapses after today" / "lapsed N days ago" from it. On 2026-09-18
// /workspace/inbox drifted 418 → 425 words on `main` with no code change —
// three seeded sources crossed from "expiring" to "lapses after today" — and
// the frozen baseline failed every open PR. Wall-clock text normalisation
// (ratchet.ts) cannot cover this: the STATE changed, not just a phrasing.
//
// The remedy is the same shape as the boot contract above: under measurement
// runtime the portal reads a pinned instant from DPF_MEASUREMENT_NOW for those
// calendar-relative renders, so the sweep measures the same page on any day.
// It is deliberately NOT a global Date shim — database rows are written at real
// time (seed, heartbeats, session tokens) and a process-wide fake clock would
// put every one of them in the future. The pin reaches only code-defined
// calendar facts, through `measurementNow()`.
//
// Outside measurement runtime the variable is ignored entirely: a production
// or dev portal can never be pinned to a date by a stray environment value.

export const MEASUREMENT_NOW_ENV = "DPF_MEASUREMENT_NOW";

/**
 * The pinned instant, or null when the portal is not under measurement, the
 * variable is unset, or its value is not an ISO instant. An unparsable pin is
 * ignored rather than fatal: a sweep against the real clock is degraded, not
 * broken, and the execution record carries the value so the degradation shows.
 */
export function measurementClockPin(
  env: Record<string, string | undefined> = process.env,
): Date | null {
  if (!isMeasurementRuntime(env)) return null;
  const raw = env[MEASUREMENT_NOW_ENV]?.trim();
  if (!raw) return null;
  const pinned = new Date(raw);
  return Number.isNaN(pinned.getTime()) ? null : pinned;
}

/**
 * "Now" for calendar-relative renders of code-defined facts. The pinned instant
 * under measurement runtime; the real clock everywhere else.
 */
export function measurementNow(
  env: Record<string, string | undefined> = process.env,
): Date {
  return measurementClockPin(env) ?? new Date();
}
