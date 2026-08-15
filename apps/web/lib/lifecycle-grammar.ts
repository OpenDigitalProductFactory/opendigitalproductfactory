// Pure utility library — no server imports. Safe in tests and client components.
//
// CANONICAL LIFECYCLE GRAMMAR — the CSDM Stage → in-stage State → advancement-gate layer
// that sits ABOVE the Unified Lifecycle Backbone (apps/web/lib/lifecycle.ts).
// Spec: docs/superpowers/specs/2026-08-15-canonical-lifecycle-grammar-design.md.
//
// The backbone gives one ordered stage axis (plan…retirement) and a flat operational
// condition (draft/active/inactive). It cannot express "in this stage, but is it ready to
// move forward?" This module adds that: each Stage declares States (incl. an entry state and
// an exit-ready gate), advancement Stage N → N+1 is gated on reaching an exit-ready state and
// a legal target, and every (stage,state) point rolls up to a canonical health band so
// count-by-stage AND state-within-stage report uniformly across every lifecycle.
//
// This module is a SHAPE that multiple lifecycles instantiate (customer-account, opportunity,
// backbone, tech-currency, ovsm — declared in ./lifecycle-grammars.ts). It does not define a
// single global stage list, and it does not replace LifecycleStatus — the grammar State is a
// finer axis layered above it.

// ─── Canonical health bands (the cross-lifecycle roll-up) ───────────────────────────
// Individual state keys are lifecycle-specific; every state names one of these bands so
// "% ready to advance" / "% blocked" is one query across every lifecycle. Closed union.
export const LIFECYCLE_HEALTH_BANDS = ["on-track", "blocked", "ready"] as const;
export type LifecycleHealthBand = (typeof LIFECYCLE_HEALTH_BANDS)[number];

// ─── Grammar shape ──────────────────────────────────────────────────────────────────

export type StageState = {
  // Hyphenated per AGENTS.md §3 — EXCEPT keys that mirror an already-stored union value,
  // which retain the stored spelling so native decomposition round-trips (e.g. `at_risk`,
  // `closed_won`; see the historical-spelling exemption in packages/db/src/customer-lifecycle.ts).
  key: string;
  label: string;
  band: LifecycleHealthBand;
  /** Exactly one state per stage is the entry state (assigned on stage entry). */
  isEntry?: boolean;
  /** At least one state per non-terminal stage is exit-ready (the advancement gate is open). */
  isExitReady?: boolean;
};

export type LifecycleStageDef = {
  key: string;
  label: string;
  states: readonly StageState[];
  /** Stages legally reachable from here; terminal stages declare []. */
  advancesTo: readonly string[];
  isTerminal?: boolean;
  // Exit criteria + the stale clock are PER-STAGE (the generalised STAGE_EXIT_CRITERIA /
  // STAGE_STALE_THRESHOLDS_DAYS in crm/pipeline-inspector.ts are keyed by stage, and staleness
  // is time-in-stage, not time-in-state).
  /** Operator-facing checklist that justifies leaving this stage. */
  exitCriteria?: readonly string[];
  /** Days-in-stage before the stage is flagged stale. */
  staleAfterDays?: number;
};

export type LifecycleGrammar = {
  key: string;
  label: string;
  stages: readonly LifecycleStageDef[];
};

/** A resolved (stage, state) point for one governed entity under a grammar. */
export type LifecyclePoint = {
  stage: string;
  state: string;
};

// ─── Validation (run at module load in dev + test; a malformed grammar throws) ───────

export function validateGrammar(grammar: LifecycleGrammar): void {
  const where = `grammar "${grammar.key}"`;
  if (grammar.stages.length === 0) throw new Error(`${where}: has no stages`);
  const stageKeys = new Set<string>();
  for (const stage of grammar.stages) {
    if (stageKeys.has(stage.key)) throw new Error(`${where}: duplicate stage "${stage.key}"`);
    stageKeys.add(stage.key);

    const entries = stage.states.filter((s) => s.isEntry);
    if (entries.length !== 1) {
      throw new Error(`${where} stage "${stage.key}": must declare exactly one entry state, found ${entries.length}`);
    }
    const stateKeys = new Set<string>();
    for (const state of stage.states) {
      if (stateKeys.has(state.key)) {
        throw new Error(`${where} stage "${stage.key}": duplicate state "${state.key}"`);
      }
      stateKeys.add(state.key);
      if (!(LIFECYCLE_HEALTH_BANDS as readonly string[]).includes(state.band)) {
        throw new Error(`${where} stage "${stage.key}" state "${state.key}": unknown band "${state.band}"`);
      }
    }
    if (stage.isTerminal && stage.advancesTo.length > 0) {
      throw new Error(`${where} stage "${stage.key}": isTerminal is true but advancesTo is non-empty`);
    }
    const terminal = stage.isTerminal || stage.advancesTo.length === 0;
    if (!terminal && !stage.states.some((s) => s.isExitReady)) {
      throw new Error(`${where} stage "${stage.key}": non-terminal stage must declare ≥1 exit-ready state`);
    }
  }
  // Every advancesTo target must resolve to a declared stage, be unique, and not self-refer.
  for (const stage of grammar.stages) {
    const seen = new Set<string>();
    for (const target of stage.advancesTo) {
      if (target === stage.key) {
        throw new Error(`${where} stage "${stage.key}": advancesTo may not reference itself`);
      }
      if (seen.has(target)) {
        throw new Error(`${where} stage "${stage.key}": duplicate advancesTo target "${target}"`);
      }
      seen.add(target);
      if (!stageKeys.has(target)) {
        throw new Error(`${where} stage "${stage.key}": advancesTo references unknown stage "${target}"`);
      }
    }
  }
}

