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
// ONE SWITCH, READ BY THE RUNTIME (Phase 3c, BI-8875C9DF). From PR-3c-1 the
// work-shape drive reads this table at runtime: a room whose pinned shape uses
// a construct whose flag is off pauses with `construct_not_executable`, naming
// the construct and element (lib/work-management/drive-resolution-graph.ts,
// through constructsUsedBy in constructs-used-by.ts). Setting a flag back to
// false is therefore also the kill switch: the compiler refuses new documents
// and the drive pauses rooms that use the construct, visibly, never running it
// some other way. Design: docs/superpowers/specs/
// 2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §5, §7.1.

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
 *
 * | Construct                    | Executable | Since, or the PR that enables it (BI-8875C9DF) |
 * |------------------------------|------------|------------------------------------------------|
 * | parallel-split-join          | yes        | PR-3c-2 (drive-parity-parallel.test.ts)        |
 * | rework-edge (incl. onRefuse) | no         | PR-3c-3                                        |
 * | stage-deadline               | no         | PR-3c-4                                        |
 * | sub-shape                    | no         | PR-3c-5                                        |
 *
 * Every other construct has been executable since Phase 3b.
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
  "parallel-split-join": true,
  "rework-edge": false,
  "sub-shape": false,
  "environment-boundary": true,
});
