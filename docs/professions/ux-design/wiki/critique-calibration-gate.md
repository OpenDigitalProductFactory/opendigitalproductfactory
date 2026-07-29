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

## When WSID decisions carry dimension vectors

WSID craft decisions are weighed through `evaluate_profession_decision`, which grounds a technique call in the profession's recorded corpus rather than in unaided judgment. As that path gains **dimension vectors** — the same machinery that lets kernel principles be scored rather than merely quoted — two things change here, and one must not.

**What improves.** The per-critique call ("is this finding worth raising, and which lens dominates when hierarchy and density disagree?") stops being a prose judgment and becomes a scored one with a recorded contribution ledger. That is a real gain: it makes the *reasoning* auditable, not just the verdict, and it lets disagreement between lenses be resolved by weighting rather than by whoever writes the most confident sentence.

**What also improves.** The stage promotions above become recordable as scored decisions with their evidence attached, instead of a founder's call remembered in a commit message.

**What must not change.** A scorable decision path is not a substitute for the corpus authority contract. Specifically:

- **The critic may not score its own promotion.** Running the promotion decision through the scored path with the critic as the caller is self-certification wearing a ledger. The promotion decision is the founder's, recorded; the machinery makes it auditable, not automatic.
- **Vectors weigh options; they do not establish thresholds.** The agreement threshold that governs promotion is a founder-set number stated in advance. A scoring system can tell you which option wins given weights — it cannot tell you that 0.7 agreement is good enough, because that is a risk-appetite question, not a trade-off.
- **Corpus entries still need an attached human verdict.** A vector-scored proposal is still a proposal. Nothing about better decision machinery makes an agent-authored verdict calibration-eligible.

The short version: vectors make this gate's *reasoning* legible and its *promotions* auditable. They do not move where the authority sits.

**Profession-local axes are deliberately not declared yet.** The vector design lets a profession declare its own axes — typed `benefit`/`cost`, each projecting onto at least one spine axis so the decision still rolls up when it leaves the profession, and each carrying a cited source. UX design is the design's own worked example: `hierarchy_flatness` — cost-framed, scoring the deficit — projecting onto `human_cognitive_load`, a cost spine axis. An axis's kind must match its projection targets' polarity (BI-72E8FF05); a benefit-framed axis on a cost target would score backwards.

The obvious candidates here are already named by the craft pages — hierarchy clarity, content density, disclosure quality, and perceptual coherence (the deterministic family), each of which would project onto cognitive load and, for the last, onto aesthetic judgment.

They stay undeclared on purpose. Local axes are **step 4** of a sequence whose first three steps are fixing structural scoring, settling which axes are spine, and migrating the corpus down-tier — and the sequencing is load-bearing, because axes projected onto a spine that is about to change would have to be re-projected and every decision scored against them re-scored. Declaring early would buy nothing and cost exactly the rework the sequence exists to prevent. This page records the candidates so the work is not rediscovered; the declaration waits for the spine.

## Scope boundary

This gate governs **compositional** critique: is this screen well designed, judged before anyone uses it. It does not govern **behavioural** findings — where real users actually struggled, drawn from usage telemetry. That is a different question with a different evidence base, a different coworker, and its own governance. When a finding is behavioural, hand it over rather than speculating about users that were never observed.

## See Also

- [[professions/ux-design/design-critique-corpus-method]]
- [[professions/ux-design/information-hierarchy-and-density]]
- [[professions/ux-design/heuristic-evaluation-method]]
