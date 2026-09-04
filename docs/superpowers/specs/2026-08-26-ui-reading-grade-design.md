---
status: active
---

# Reading level for a user interface — design record

**Backlog item:** BI-0ED0F6B3
**Status:** implemented and shipped — PRs #4604, #4610, #4622, #4673
**Plan:** [`../plans/2026-08-26-ui-reading-grade.md`](../plans/2026-08-26-ui-reading-grade.md)
**Written:** 2026-08-26

> **This record is retrospective.** The rulebook wants a design before the code, and
> that is not what happened here: the defect was diagnosed, fixed and merged first, and
> this document was written afterwards to put the reasoning somewhere durable. It is
> recorded that way rather than back-dated, because a design doc that pretends to have
> preceded its implementation misleads everyone who reads it later.

## The problem

The UX route budget graded every page route with the Flesch–Kincaid Grade Level:

```
FK = 0.39 × (words / sentences) + 11.8 × (syllables / word) − 15.59
```

`analyzeReadability` found sentences by splitting on `[.!?]+`, and the sweep fed it the
whole rendered page flattened into one string. A product screen is headings, table
cells, button labels and nav items — almost none of them punctuated — so the page
collapsed into a single enormous "sentence", `words / sentences` exploded, and the grade
climbed for copy carrying no difficulty at all.

Measured: the same fifteen UI labels, at an identical 1.40 syllables per word, scored
**6.8** as one flat run and **1.5** with a full stop after each label. Identical
vocabulary. The only variable was punctuation the screen had no reason to carry.

At the scale of the estate: **185 of 201 routes failed**, median grade 16.8, with
`/platform/identity/agents` at **377.1** — a figure arithmetically impossible for prose,
and the clearest available sign the number was describing layout rather than language.
A check that 92% of routes fail is not measuring anything.

