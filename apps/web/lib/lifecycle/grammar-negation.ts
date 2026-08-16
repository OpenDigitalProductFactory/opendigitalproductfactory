// BI-EAD441E0 slice S1 — the pure detection core of the stance ↔ lifecycle
// consistency guard.
//
// Lifecycle structure (the stage/state grammar, BI-E55991E9) and the governance
// stances (WWWD corpus) are COUPLED. A structural change that removes, renames,
// or re-semanticizes a grammar element a stance DEPENDS ON must be detected so it
// can be routed through governance rather than silently invalidating stated
// intent (e.g. gutting the OVSM `retain` stage while a stance says continued use
// is the goal).
//
// This module is PURE — no I/O, no DB, no throw. It is consumed by:
//   - the CI structural guard (S2, scripts/check-lifecycle-stance-consistency.mjs)
//     which diffs a committed snapshot baseline against the current grammars, and
//   - the per-install runtime routing (S3, BI-696B91AB) which runs the SAME
//     analysis against the install's live stance corpus.
// One analyzer, both surfaces — the detection can never diverge between them.

import type { LifecycleGrammar } from "@/lib/lifecycle-grammar";
import { LIFECYCLE_GRAMMARS } from "@/lib/lifecycle-grammars";

// ─── Coupling model ───────────────────────────────────────────────────────────

/**
 * A stance's declared dependency on a grammar element. Stored in the existing
 * free-form `WikiPage.metadata` JSON column (key `lifecycleDependencies`), so a
 * negation is DETECTABLE rather than guessed. `state` is optional — a stance may
 * depend on a whole stage (e.g. "retain exists") or a specific in-stage state.
 */
export type LifecycleDependency = {
  grammar: string;
  stage: string;
  state?: string;
};

// ─── Snapshot ─────────────────────────────────────────────────────────────────

/** Semantic descriptor of one stage — the fields whose change is re-semanticization. */
export type StageDescriptor = { label: string; exitCriteria: string[] };
/** Semantic descriptor of one in-stage state. */
export type StateDescriptor = { label: string; band: string };

/**
 * A deterministic, serializable projection of the declared grammars. Keyed so a
 * removed/renamed element is a missing key and a re-semanticized element is a
 * changed value. This is what the S2 baseline freezes and diffs against.
 */
export type GrammarSnapshot = {
  stages: Record<string, StageDescriptor>; // key: `${grammar}::${stage}`
  states: Record<string, StateDescriptor>; // key: `${grammar}::${stage}::${state}`
};

export function stageKey(grammar: string, stage: string): string {
  return `${grammar}::${stage}`;
}
export function stateKey(grammar: string, stage: string, state: string): string {
  return `${grammar}::${stage}::${state}`;
}

/**
 * Build a snapshot from a grammar registry (defaults to the live
 * `LIFECYCLE_GRAMMARS`). Pure and deterministic: keys are sorted on serialize by
 * the caller (see `serializeSnapshot`), so the same registry always yields the
 * same bytes.
 */
export function buildGrammarSnapshot(
  registry: Record<string, LifecycleGrammar> = LIFECYCLE_GRAMMARS,
): GrammarSnapshot {
  const stages: Record<string, StageDescriptor> = {};
  const states: Record<string, StateDescriptor> = {};
  for (const grammar of Object.values(registry)) {
    for (const stage of grammar.stages) {
      stages[stageKey(grammar.key, stage.key)] = {
        label: stage.label,
        exitCriteria: [...(stage.exitCriteria ?? [])],
      };
      for (const state of stage.states) {
        states[stateKey(grammar.key, stage.key, state.key)] = {
          label: state.label,
          band: state.band,
        };
      }
    }
  }
  return { stages, states };
}

/** Deterministic JSON with sorted keys — safe to freeze as a baseline and diff. */
export function serializeSnapshot(snapshot: GrammarSnapshot): string {
  const sortObj = <T>(o: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return `${JSON.stringify({ stages: sortObj(snapshot.stages), states: sortObj(snapshot.states) }, null, 2)}\n`;
}

// ─── Dependency parsing + resolution ───────────────────────────────────────────

/**
 * Read declared lifecycle dependencies off a stance page's `metadata` JSON.
 * Tolerant of every malformed shape — a non-object metadata, a missing or
 * non-array `lifecycleDependencies`, or entries missing `grammar`/`stage` — and
 * returns `[]` rather than throwing (this runs on the publish/CI path). `state`
 * is carried only when it is a non-empty string.
 */
export function parseLifecycleDependencies(metadata: unknown): LifecycleDependency[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as Record<string, unknown>)["lifecycleDependencies"];
  if (!Array.isArray(raw)) return [];
  const out: LifecycleDependency[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const grammar = e["grammar"];
    const stage = e["stage"];
    if (typeof grammar !== "string" || !grammar) continue;
    if (typeof stage !== "string" || !stage) continue;
    const state = e["state"];
    out.push({
      grammar,
      stage,
      ...(typeof state === "string" && state ? { state } : {}),
    });
  }
  return out;
}

