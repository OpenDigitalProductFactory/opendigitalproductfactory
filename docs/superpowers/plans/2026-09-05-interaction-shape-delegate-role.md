---
status: active
---

# BI-5A1A3C13 - Delegate step-role implementation plan

**Backlog item:** `BI-5A1A3C13`
**Epic:** `EP-4FF5273F` - Vertical Integration Inward
**Workroom:** `WC-06901F51`
**Branch:** `feat/interaction-shape-delegate-role`
**Spec:** `docs/superpowers/specs/2026-08-15-interaction-shape-graph-and-design-shaping-design.md` sections 3.2, 4, and 11

## Outcome

`delegate` becomes a first-class interaction-shape step role before any flow-load baseline can freeze the wrong behavior. A human handoff to a coworker now terminates the human traversal for `stepsToOutcome`; the receiving coworker lane remains visible as delegation metadata instead of being counted as another operator step.

## Research and current substrate

- `origin/main` contains the amended interaction-shape spec and the recovered backlog bundle, but no implementation symbols for `stepRole`, `StepRole`, `stepsToOutcome`, `jobLane`, or `continuesTo` outside docs/recovery.
- The existing navigation substrate is `apps/web/lib/ea/navigation-extract.ts`: it already projects navigation entries into SysML elements, records route trace edges, and reports navigation conformance findings. This is the right extension point for shape metadata pass-through; a second route or UX analyzer would duplicate the existing graph.
- The route audience and page purpose registries already classify who a route serves and what kind of destination it is. This slice does not fork them; later shape extractors can feed their resolved `jobLane`, `stepRole`, `continuesTo`, and `spineStage` values into the existing navigation projection.
- Code graph freshness was high-trust at the time of planning, with the caveat that `EXPOSES_TOOL` relationships were absent. Direct `git grep origin/main` confirmed the implementation gap.

## UX fit

No user-facing route changes in this slice. The UX value is measurement correctness: delegation is the platform's main cognitive-load reduction move, so the graph must not score delegation as extra human work. The navigation projection remains the source of truth for route reachability; shape metadata rides on that projection.

## Phases

1. **Contract and measurement.** Add `apps/web/lib/ea/interaction-shape.ts` with the closed `InteractionStepRole` set including `delegate`, a pure `InteractionShapeNode` contract, and a `measureInteractionFlowLoad` helper that stops on `delegate` or `complete`.
2. **Projection pass-through.** Extend `NavSourceEntry` and `buildNavigationModel` so upstream shape extractors can emit `jobLane`, `stepRole`, `continuesTo`, and `spineStage` into the SysML element properties. This keeps navigation and interaction shape coupled without creating a parallel graph.
3. **Regression coverage.** Add colocated tests proving `delegate` is in the closed role set, delegation stops `stepsToOutcome`, normal complete paths still count, dead-end detection remains explicit, and navigation entries emit supplied shape metadata.
4. **Verification and handoff.** Run targeted EA tests and the style drift guard where dependencies are available. Because this worktree started source-only, any unrun dependency-bound gate must be reported as unrun rather than green.

## Backlog coverage

- Decision: atomic
- Parent: `BI-5A1A3C13`
- Receipt: blocked-by: repository provider cannot resolve the immutable plan commit until this branch is published; MCP record_plan_backlog_coverage refused HTTP 422 while the reviewed commit existed only locally.
- Dependencies: none
- Rationale: This slice implements one independently shippable outcome, `BI-5A1A3C13`; the contract, measurement helper, projection pass-through, and tests are one behavioral unit. It does not deliver the later `prerequisitesToEntry` or `spine-stage-inert` work.

| Deliverable | BI | Requirement refs | Contract refs | Flow refs | Verification refs |
|---|---|---|---|---|---|
| `delegate-step-role` | `BI-5A1A3C13` | `OBJ-ISG-DELEGATE` | `CT-ISG-STEPROLE`, `CT-ISG-FLOWLOAD` | `FLOW-ISG-HUMAN-TRAVERSAL` | `AC-DELEGATE-ROLE`, `AC-DELEGATE-STOPS-STEPS`, `AC-DELEGATE-EMITTED` |

## Risk and rollback

Risk is low because the new module is pure and `navigation-extract` only emits optional properties when callers supply them. Rollback is one commit revert; existing navigation conformance behavior remains unchanged when no interaction-shape metadata is present.