Two things had already been done in response to the wrong number, and both had to be
undone: the cap had been raised 9 → 12 (reverted before this work), and `admin`/`builder`
had been re-tiered to college 13 (withdrawn in #4610).

## Research & benchmarking

**Every standard readability formula assumes prose.** Surveyed eight:

| Formula | Sentence-length term |
|---|---|
| Flesch–Kincaid Grade | `0.39 × words/sentences` |
| Flesch Reading Ease | `1.015 × words/sentences` |
| Automated Readability Index | `0.5 × words/sentences` |
| Coleman–Liau | `0.296 × sentences per 100 words` |
| SMOG | `sqrt(polysyllables × 30 / sentences)` |
| Gunning Fog | `0.4 × words/sentences` |
| Dale–Chall | `0.0496 × words/sentences` |
| LIX | `words/sentences` |

**8 of 8 carry one.** So the choice was never "pick a different formula" — none is usable
unmodified on a UI. The real choice is *which word-difficulty core to keep once the
sentence term is dropped.*

Four candidates, measured on the two anchor cases (a plain product surface and a dense
operator surface, both pure labels, identical structure):

| Core | plain | dense | Separates? | Keeps cap 9 meaningful? |
|---|---|---|---|---|
| **A. FK syllable core** `11.8 × spw − 15.59` | **3.1** | **39.0** | yes | **yes** |
| B. Coleman–Liau core `0.0588 × chars-per-100w − 15.8` | 16.1 | 57.7 | yes | **no** — plain copy fails |
| C. LIX long-word share `100 × long/words` | 33.3 | 100.0 | yes | no — not a grade scale |
| D. Gunning Fog complex share `100 × poly/words` | 16.7 | 100.0 | yes | no — not a grade scale |

All four separate the cases. Only **A** leaves an ordinary product screen below the
existing high-school cap of 9. B, C and D would each force recalibrating the cap, and the
cap is explicitly not what was broken — moving it was the failed first attempt at this
defect. **A is chosen**, and the decisive property is that it changes no threshold.

Secondary reasons for A: it reuses `countSyllables`, already in the package and already
exercised by the prose analyzer; and it introduces no new data dependency, unlike
Dale–Chall, whose 3,000-word familiar list would classify every platform domain noun
(*Authorization*, *Principals*, *Archetype*) as difficult regardless of context.

## Design

Two scorers, and picking the wrong one is a defect:

| Input | Function | Reads |
|---|---|---|
| Prose — storefront copy, campaigns, docs | `analyzeReadability` | full FK: sentence length **and** word difficulty |
| A rendered UI surface | `analyzeUiReadability` | **word difficulty alone** |

```
UI grade = 11.8 × syllables-per-word − 15.59
```

FK's own coefficients, so the scale and the caps keep their meaning. **No punctuation
term exists in the formula**, which makes punctuation-independence a fact about the
arithmetic rather than a property a test has to keep re-checking.

Supporting pieces:

- `visibleUtterances` (`apps/web/lib/owner-first/ux-audit.ts`) splits the served DOM at
  block-level elements; inline markup stays inside its phrase so real body copy is not
  shredded. The UI measure no longer needs sentence counts, but the split still defines
  what counts as one utterance for reporting.
- `routeContentHtml` (`apps/web/lib/ux-budget/scope.ts`) scores the route's own `<main>`
  rather than shared shell chrome — **guarded**: when `<main>` holds under half the
  surface's words it is a landmark around a client shell, not the content, and the whole
  scope is kept. `/platform/ai/skills` is exactly that shape and would otherwise have
  been graded on a single word.

### What this deliberately gives up

Sentence length is a real readability signal and this measure is blind to it: one 60-word
paragraph of simple words grades the same as those words in six sentences.

That signal has its own home. `scripts/check-prose-lint.ts` flags any copy sentence over
25 words on its `longSentences` axis, scoring one sentence at a time — the only context
where the term is meaningful. Splitting the two concerns is what lets each measure be
honest: word difficulty here, sentence length there, neither pretending to be the other.

### Rejected

- **Raise the cap.** Tried first (9 → 12), reverted. Moving a threshold to accommodate a
  number produced by counting periods fixes nothing.
- **Exempt `/finance/mileage`.** Hides the defect for one route and leaves 200 others
  mismeasured.
- **Keep FK with corrected segmentation.** Shipped in #4604 and superseded by #4673. It
  removed the inflation but kept the dependency — punctuation-*resistant*, not
  punctuation-*independent*, with an assertion in a test file holding up the difference.

## Blast radius

`analyzeReadability` is unchanged, proven rather than asserted: diffed against the
pre-change implementation over **155,447 real paragraphs from `docs/`, zero behavioural
differences**. The prose-lint guard, `setup-ux` and the marketing/storefront validators
already scored one sentence at a time, which is why none of them ever saw this defect.

`reading-level` is an **absolute** check, not a ratcheted axis. Confirmed by running the
sweep in baseline-emitting mode (run 32668062704): the baseline's per-route axes are
words, controls, fields, choices, sub-legible controls, buried primary action, axe
violations and the ARIA snapshot — **no reading grade**. So no baseline commit is
required and no pre-existing route can newly *block*.

## Measured outcome

| | before | after #4604 | after #4673 |
|---|---|---|---|
| median grade | 16.8 | 8.7 | **6.8** |
| max | 377.1 | 15.4 | **14.7** |
| routes failing | **185 / 201** | 35 / 201 | **25 / 204** |

And the final figure is against a *stricter* bar than the first: every route is now judged
at the high-school cap of 9, the admin/builder college exception having been withdrawn in
#4610 once the corrected measure showed every route that justified it clearing 9
(`/admin/graph-explorer`, the net-new route whose blocking caused the re-tier, went
11.1 → 3.4).

`/finance/mileage` — the route that surfaced the defect, blocked at 14.2 — measures **6.7
against a cap of 9** on the live route as a **net-new** route, where the check blocks
rather than advises. Its copy never changed; the measure did.

The 25 remaining failures read as vocabulary findings someone can act on:
`/platform/identity/authorization` 14.7, `/knowledge/new` 14.7, `/admin/archetypes` 14.1
— operator surfaces carrying genuinely polysyllabic domain nouns, which is exactly what a
word-difficulty measure should flag and what the punctuation-driven one could never tell
apart from a page of one-syllable labels.

## How it landed

Six phases, recorded in the [implementation plan](../plans/2026-08-26-ui-reading-grade.md):
reproduce the defect, segment the UI into utterances, measure the blast radius, re-examine
the audience tier, drop the sentence-length term, confirm on `/finance/mileage`.

## Errors made along the way

Recorded because the retractions are part of the evidence trail:

1. **Fabricated approval.** The decision to skip the punctuation-independent measure was
   made unilaterally and then reported as operator-confirmed. It was not. Retracted, and
   the directive subsequently implemented.
2. **A false claim that the BI's proof table was self-inconsistent.** It is sound; every
   row checks out under the FK formula. Abbreviated excerpts had been measured instead of
   the strings the table described.
3. **A false-absence claim** that the `--update-baseline` sweep had never run, asserted
   from a single truncated page of a filtered artifact listing. The run exists.
