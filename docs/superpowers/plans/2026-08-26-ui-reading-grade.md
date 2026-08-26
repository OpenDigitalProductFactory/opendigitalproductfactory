---
status: active
---

# Plan — reading level for a user interface

**Backlog item:** BI-0ED0F6B3
**Design:** [`../specs/2026-08-26-ui-reading-grade-design.md`](../specs/2026-08-26-ui-reading-grade-design.md)
**Status:** complete

> Retrospective, like its design record. The phases below are how the work actually
> landed, not a plan written before it.

## Phase 1 — reproduce before touching anything (#4604)

Assert the defect in `packages/validators/src/readability.test.ts` before changing the
measure: the same words, at the same syllables-per-word, several grades apart with only
punctuation varying. If that had not reproduced, the whole BI was unfounded and the work
should have stopped.

**Done.** 6.8 unpunctuated vs 1.5 punctuated at spw 1.40.

## Phase 2 — segment the UI into utterances (#4604)

`visibleUtterances` splits the served DOM at block-level elements, inline markup staying
inside its phrase. Score the route's own `<main>` via `routeContentHtml`, guarded so a
landmark that does not hold the page's words does not become the thing measured.

**Done.** Guard added after `/platform/ai/skills` failed at 43.8 on a one-word `<main>`.

## Phase 3 — measure the blast radius before landing (#4604)

Run the full sweep on the branch, download the report artifact rather than grep logs,
diff the whole 201-route distribution against `main`. Separately run the sweep in
baseline-emitting mode to establish whether the baseline carries a reading-grade axis.

**Done.** Median 16.8 → 8.7, 199 routes down, 0 up. Baseline carries no reading axis, so
no baseline commit is required.

## Phase 4 — re-examine the audience tier (#4610)

The admin/builder college re-tier rested on the inflated numbers. Re-measure the routes
that justified it, propose rather than assume, and route the call through
`principle_decide`.

**Done.** Every justifying route clears grade 9 under the corrected measure. Kernel
recommended restoration (high confidence, margin 2.07, ledger `DI-710B4860812F`);
operator confirmed; exception withdrawn, table kept as an empty seam.

## Phase 5 — drop the sentence-length term (#4673)

Phase 2 removed the inflation but kept the dependency. Survey the standard formulas,
choose a word-difficulty core that preserves the existing caps, and delete the superseded
function rather than leave two homes for one question.

**Done.** 8 of 8 standard formulas carry a sentence term; of four candidate cores only
FK's syllable term leaves plain copy under cap 9. `analyzeUiReadability` ships;
`analyzeUtteranceReadability` removed.

## Phase 6 — confirm on the route that surfaced the defect (#4673)

`/finance/mileage` could not be measured until #4588 reached `main`.

**Done.** Live route measures 6.7 against cap 9, as a net-new route where the check
blocks.
