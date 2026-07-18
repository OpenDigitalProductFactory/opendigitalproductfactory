/**
 * Promoter subprocess exit-code contract, kept in a dedicated PURE module (no
 * `node:child_process` / Docker imports). Server bundle entrypoints — Inngest
 * functions, routes, server actions — must NOT statically import the host-only
 * promoter runtime (`./promoter`, which spawns docker); the bundle-boundary
 * guard (BI-98AF1066) enforces that. Those callers import these constants from
 * here instead, and `./promoter` re-exports them for its own callers and tests.
 */

/**
 * Internal sentinel `runPromoter` reports when it DECLINES to launch because a
 * promoter for this run is already building — a concurrent or retried dispatch
 * of the SAME runId. Not a real process exit code: the orchestrator special-
 * cases it to defer to the owning dispatch instead of recording a failure.
 *
 * Without the guard, the deterministic `docker run --name dpf-promoter-<runId>`
 * of the second dispatch collides ("The container name is already in use") and
 * the orchestrator marked a HEALTHY in-flight build as failed (SUR-E2BF265E:
 * the first promoter was past Step 40/119 when the run flipped to `failed`).
 */
export const PROMOTER_ALREADY_RUNNING_EXIT_CODE = 188;
