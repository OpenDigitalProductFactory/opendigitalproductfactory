// apps/web/lib/build/wip-cap.ts
//
// Build Studio WIP pools: the PHYSICAL limits on concurrent work.
//
// History: this module held BUILD_WIP_CAP, a hard count of 3 active builds that
// every start path read as its admission limit. BI-3430B3A4 retired that count:
// a one-line fix and an xlarge feature no longer each take a whole slot.
// Admission is now by points in flight per portfolio
// (lib/build/investment-admission.ts, design
// docs/superpowers/specs/2026-09-24-portfolio-budget-and-investment-wip-design.md §5.6).
//
// What stays here is the unified, pool-aware model of the machine's finite
// resources (BI-937128F6): the Build Studio sandbox pool (sandboxPoolSize) and
// the shared nonproduction lease. Those are physical constraints, enforced
// where the resource is acquired and reported beside the investment limit —
// never counted into it.

import type { WipPool } from "./unified-wip";

/** Phases that count as finished — they no longer occupy a WIP slot. */
export const TERMINAL_BUILD_PHASES = ["complete", "failed"] as const;

/**
 * The Build Studio sandbox pool size: the machine's PHYSICAL limit on builds
 * executing at once (DPF_SANDBOX_POOL_SIZE, default 1). It is enforced where a
 * sandbox is acquired (sandbox-pool.ts) and reported beside the investment
 * limit. It is not the admission limit: since BI-3430B3A4, admission is by
 * points in flight per portfolio (investment-admission.ts), and the count cap
 * BUILD_WIP_CAP is retired.
 */
export function sandboxPoolSize(env: Record<string, string | undefined> = process.env): number {
  return Number(env.DPF_SANDBOX_POOL_SIZE) || 1;
}

// ─── Unified, pool-aware WIP derivation (BI-937128F6) ────────────────────────
//
// The enforced cap now reasons over the whole delivery estate, classified by the
// finite resource pool each unit of work contends on (unified-wip.gatingPool):
// a promote/new build is blocked only when ITS pool is saturated across ALL
// surfaces' active WIP — not when a BS-only build count is hit. This is the
// SOURCE-unification the founder directive asks for (unified-wip.ts header); it
// reports the physical pools; it is not the admission rule (BI-3430B3A4).

/**
 * Capacity of the shared singleton nonproduction-environment lease pool
 * (e.g. :3001). CHOSEN constant (flagged for founder confirmation in the
 * BI-937128F6 PR): `1` records the real arity of that pool — the
 * NonProductionEnvironmentLease table already enforces at most one active lease
 * per environmentKey at the DB level (@@unique(activeKey)), so runtime-bound
 * external work is gated THERE. This constant documents the arity for the
 * unified model; this WIP cap does not separately re-enforce it.
 */
export const SHARED_LEASE_WIP_CAP = 1;

/**
 * Finite capacity per resource pool the unified WIP model gates on.
 *
 * - `bs-sandbox`  — sandboxPoolSize(), the physical sandbox pool. Only
 *   build-studio work contends here (unified-wip.contendsOnBsSandbox). It is
 *   reported, not used to admit work: admission is by points in flight.
 * - `shared-lease` — SHARED_LEASE_WIP_CAP. Documents the singleton :3001 lease
 *   arity; enforcement lives in the NonProductionEnvironmentLease workflow.
 * - `host-worktree` — unbounded. External work in its own host worktree contends
 *   on no shared singleton, so it stays ungated by this cap (unchanged from today;
 *   external builds are first-class and ungated — AGENTS.md §17).
 * - `none` — unbounded. Human / git-webhook work is not resource-bound.
 */
export const WIP_POOL_CAPACITY: Readonly<Record<WipPool, number>> = {
  "bs-sandbox": sandboxPoolSize(),
  "shared-lease": SHARED_LEASE_WIP_CAP,
  "host-worktree": Number.POSITIVE_INFINITY,
  none: Number.POSITIVE_INFINITY,
};

export interface UnifiedWipDecision {
  /** The finite pool the incoming unit of work contends on. */
  readonly pool: WipPool;
  /** Active WIP already contending on that pool, across ALL surfaces. */
  readonly pressure: number;
  /** The pool's capacity (WIP_POOL_CAPACITY[pool]). */
  readonly capacity: number;
  /** True when a new unit can be admitted (pressure below capacity). */
  readonly admitted: boolean;
}

export interface UnifiedWipCapacityContext {
  /**
   * Effective local-CI capacity resolved from the versioned pool policy.
   * Invalid or absent values retain the proven singleton.
   */
  readonly sharedLeaseCapacity?: number;
}

export function effectiveWipPoolCapacity(
  pool: WipPool,
  context: UnifiedWipCapacityContext = {},
): number {
  if (pool !== "shared-lease") return WIP_POOL_CAPACITY[pool];
  return context.sharedLeaseCapacity === 2 ? 2 : SHARED_LEASE_WIP_CAP;
}

/**
 * Decide whether a new unit contending on `pool` can be admitted, given the
 * unified per-pool `pressure` across all surfaces. An unbounded pool always
 * admits. This is the derivation that replaces the BS-only hardcoded cap check.
 */
export function decideUnifiedWip(
  pool: WipPool,
  pressure: number,
  context: UnifiedWipCapacityContext = {},
): UnifiedWipDecision {
  const capacity = effectiveWipPoolCapacity(pool, context);
  const admitted = !Number.isFinite(capacity) || pressure < capacity;
  return { pool, pressure, capacity, admitted };
}
