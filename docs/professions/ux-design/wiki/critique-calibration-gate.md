---
title: Critique calibration gate
pageKind: decision
status: published
abstract: The WSID rule for how much weight a design critique may carry. Authority is earned in three stages — curate, advise, gate — and each promotion requires measured agreement against a held-out slice of the founder corpus, not elapsed time or reviewer confidence.
professionCompetencyLevel: expert
sources:
  - arxiv/uicrit
  - arxiv/designer-feedback-ui-generation
  - acm/computation-of-interface-aesthetics
---

## The decision this page settles

When a design critique is produced — by a coworker, a build agent, or a CI judge — **how much weight should it carry?** The answers range from "record it and say nothing" to "fail the build."

Getting this wrong is expensive in both directions. Too much authority too early and the critique blocks merges on invalid findings; people learn to route around the UX signal, and the gate is disabled within weeks. Too little authority forever and the critique is decoration — the warn-never-block failure this program exists to end.

## The rule: authority is a measured promotion, in three stages

### Stage 1 — Curate (no authority)

The default and the starting point. The critic captures, transcribes, clusters, de-duplicates and chases missing verdicts. It may propose verdicts; it may not attach them. It produces no merge-visible output and cannot file work, advance a build, or block anything.

**Why start here:** a critic without a corpus *is* the zero-shot judge measured at 13.1% comment validity. Giving that configuration any authority produces confident, mostly-invalid design comments — which is worse than silence, because reviewers act on them before they learn to ignore them.

**Exit condition:** enough verdict-attached entries to support retrieval-augmented grounding, with coverage across the shell types actually in use — not merely a row count.

### Stage 2 — Advise (visible, non-blocking)

Critique attaches to the PR as evidence. Humans read it and decide. Nothing fails on it.

This stage exists to generate the disagreement data that Stage 3 needs: every time a human overrules the critique, that is a calibration datapoint, and it should flow back into the corpus.

**Exit condition:** **measured agreement against a held-out slice of the founder corpus**, reported as pairwise accuracy or an inter-rater coefficient, clearing a threshold stated *in advance*. Held-out means those entries were never used for grounding — otherwise the measurement is a memory test.

### Stage 3 — Gate (blocking)

Critique can fail a check. Reached only by passing Stage 2's measurement, with the founder's promotion decision recorded.

Even here the gate blocks on **regression**, not on absolute taste: a screen may not get measurably worse than its own baseline. Absolute quality thresholds stay advisory longer, because they are the ones a calibration argument can legitimately be had about.

## What the criterion may not be

- **Not elapsed time.** "It has been advising for a quarter" measures patience.
- **Not volume.** A large corpus of unverdicted entries is a backlog, not calibration.
- **Not agreement with general reviewers.** Six researchers ranking UI preference pairs showed very low agreement with expert designers. Measuring against non-expert consensus would certify a critic that has learned the wrong taste — and would look like success while doing it.
- **Not the critic's own confidence.** Self-reported certainty is uncorrelated with the validity problem this gate exists to manage.

## What may skip the ladder

Deterministic measurement does not need this gate, and conflating the two would slow down the parts that already work.

**Same input → same output** measures — word and control budgets, accessibility-tree structure, token adherence, and the validated perceptual metrics (clutter, grid quality, white space, figure-ground contrast) — can ratchet against a frozen baseline from day one. They carry no model variance to calibrate, and the perceptual family is validated against human ratings, explaining up to 49% of variance in aesthetic judgment.

The ladder governs **judgment**, not measurement. A useful test when in doubt: *would two runs on identical input give the same answer?* If yes, ratchet it now. If no, it climbs the stages.

## Scope boundary

This gate governs **compositional** critique: is this screen well designed, judged before anyone uses it. It does not govern **behavioural** findings — where real users actually struggled, drawn from usage telemetry. That is a different question with a different evidence base, a different coworker, and its own governance. When a finding is behavioural, hand it over rather than speculating about users that were never observed.

## See Also

- [[professions/ux-design/design-critique-corpus-method]]
- [[professions/ux-design/information-hierarchy-and-density]]
- [[professions/ux-design/heuristic-evaluation-method]]
