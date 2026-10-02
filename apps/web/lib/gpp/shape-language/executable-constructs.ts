// apps/web/lib/gpp/shape-language/executable-constructs.ts
//
// The executable subset: which notation constructs the runtime executes today.
// Design: docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §5 (the "Exec" column of the construct catalog), §5.4 ("never emit what the
// runtime does not execute"); plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-3, BI-6DA17863).
//
// THE RULE. A flag flips from false to true ONLY in the Phase 3c PR
// (BI-8875C9DF) that teaches the drive to execute that construct, together with
// an interpreter-parity test (the reference interpreter, interpreter.ts, run
// against the drive for that construct). Nothing else may flip one: a diagram
// that shows a construct the runtime does not run is worse than no diagram,
// because people act on the picture (GPP §12.4.2).
//
// The schema accepts every construct, so a modeller can draw it. The DRC
// (drc.ts) refuses a document that uses a construct whose flag is false with
// `E-NOT-EXECUTABLE <construct> at <element id>`, and the document stays a
// draft.
//
// §5 lists 15 constructs. Construct 11 (Timer) has two compile targets with
// different answers — the shape's review point (executed) and a stage deadline
// (not executed) — so it is two keys here, `review-point` and
// `stage-deadline`. Construct 13 (Rework edge) has two notations — a
// `flow.edges[].rework` edge and a gate's `onRefuse` route — and both are
// `rework-edge`. "Recorded only" (advisory consult) and "Declared only"
// (environment boundary) compile: what the document says is exactly what the
// runtime does with it.
//
// OFFLINE TOOLING in Phase 3b: nothing in the running app imports this module.

/** The §5 constructs, in catalog order (construct 11 split into its two compile targets). Closed. */
export const GPP_CONSTRUCTS = [
  "trigger",
  "stage",
  "capability-set",
  "gate",
  "advisory-consult",
  "status-transition",
  "human-checkpoint",
  "evidence",
  "stop",
  "escalation-boundary",
  "review-point",
  "stage-deadline",
  "parallel-split-join",
  "rework-edge",
  "sub-shape",
  "environment-boundary",
] as const;
export type GppConstruct = (typeof GPP_CONSTRUCTS)[number];

/**
 * Whether the runtime executes each construct today (spec §5, Exec column).
 * Off: stage deadline, parallel split/join, rework edge (incl. `gate.onRefuse`),
 * sub-shape — each waits for its Phase 3c PR (BI-8875C9DF).
 */
export const CONSTRUCT_EXECUTABLE: Readonly<Record<GppConstruct, boolean>> = Object.freeze({
  trigger: true,
  stage: true,
  "capability-set": true,
  gate: true,
  "advisory-consult": true,
  "status-transition": true,
  "human-checkpoint": true,
  evidence: true,
  stop: true,
  "escalation-boundary": true,
  "review-point": true,
  "stage-deadline": false,
  "parallel-split-join": false,
  "rework-edge": false,
  "sub-shape": false,
  "environment-boundary": true,
});
