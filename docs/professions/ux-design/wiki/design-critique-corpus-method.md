---
title: Design critique corpus method
pageKind: runbook
status: published
abstract: How the platform's UX critique corpus is captured, who may author a verdict, and why a corpus is a prerequisite for design critique rather than a nice-to-have. Grounded critique reaches roughly 55% better quality than zero-shot; ungrounded design comments were valid only 13.1% of the time.
professionCompetencyLevel: practitioner
sources:
  - arxiv/uicrit
  - arxiv/designer-feedback-ui-generation
  - nng/heuristic-evaluation
---

## Why a corpus exists at all

Asking a model to critique a screen from a rubric alone does not work. Measured against professional designers, only **13.1%** of zero-shot design comments were valid. Grounding the same task in a curated corpus of real human critiques — retrieval-augmented few-shot, with visual prompting — improved critique quality by about **55%**, still short of the human ceiling.

So the corpus is not documentation of the critique practice. **The corpus is the critique capability.** Without it there is no design critique here, only fluent guessing that costs reviewers more attention than it saves.

The second reason is leverage. A small quantity of high-quality expert feedback, distilled into a reward signal, let a small model outperform a much larger proprietary one at UI generation. The corpus is the highest-return asset in the whole UX program — higher than model choice, which is why nothing here pins a model.

## What an entry is

One entry records one judgment about one screen:

- **The image** — a screenshot at a stated viewport and colour scheme. A critique of a screen nobody can look at again is not reviewable.
- **The route** and the state that produced it (which org fixture, which data condition).
- **The critique** — what is wrong, specifically, in the vocabulary of [[professions/ux-design/information-hierarchy-and-density]]. "Feels heavy" is not an entry. "Lead band carries 240 words before the next action, and the primary action sits below three secondary ones" is.
- **The verdict** — the founder's or designer's actual call, including *no change needed*. Negative entries are as valuable as positive ones; a corpus of only-problems teaches that every screen has a problem.

## The authority contract

**Entries are founder- or designer-authored. This is a contract, not a preference.**

An agent may draft an entry, transcribe a review note, cluster near-duplicates, and *propose* a verdict. An agent may never attach one. An entry becomes calibration-eligible only when a founder or designer verdict is attached.

The reason is measured, not ceremonial: in the study behind this method, **six researchers ranking UI preference pairs showed very low agreement with expert designers.** Being a thoughtful human is not the qualification — being the design authority for this product is. If a general reviewer's sign-off could stand in, the corpus would drift toward consensus taste and the calibration reference would quietly stop meaning anything.

And the degenerate case is worse: a judge calibrated against agent-authored entries is calibrated against itself. It would report rising agreement while measuring nothing.

## Capture, in practice

1. **Capture at the moment of review.** Every founder UX review note is a corpus entry waiting to be written down. Notes not captured are gone — this is why capture starts before any critique capability exists, not after. The accrual rate of this corpus, not a calendar date, is what determines when design critique may carry weight.
2. **Re-screenshot for backfill.** Findings that predate capture are text-only, their original views ephemeral. Recover them by re-rendering the flagged surface at the recorded git state and pairing the image with the existing written finding. Before/after pairs where a fix already landed are the most useful entries in the set.
3. **Cluster, do not multiply.** Ten instances of the same wall-of-text pattern across ten routes is one lesson with ten examples. Cluster them so retrieval returns the lesson.
4. **Chase the gaps.** Entries drafted but missing a verdict are the corpus's work queue. Surfacing them for a quick founder pass is the single most useful recurring task the curation role performs.

## Where entries live, and how the contract is enforced

The corpus is **not a new store**. A critique entry is a craft-override page under `craft/ux-design/<slug>` — the same org-scoped, revisioned overlay the craft surface already serves — carrying its structured fields (route, screenshot reference, viewport, git ref, finding, lenses, verdict, verdict authority) in the page's metadata bag, exactly as the WSID variant axes already do.

That means an entry inherits revision history, org scoping, and a place in the UI without anything new being built, and it means the corpus is readable by the same tools that read the rest of the profession corpus.

**The authority contract is code, not etiquette.** An entry is calibration-eligible only when all four hold:

1. it is **published**, not a draft — a draft is a proposal whatever it contains;
2. a **verdict** is attached — "no verdict yet" is the work queue, not the content;
3. the verdict was attached by a **founder or designer** — an agent-proposed verdict never promotes itself;
4. it carries a **screenshot reference** — an unreviewable claim cannot settle a disagreement later.

The calibration set is *derived* by applying that rule, never hand-curated, so there is no path by which an agent-authored verdict reaches the judge as calibration data. Drafting and publishing are already separate steps with separate authority: an agent drafts, a human publishes.

**The held-out slice is deterministic.** The calibration gate promotes authority on measured agreement against entries the judge was never grounded in. That property is enforced by stable bucketing on the entry's identity rather than by a stored split or a random seed — so the same entry lands on the same side on every run, on every machine, and growing the corpus never silently reshuffles yesterday's held-out entry into grounding. Without that, the agreement measurement is a memory test that passes trivially.

Coverage is measured by **route breadth**, not row count: the exit condition from the curation stage is that the corpus spans the shell types actually in use.

## Anti-patterns

- **Rubric without examples.** The 13.1% configuration. Never ship it.
- **Agent-authored verdicts.** Self-calibration dressed as measurement.
- **Only-negative corpus.** Teaches that criticism is always available, which is exactly the failure mode that makes reviewers stop reading.
- **Screenshots without state.** Unreproducible, so unusable as a before/after pair later.

## See Also

- [[professions/ux-design/critique-calibration-gate]]
- [[professions/ux-design/information-hierarchy-and-density]]
- [[professions/ux-design/heuristic-evaluation-method]]
