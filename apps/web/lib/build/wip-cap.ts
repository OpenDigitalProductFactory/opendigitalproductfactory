// apps/web/lib/build/wip-cap.ts
//
// Build Studio work-in-progress (WIP) cap.
//
// Why this exists:
//   Operators kept starting new feature builds while earlier ones sat
//   unfinished, leaving a queue full of half-done/stuck builds and nothing
//   shipped. Build Studio also shares ONE sandbox across all in-flight builds
//   (apps/web/lib/build/sandbox-driver.ts), so several builds in the BUILD
//   phase at once is actively unsafe (they collide on the same working tree).
//   This guard enforces a small WIP limit at the two entry points that create
//   builds (createFeatureBuild + the promote_to_build_studio MCP tool) so work
//   gets finished before new work starts.
//
//   The DB count is done at the call sites (typed against Prisma); this module
//   stays pure so the cap rule is trivially unit-tested. The where-clause to
//   count active builds is ACTIVE_BUILD_WIP_PHASES (non-terminal) + abandonedAt
//   null + parentEpicId null.
//
// This is the interim hard cap. The fuller queue UX (slots indicator + queued
// state badges) is designed in
// docs/superpowers/specs/2026-05-20-build-studio-layout-redesign-design.md §6.
//
// BI-937128F6 (unify WIP across surfaces): the enforced admission decision is now
// derived from the unified, POOL-AWARE WIP model — a new unit of work is admitted
// only when the finite resource pool it contends on (unified-wip.gatingPool) has a
// free slot across ALL surfaces' active WorkCapsules, not a Build-Studio-only
// build count. bs-sandbox stays capped at BUILD_WIP_CAP so today's effective limit
// is preserved exactly; see WIP_POOL_CAPACITY + decideUnifiedWip below and
// unified-wip-query.ts for the DB read that supplies the pressure.

import type { WipPool } from "./unified-wip";

/**
 * Max number of simultaneously-active feature builds. "Active" = not yet
 * complete/failed and not abandoned. Tunable; kept small on purpose because
 * all builds share one sandbox. 3 leaves room for a couple parked in
 * ideate/plan while one is actually building.
 */
export const BUILD_WIP_CAP = 3;

/** Phases that count as finished — they no longer occupy a WIP slot. */
export const TERMINAL_BUILD_PHASES = ["complete", "failed"] as const;

export class BuildWipCapError extends Error {
  readonly code = "BUILD_WIP_CAP_REACHED";
  readonly active: number;
  readonly cap: number;
  constructor(active: number, cap: number) {
    super(
      `You already have ${active} build${active === 1 ? "" : "s"} in progress ` +
        `(the limit is ${cap}). Build Studio shares one sandbox. Finish or abandon one ` +
        `before starting another — or run it as an external Claude Code / Codex / Grok ` +
        `build, which is first-class and NOT gated by the Build Studio sandbox (AGENTS.md §17). ` +
        `External work still registers its capsule, so it stays visible in the unified WIP.`,
    );
    this.name = "BuildWipCapError";
    this.active = active;
    this.cap = cap;
  }
}

/** True when `active` already-running builds means a new one would exceed the cap. */
export function wipCapReached(active: number, cap: number = BUILD_WIP_CAP): boolean {
  return active >= cap;
}

/**
 * Throw a BuildWipCapError if `active` running builds means starting another
 * would exceed the cap. Call after counting active builds at the start path.
 */
export function assertWipCapacity(active: number, cap: number = BUILD_WIP_CAP): void {
  if (wipCapReached(active, cap)) throw new BuildWipCapError(active, cap);
}

// ─── Unified, pool-aware WIP derivation (BI-937128F6) ────────────────────────
//
// The enforced cap now reasons over the whole delivery estate, classified by the
// finite resource pool each unit of work contends on (unified-wip.gatingPool):
// a promote/new build is blocked only when ITS pool is saturated across ALL
// surfaces' active WIP — not when a BS-only build count is hit. This is the
// SOURCE-unification the founder directive asks for (unified-wip.ts header); it
// does NOT loosen or tighten the live bs-sandbox limit (kept at BUILD_WIP_CAP).

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
 * - `bs-sandbox`  — BUILD_WIP_CAP. The one shared Build Studio sandbox. UNCHANGED
 *   from today's effective limit. Only build-studio work contends here
 *   (unified-wip.contendsOnBsSandbox), and this is the ONLY pool this cap
 *   actually enforces at the build-entry call sites.
 * - `shared-lease` — SHARED_LEASE_WIP_CAP. Documents the singleton :3001 lease
 *   arity; enforcement lives in the NonProductionEnvironmentLease workflow.
 * - `host-worktree` — unbounded. External work in its own host worktree contends
 *   on no shared singleton, so it stays ungated by this cap (unchanged from today;
 *   external builds are first-class and ungated — AGENTS.md §17).
 * - `none` — unbounded. Human / git-webhook work is not resource-bound.
 */
export const WIP_POOL_CAPACITY: Readonly<Record<WipPool, number>> = {
  "bs-sandbox": BUILD_WIP_CAP,
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
  const admitted = !Number.isFinite(capacity) || !wipCapReached(pressure, capacity);
  return { pool, pressure, capacity, admitted };
}

/**
 * Throw a BuildWipCapError if the pool a new unit contends on is saturated.
 * Mirrors assertWipCapacity's throw shape so existing call sites keep the same
 * error contract; an unbounded pool never throws.
 */
export function assertUnifiedWipCapacity(
  pool: WipPool,
  pressure: number,
  context: UnifiedWipCapacityContext = {},
): void {
  const decision = decideUnifiedWip(pool, pressure, context);
  if (!decision.admitted) throw new BuildWipCapError(decision.pressure, decision.capacity);
}
