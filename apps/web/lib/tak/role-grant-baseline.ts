// apps/web/lib/tak/role-grant-baseline.ts
//
// EP-31815F97 S1 (BI-56E9CEC2). Derive a conservative, ROLE-based grant baseline
// from a coworker's role (its IT4IT value stream), so per-agent grants become
// DELTAS-from-baseline instead of a hand-listed flat ~74-key set. This is the RBAC
// floor of the layered authority model: default authority = universal read
// baseline + the role's read baseline; every WRITE/act grant is an explicit,
// visible escalation (INV-A1, least-privilege / deny-by-default).
//
// The baseline is READ-ONLY by construction — writes are never baseline, always
// deltas — so "role baseline (context) + your escalations (the surface to
// review)" replaces the flat dropdown, and least-privilege is the default.
//
// Keyed on `valueStream`, the same 8-value IT4IT taxonomy that keys
// ValueStreamTeamRole (workerType ai-agent | human | either), so this model
// extends from coworkers to human roles without a rewrite (S4/follow-on). Pure;
// unit-tests without Prisma.

import { COWORKER_READ_BASELINE_GRANTS } from "./agent-grants";

export type ValueStream =
  | "evaluate"
  | "explore"
  | "integrate"
  | "deploy"
  | "release"
  | "consume"
  | "operate"
  | "cross-cutting";

const VALUE_STREAMS: readonly ValueStream[] = [
  "evaluate",
  "explore",
  "integrate",
  "deploy",
  "release",
  "consume",
  "operate",
  "cross-cutting",
];

/**
 * Extra READ grants a value stream routinely needs on top of the universal read
 * baseline (COWORKER_READ_BASELINE_GRANTS). CONSERVATIVE and READ-ONLY: this is
 * what a role of this stream reads, never what it may change. DRAFT — the
 * per-stream bundles define what every coworker of that stream can READ, so the
 * table is founder-reviewable; adding a stream key here is the whole change.
 */
export const VALUE_STREAM_READ_BASELINE: Record<ValueStream, readonly string[]> = {
  evaluate: ["portfolio_read", "telemetry_read"],
  explore: ["portfolio_read"],
  integrate: ["backlog_read", "architecture_read", "spec_plan_read"],
  deploy: ["telemetry_read", "release_plan_read"],
  release: ["release_plan_read"],
  consume: ["crm_read", "consumer_read", "marketing_read"],
  operate: ["telemetry_read", "admin_read"],
  "cross-cutting": [],
};

const unique = (xs: readonly string[]): string[] => Array.from(new Set(xs));

/** Normalize an arbitrary/legacy valueStream string to a known ValueStream, or
 *  null when unrecognized (then only the universal read baseline applies). */
export function normalizeValueStream(vs: string | null | undefined): ValueStream | null {
  if (!vs) return null;
  const v = vs.trim().toLowerCase();
  return (VALUE_STREAMS as readonly string[]).includes(v) ? (v as ValueStream) : null;
}

/**
 * The conservative role baseline: universal read baseline ∪ the value stream's
 * read baseline. READ-ONLY — never contains a write/act grant (asserted by the
 * unit tests). An unknown value stream falls back to the universal read baseline.
 */
export function deriveRoleBaselineGrants(role: { valueStream?: string | null }): string[] {
  const vs = normalizeValueStream(role.valueStream);
  const streamReads = vs ? VALUE_STREAM_READ_BASELINE[vs] : [];
  return unique([...COWORKER_READ_BASELINE_GRANTS, ...streamReads]).sort();
}

export interface GrantDelta {
  /** Escalations beyond the role baseline — the operator's real review surface. */
  added: string[];
  /** Baseline grants explicitly withheld from this coworker (rare). */
  removed: string[];
}

/** Express an effective grant set as a delta from a role baseline. */
export function computeGrantDelta(
  baseline: readonly string[],
  effective: readonly string[],
): GrantDelta {
  const b = new Set(baseline);
  const e = new Set(effective);
  return {
    added: [...e].filter((g) => !b.has(g)).sort(),
    removed: [...b].filter((g) => !e.has(g)).sort(),
  };
}

/** Reconstruct effective grants from a baseline + delta (inverse of computeGrantDelta). */
export function resolveEffectiveGrants(
  baseline: readonly string[],
  delta: GrantDelta,
): string[] {
  const set = new Set(baseline);
  for (const g of delta.removed) set.delete(g);
  for (const g of delta.added) set.add(g);
  return [...set].sort();
}

export interface AgentGrantDescription {
  valueStream: ValueStream | null;
  /** Role baseline (read-only context — not the edit surface). */
  baseline: string[];
  /** Grants beyond baseline (added deltas) — what an operator reviews/edits. */
  escalations: string[];
  /** Baseline grants withheld (removed deltas). */
  withheld: string[];
  /** The full effective grant set. */
  effective: string[];
  /** Escalations that are WRITES/acts (not `*_read`) — the least-privilege
   *  attention surface: every non-read escalation is a deliberate authority grant. */
  writeEscalations: string[];
}

/**
 * The operator-facing description of a coworker's authority: baseline (role
 * context) + escalations (the surface to review) + effective set. Replaces the
 * flat ~74-key dropdown so an operator adjusts a small delta and sees exactly
 * which non-read authorities were granted beyond the conservative floor.
 */
export function describeAgentGrants(
  role: { valueStream?: string | null },
  effectiveGrants: readonly string[],
): AgentGrantDescription {
  const baseline = deriveRoleBaselineGrants(role);
  const delta = computeGrantDelta(baseline, effectiveGrants);
  return {
    valueStream: normalizeValueStream(role.valueStream),
    baseline,
    escalations: delta.added,
    withheld: delta.removed,
    effective: unique([...effectiveGrants]).sort(),
    writeEscalations: delta.added.filter((g) => !g.endsWith("_read")),
  };
}