/** Whether a declared dependency resolves against a registry today (the queryable half of AC-1). */
export function resolveDependency(
  dep: LifecycleDependency,
  registry: Record<string, LifecycleGrammar> = LIFECYCLE_GRAMMARS,
): boolean {
  const grammar = registry[dep.grammar];
  if (!grammar) return false;
  const stage = grammar.stages.find((s) => s.key === dep.stage);
  if (!stage) return false;
  if (dep.state === undefined) return true;
  return stage.states.some((s) => s.key === dep.state);
}

// ─── Negation analysis ─────────────────────────────────────────────────────────

export type NegationDelta = "removed" | "resemanticized";
export type NegationSeverity = "negating" | "weakening";

export type NegationFinding = {
  /** The stance whose stated intent the structural change affects. */
  slug: string;
  dependency: LifecycleDependency;
  delta: NegationDelta;
  severity: NegationSeverity;
  detail: string;
};

/** A stance and the dependencies it declared (as parsed from its metadata). */
export type StanceDependencies = {
  slug: string;
  dependencies: readonly LifecycleDependency[];
};

function exitCriteriaChanged(a: string[], b: string[]): boolean {
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}

/**
 * Compute which stances a structural change negates or weakens, by diffing a
 * `previous` snapshot against the `current` one for every declared stance
 * dependency. At most ONE finding per dependency, most-severe first:
 *
 *   - a depended stage/state key present in `previous` but gone from `current`
 *     → `removed` / **negating** (a rename is the old key going missing);
 *   - a still-present depended element whose label / band / exit-criteria changed
 *     → `resemanticized` / **weakening**.
 *
 * A dependency that did not resolve in `previous` either is NOT this change's
 * doing and is skipped (it is pre-existing unresolved intent, out of scope).
 */
export function analyzeGrammarNegation(
  previous: GrammarSnapshot,
  current: GrammarSnapshot,
  stances: readonly StanceDependencies[],
): NegationFinding[] {
  const findings: NegationFinding[] = [];
  for (const stance of stances) {
    for (const dep of stance.dependencies) {
      const sKey = stageKey(dep.grammar, dep.stage);
      const prevStage = previous.stages[sKey];
      // Skip deps that were never valid in the previous snapshot — not this change's doing.
      if (!prevStage) continue;

      const curStage = current.stages[sKey];
      const stKey = dep.state !== undefined ? stateKey(dep.grammar, dep.stage, dep.state) : null;
      const prevState = stKey ? previous.states[stKey] : null;
      // A state-level dep that was never valid in previous is likewise skipped.
      if (stKey && !prevState) continue;

      // ── Removal (negating) takes precedence ──
      if (!curStage) {
        findings.push({
          slug: stance.slug,
          dependency: dep,
          delta: "removed",
          severity: "negating",
          detail: `stage '${dep.grammar}::${dep.stage}' was removed or renamed; the stance depends on it`,
        });
        continue;
      }
      if (stKey) {
        const curState = current.states[stKey];
        if (!curState) {
          findings.push({
            slug: stance.slug,
            dependency: dep,
            delta: "removed",
            severity: "negating",
            detail: `state '${dep.grammar}::${dep.stage}::${dep.state}' was removed or renamed; the stance depends on it`,
          });
          continue;
        }
      }

      // ── Re-semanticization (weakening) on a still-present element ──
      const stageResemanticized =
        curStage.label !== prevStage.label ||
        exitCriteriaChanged(prevStage.exitCriteria, curStage.exitCriteria);
      let stateResemanticized = false;
      if (stKey && prevState) {
        const curState = current.states[stKey]!;
        stateResemanticized =
          curState.label !== prevState.label || curState.band !== prevState.band;
      }
      if (stageResemanticized || stateResemanticized) {
        const target = stateResemanticized
          ? `state '${dep.grammar}::${dep.stage}::${dep.state}'`
          : `stage '${dep.grammar}::${dep.stage}'`;
        findings.push({
          slug: stance.slug,
          dependency: dep,
          delta: "resemanticized",
          severity: "weakening",
          detail: `${target} kept its key but changed meaning (label/band/exit-criteria); the stance may no longer hold`,
        });
      }
    }
  }
  return findings;
}
