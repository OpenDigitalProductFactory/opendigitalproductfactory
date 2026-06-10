// apps/web/lib/queue/admission.ts
//
// Instance admission control — shared concurrency lane for the build pipeline
// (instance admission-control spec §4.1–4.3, building on the merged dead-phase
// reaper §4.4).
//
// Inngest has no "reserve capacity for function X" primitive. So the self-
// upgrade PRIORITY LANE is implemented the only way the substrate allows: CAP
// the build/agent flood in a shared account-scoped lane, leaving headroom below
// the Inngest account concurrency ceiling that the self-upgrade + sandbox-
// recovery functions — which are deliberately NOT enrolled in this lane — can
// always use. A queued "Upgrade now" then never sits behind the build flood.
//
// Config-gated and OFF by default: with DPF_BUILD_PIPELINE_CONCURRENCY unset,
// buildPipelineLane() returns [] and every enrolled function keeps EXACTLY its
// current concurrency — zero behavior change. An operator sizes the cap to
// their instance (below the account limit, reserving headroom) and load-tests
// it deliberately under real concurrent load (spec §6), never blind-shipped.

/**
 * Shared account-scoped concurrency key. Every build-pipeline function enrolled
 * in this lane shares ONE aggregate limit (a single Inngest virtual queue);
 * self-upgrade / recovery functions are excluded so they run in the reserved
 * headroom.
 */
export const BUILD_PIPELINE_LANE_KEY = "dpf-build-pipeline";

export const BUILD_PIPELINE_LIMIT_ENV = "DPF_BUILD_PIPELINE_CONCURRENCY";

/** Minimal structural shape of an Inngest concurrency constraint. */
export type ConcurrencyConstraint = {
  scope?: "fn" | "account" | "env";
  key?: string;
  limit: number;
};

/**
 * Parse the configured aggregate cap. Returns a positive integer, or null when
 * unset/invalid (→ lane disabled). Pure.
 */
export function parseBuildPipelineLimit(raw: string | undefined | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function readBuildPipelineLimit(): number | null {
  return parseBuildPipelineLimit(process.env[BUILD_PIPELINE_LIMIT_ENV]);
}

/**
 * The shared-lane constraint to spread into an enrolled function's
 * `concurrency` array, e.g. `concurrency: [{ limit: 2 }, ...buildPipelineLane()]`.
 *
 * Returns [] when the lane is unset (the function then keeps exactly its prior
 * concurrency — zero behavior change). When set, every enrolled function shares
 * one aggregate `limit` across the account via the constant CEL key.
 */
export function buildPipelineLane(
  limit: number | null = readBuildPipelineLimit(),
): ConcurrencyConstraint[] {
  if (limit == null) return [];
  // Constant CEL string literal → all enrolled functions map to one virtual
  // queue, so `limit` bounds their AGGREGATE in-flight count, not per-function.
  return [{ scope: "account", key: `'${BUILD_PIPELINE_LANE_KEY}'`, limit }];
}
