---
title: Build Studio — a readable operator canvas
date: 2026-08-21
status: active
owner: platform
backlogItem: BI-101C107C
---

# Build Studio — a readable operator canvas

**Backlog:** `BI-101C107C` (follow-on) · **Decision:** `DI-BCC92F9AFC08` (Phase 3) · **Follows:** PR #4423 (ratchet), PR #4424 (one attention truth)

## Outcome

The operator's first viewport on `/build` is readable without delivery-process knowledge: one outcome sentence, nothing occluded, and no surface showing the same list twice.

## The durable rule this establishes

**There is exactly one markdown stripper for operator-facing copy, and every surface handed a raw backlog body must use it.**

That rule is the point of this change, not the individual fixes. Both surfaces that render `build.description` had invented their own idea of "tidy this up" — one collapsed whitespace and clamped, the other did nothing at all — so the same markdown wall appeared twice on one screen with only one of them ever getting fixed.

```
lib/build/owner-change-view.ts
  toProseStatement(raw)              strip structure, first prose paragraph
  clampStatement(text, maxLength)    sentence boundary, else word + ellipsis
  toOutcomeStatement(raw)            = clampStatement(toProseStatement(raw), 240)
```

A new operator surface that receives a backlog description **composes these**. It does not write a normalizer. `BuildSolutionSummaryBand` now applies the same stripper with its own 260/170 budgets, which is the intended shape: shared stripping, local clamping.

## Defects closed

| # | Defect | Fix |
| --- | --- | --- |
| 1 | Outcome slot rendered the whole markdown BI body as one plain `<p>` — literal `##`, `>`, `` ` `` on screen, unclamped | `toOutcomeStatement()` reduces to one sentence |
| 2 | "What we're building" rendered the **same** raw body one card lower | same stripper, local budget |
| 3 | DetailsDrawer is `absolute right-0 z-20` — it overlaid the canvas, clipping text mid-sentence with no reflow | centre pane reserves the drawer width while open |
| 4 | `BsQueueSection` re-listed the fleet in a second vocabulary, with counters that could read `Working: 1 Blocked: 0 Waiting: 0` above four rows | deleted; the rail is the one list |

### On #1 being deliberately lossy

The Outcome slot answers *"what did I ask for?"* in one line. The full body is not lost — the drawer's Canonical doc section already renders that same string as properly formatted markdown, which is why the canvas rendering it raw was strictly worse than the disclosure one panel away.

### On #2 — the case for looking

#1 was green in tests and the canvas read cleanly. #2 was found by opening the running portal against the exact build from the report (`FB-755EFA29`) and scrolling down. No DOM-level test would have caught it, because the assertions were written against the surface that had been fixed.

### On #3 — why padding rather than a flex sibling

Reserving width as padding keeps the drawer's `translate-x` slide. A flex sibling would have to animate width instead, which is visibly janky. Padding is dropped below `lg`, where the drawer covers most of the viewport and displacing the canvas would leave nothing readable.

**Known limitation:** with the drawer *and* the coworker panel open, the canvas becomes narrow enough that the outcome heading wraps to roughly seven lines. Strictly better than occlusion, not yet good. Worth a follow-up that considers mutual exclusion or a narrower drawer at that breakpoint.

## Verification

- `tsc --noEmit` clean; **235 test files / 2,523 tests pass**; new `outcome-statement.test.ts` (11 tests) asserts no `##`, `**`, `>` or backtick can reach the operator.
- Policy guards: source 52/52, pull-request 7/7.
- **Live**, on the contributor preview against `FB-755EFA29`: both surfaces read the clean single line; opening the drawer reflows the canvas rather than clipping it; drawer sections are Canonical doc / Progress / Outcome and brief / Review with no BS Queue; the fleet header announces "Open build progress details".
- Surface ratchet: `components/build` non-test LOC **16,370 → 16,317** — third consecutive shrink since the ratchet landed.

## Not in scope

- The drawer's **Feature Brief DESCRIPTION** field still renders the raw body unformatted. Behind progressive disclosure, and the adjacent Canonical doc section already renders the same string as markdown — lower severity than the canvas, and its own item.
- `lib/portal-context/work-resolver.ts` carries a third private copy of the stall logic (noted during Phase 2).
- Dissolving the four-layer status projection stack.
