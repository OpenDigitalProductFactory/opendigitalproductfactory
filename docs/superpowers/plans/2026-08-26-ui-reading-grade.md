---
status: active
---

# UI reading grade — implementation plan

**Backlog:** BI-0ED0F6B3
**Epic:** EP-UX-SYSTEM
**Design:** [`../specs/2026-08-26-ui-reading-grade-design.md`](../specs/2026-08-26-ui-reading-grade-design.md)
**Shipped:** #4604, #4610, #4622, #4673

> **Retrospective.** The rulebook wants a plan before the code, and that is not what
> happened: the work was diagnosed, built and merged first, and this was written
> afterwards. Recorded that way rather than back-dated, because a plan that pretends to
> have preceded its implementation misleads whoever reads it next.

## Coverage

This plan is **atomic** and carries no `## Backlog coverage` receipt, deliberately.
`record_plan_backlog_coverage` records exactly one gate lane — `dependency-disposition` —
and this item's readiness reports `DEPENDENCY_UNRESOLVED: not-applicable`, so there is no
lane to record and the tool correctly refuses. The plan therefore declares its parent with
`**Backlog:**` rather than the `**Backlog item:**` field that triggers the coverage guard,
matching `2026-07-29-page-purpose-contract.md`.

Every phase below is a correction to one measure and depends on the preceding phase's
measurement, so none is independently shippable. The work shipped as four PRs for
reviewability, not because any phase could stand alone.

## Phase 1 — reproduce before touching anything (#4604)

Assert the defect in `packages/validators/src/readability.test.ts` before changing the
measure: the same words, at the same syllables-per-word, several grades apart with only
punctuation varying. Had that not reproduced, the BI was unfounded and the work should
have stopped.

**Done.** 6.8 unpunctuated vs 1.5 punctuated at 1.40 syllables/word.

## Phase 2 — segment the UI into utterances (#4604)

`visibleUtterances` splits the served DOM at block-level elements, inline markup staying
inside its phrase so real body copy is not shredded. Score the route's own `<main>` via
`routeContentHtml`.

**Done.** Guarded after `/platform/ai/skills` graded 43.8 on a one-word `<main>`: below
half the surface's words, keep the whole scope.

## Phase 3 — measure the blast radius before landing (#4604)

Run the sweep on the branch, download the report artifact rather than grep logs, diff the
whole distribution against `main`. Separately run the sweep in baseline-emitting mode to
establish whether the baseline carries a reading-grade axis.

**Done.** Median 16.8 → 8.7, 199 routes down, 0 up. Run 32668062704 confirmed the baseline
carries no reading axis, so no baseline commit is required.

## Phase 4 — re-examine the audience tier (#4610)

The admin/builder college re-tier rested on the inflated numbers. Re-measure the routes
that justified it, propose rather than assume, route the call through `principle_decide`.

**Done.** Every justifying route clears grade 9 — `/admin/graph-explorer`, the net-new
route whose blocking caused the re-tier, went 11.1 → 3.4. Kernel recommended restoration
(high confidence, margin 2.07, ledger `DI-710B4860812F`); operator confirmed; exception
withdrawn, table kept as an empty seam.

## Phase 5 — drop the sentence-length term (#4673)

Phase 2 removed the inflation but kept the dependency. Survey the standard formulas, pick
a word-difficulty core that preserves the existing caps, delete the superseded function.

**Done.** 8 of 8 standard formulas carry a sentence term; of four candidate cores only
Flesch–Kincaid's syllable term leaves plain copy under cap 9. `analyzeUiReadability`
ships; `analyzeUtteranceReadability` removed.

## Phase 6 — confirm on the route that surfaced the defect (#4673)

`/finance/mileage` could not be measured until #4588 reached `main`.

**Done.** Live route measures 6.7 against cap 9, as a **net-new** route where the check
blocks rather than advises. It was stuck at 14.2; its copy never changed, the measure did.

## Outcome

| | before | after #4604 | after #4673 |
|---|---|---|---|
| median grade | 16.8 | 8.7 | **6.8** |
| max | 377.1 | 15.4 | **14.7** |
| routes failing | **185 / 201** | 35 / 201 | **25 / 204** |

The final figure is against a *stricter* bar: every route is now judged at the high-school
cap of 9, the admin/builder exception having been withdrawn in phase 4.
