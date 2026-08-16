// BI-EAD441E0 slice S2 — the shared consistency check, run by BOTH the CI guard
// test and the baseline `--update` script so the two can never diverge.
//
// The committed snapshot baseline (lifecycle-grammar-snapshot.json) is the LAST
// ACCEPTED grammar structure. This check builds the CURRENT snapshot from the live
// grammars and, when they differ, runs the negation analysis over the declared
// kernel stance couplings:
//   - a change that negates a stance (removes/renames a depended element) → BLOCK;
//   - a benign structural change (additions, or edits nothing depends on) → the
//     baseline is stale and must be re-frozen via the `--update` script, a
//     deliberate reviewed step (structural evolution is a first-class propagated
//     concern, not an ad-hoc drift).

import {
  analyzeGrammarNegation,
  buildGrammarSnapshot,
  serializeSnapshot,
  type GrammarSnapshot,
  type NegationFinding,
  type StanceDependencies,
} from "./grammar-negation";
import { KERNEL_STANCE_DEPENDENCIES } from "./stance-lifecycle-dependencies";

export type ConsistencyResult = {
  /** True when the committed baseline already matches the live grammars. */
  inSync: boolean;
  /** Negating findings — a structural change invalidated a stance's stated intent. MUST block. */
  negating: NegationFinding[];
  /** Weakening findings — a depended element changed meaning but still exists. Surface. */
  weakening: NegationFinding[];
  /** The freshly-built current snapshot, serialized — what `--update` would write. */
  currentSerialized: string;
};

/**
 * Run the consistency check. Pure except for reading the live grammar registry
 * via `buildGrammarSnapshot()`; callers pass the committed baseline text and,
 * optionally, an override stance set (tests use a fixture).
 */
export function checkGrammarConsistency(
  baselineSerialized: string,
  stances: readonly StanceDependencies[] = KERNEL_STANCE_DEPENDENCIES,
  currentSnapshot: GrammarSnapshot = buildGrammarSnapshot(),
): ConsistencyResult {
  const currentSerialized = serializeSnapshot(currentSnapshot);
  const inSync = currentSerialized === baselineSerialized;

  const previous = JSON.parse(baselineSerialized) as GrammarSnapshot;
  const findings = analyzeGrammarNegation(previous, currentSnapshot, stances);
  return {
    inSync,
    negating: findings.filter((f) => f.severity === "negating"),
    weakening: findings.filter((f) => f.severity === "weakening"),
    currentSerialized,
  };
}