// ─── Lookups ─────────────────────────────────────────────────────────────────────────

export function getStage(grammar: LifecycleGrammar, stageKey: string): LifecycleStageDef | null {
  return grammar.stages.find((s) => s.key === stageKey) ?? null;
}

export function getState(grammar: LifecycleGrammar, stageKey: string, stateKey: string): StageState | null {
  return getStage(grammar, stageKey)?.states.find((s) => s.key === stateKey) ?? null;
}

/** The health band for a (stage, state) point; null if the point is unknown. */
export function resolveBand(
  grammar: LifecycleGrammar,
  point: LifecyclePoint,
): LifecycleHealthBand | null {
  return getState(grammar, point.stage, point.state)?.band ?? null;
}

// ─── The advancement gate ─────────────────────────────────────────────────────────────

export type AdvanceCheck = { allowed: boolean; reason?: string };

/** A stage with no onward advancement is terminal (an exit/close/end stage). */
export function isTerminalStage(stage: LifecycleStageDef): boolean {
  return Boolean(stage.isTerminal) || stage.advancesTo.length === 0;
}

/**
 * May an entity at (from.stage, from.state) advance to `toStage` right now? Legal only when
 * `toStage` is declared in the current stage's advancesTo AND either the target is a terminal
 * (exit/close/end) stage — reachable from ANY in-stage state — or the current state is an
 * exit-ready state (forward advancement to a non-terminal stage requires readiness). Returns a
 * typed reason on refusal.
 *
 * The terminal carve-out is deliberate: closing or churning an account is an *exit*, not a
 * forward skip, so it must be reachable from `blocked` states like `at_risk`/`suspended` — not
 * only from the exit-ready state. Without it the writer would silently reject involuntary churn.
 */
export function canAdvance(
  grammar: LifecycleGrammar,
  from: LifecyclePoint,
  toStage: string,
): AdvanceCheck {
  const stage = getStage(grammar, from.stage);
  if (!stage) return { allowed: false, reason: `unknown stage "${from.stage}"` };
  const state = getState(grammar, from.stage, from.state);
  if (!state) return { allowed: false, reason: `unknown state "${from.state}" in stage "${from.stage}"` };
  const target = getStage(grammar, toStage);
  if (!target) return { allowed: false, reason: `unknown target stage "${toStage}"` };
  if (!stage.advancesTo.includes(toStage)) {
    return { allowed: false, reason: `"${from.stage}" does not advance to "${toStage}"` };
  }
  if (!isTerminalStage(target) && !state.isExitReady) {
    return { allowed: false, reason: `state "${from.state}" is not exit-ready for stage "${from.stage}"` };
  }
  return { allowed: true };
}

// ─── Two-axis reporting projection ────────────────────────────────────────────────────

export type LifecycleSummary = {
  byStage: Record<string, number>;
  byBand: Record<LifecycleHealthBand, number>;
  byStageBand: Record<string, Record<LifecycleHealthBand, number>>;
  /** Points whose (stage,state) did not resolve in the grammar. */
  unresolved: number;
};

function emptyBands(): Record<LifecycleHealthBand, number> {
  return { "on-track": 0, blocked: 0, ready: 0 };
}

/**
 * Roll a set of resolved (stage,state) points up into count-by-stage AND state-within-stage
 * (by health band). Pure: callers fetch the points; this never touches the DB.
 */
export function summarizeLifecycle(
  grammar: LifecycleGrammar,
  points: readonly LifecyclePoint[],
): LifecycleSummary {
  const byStage: Record<string, number> = {};
  const byBand = emptyBands();
  const byStageBand: Record<string, Record<LifecycleHealthBand, number>> = {};
  let unresolved = 0;

  for (const stage of grammar.stages) {
    byStage[stage.key] = 0;
    byStageBand[stage.key] = emptyBands();
  }

  for (const point of points) {
    const band = resolveBand(grammar, point);
    if (band === null || byStage[point.stage] === undefined) {
      unresolved += 1;
      continue;
    }
    byStage[point.stage] += 1;
    byBand[band] += 1;
    byStageBand[point.stage][band] += 1;
  }

  return { byStage, byBand, byStageBand, unresolved };
}
