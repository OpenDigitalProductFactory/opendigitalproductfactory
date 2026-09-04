---
status: active
---

# Owner-attention briefing convergence plan

| Field | Value |
| --- | --- |
| Backlog item | `BI-2C50F548` |
| Workroom | `WC-7B7175A9` |
| Design and research | [`2026-08-24-owner-attention-briefing-convergence-design.md`](../specs/2026-08-24-owner-attention-briefing-convergence-design.md) |
| Delivery shape | Atomic fix |

This file is the plan-coverage carrier for the fix. The reviewed design remains
the source of truth for the problem, research, architecture, UX fit, and ordered
fix sequence; this plan does not introduce a second design or delivery phase.

## Atomic deliverable

### `owner-briefing-projection-convergence`

- Backlog: `BI-2C50F548`
- Requirements: `OBJ-1`, `OBJ-2`, `OBJ-3`
- Contract: `buildOwnerAttentionProjection` is the single owner-routing truth;
  `loadOpeningBriefingPayload` passes only `needsYouNow` items to
  `composeOpeningBriefing`.
- Flow: follow the design's **Ordered fix sequence**—retain the observed failing
  loader regression, change the one loader seam, prove zero-owner and genuine-
  owner cases, then run the governed delivery gates.
- Verification: `AC-1`, `AC-2`, `AC-3`, `AC-4`, `AC-5`, `AC-6`, `AC-7`, and
  `AC-8`, including the focused briefing/projection suites, source-local
  typecheck, style-drift guard, exact-tree pregate, and a fresh-install browser
  exercise.
- Dependencies: none.
- Independently shippable: no. The regression test and loader change express
  one behavior correction; shipping either alone would not deliver the outcome.

## Implementation boundary

Edit only the loader seam and its regression coverage. Do not add routes, data
models, source-name filters, briefing-specific projections, or copy-only
workarounds. Preserve the pure composer's existing behavior for genuine owner
decisions and assertive room-scoped callers.

## UX fit checkpoint

The fix fits the existing Workspace route family and founder/operator persona.
It removes false owner-review copy without adding controls, navigation, or UI
primitives. Browser verification must show that team-held technical items stay
out of the opening briefing while genuine owner decisions still surface.
