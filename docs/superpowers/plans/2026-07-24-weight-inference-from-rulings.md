# Weight Inference From Rulings

- **Date:** 2026-07-24
- **Backlog:** `BI-D88DFEEA`
- **Epic:** `EP-DECISION-TIER-REBALANCE`
- **Spec:** [`2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md`](../specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md) §2.4, §3 (step 5)

## Problem

The corpus's axis weights are authored priors. When a human systematically overrides the kernel in a consistent direction, that override history is evidence the org values some axis more (or less) than the corpus implies. §2.4 asks us to turn that evidence into a **proposal** — never a silent mutation — that enters the same confirmation ladder stance material uses and reaches authority only when a human rules on it, with a sample floor so it never learns from n=3.

## Substrate verified 2026-07-24

- `DecisionInteraction` carries `humanOutcome Json?`, `domainClass`, `profileId`, `options`, `outcomePayload`, `confidenceBefore/After`, `principleConflict` — the raw material is all there.
- `stance-promotion.ts` is the ladder to reuse: `STANCE_TIERS` (`unconfirmed 0.6 / confirmed 0.9 / ruled 1.0`), a never-downgrade `promote()`. Weight proposals extend *this*, they do not invent a second authority model.
- **The complication:** `humanOutcome` is written in at least five different shapes across the escalation (`decision-perspective.ts`), org-decision (`org-decision-capture.ts`), and work-pattern (`work-pattern-review.ts`) capture paths. Matching a human's `answer` back to a specific option's feature vector is real archaeology and differs per path.

## Sequencing note (§3)

Weight inference is **step 5** and "requires 1–4 to be meaningful — inferring weights over a rank-deficient space would learn noise." Steps 3–4 (corpus migration, profession-local axes) are still in flight. So the engine's **output** is not yet trustworthy on the live corpus. The engine **itself** is correct to build now: it is proposal-only, so it mutates nothing, and its correctness is independent of which axes exist. The sample floor and the human-ruling gate are exactly what stop a premature or noisy proposal from ever changing a decision.

## Phases

### Phase 1 — the pure inference engine (SHIPPED)

`apps/web/lib/decision-perspective/weight-inference.ts`. Takes a clean `WeightInferenceObservation` contract — the (chosen vs kernel-recommended) axis vectors for one decision in one `domainClass`/`profile` — and emits `WeightAdjustmentProposal`s. Reads nothing, writes nothing.

Guards, each pinned by test:
- **Sample floor** per `(domainClass, profile)` group (default 8) — no pooling across groups to clear it.
- **Consistent direction** — an axis is proposed only when a super-majority (default 0.7) of the decisions that *separated* on it went the same way. Agreements (separation 0) count toward the base but cannot manufacture a signal.
- **Non-trivial magnitude** — mean separation must clear a floor (default 0.1).
- **Never out-votes an authored stance on arrival** — a proposal enters at `PROPOSED_CONFIDENCE_WEIGHT` (0.3), strictly below `unconfirmed` (0.6), asserted at module load. Ruling promotes it to `ruled` (1.0) through the existing ladder.

### Phase 2 — the DecisionInteraction adapter (NOT STARTED)

Extract `WeightInferenceObservation`s from live rows. This is the archaeology: per capture path, resolve `humanOutcome.answer` to the chosen option, read that option's feature vector and the kernel-recommended option's vector from `options`/`outcomePayload`, and tag with `domainClass`/`profileId`. Needs live verification against real rows and must handle each `humanOutcome` shape explicitly (fail loud on an unrecognised shape rather than silently skipping evidence).

### Phase 3 — proposal ledger + surfacing (NOT STARTED)

Persist a proposal, surface it on the decision-review/attention surface for a ruling, and on ruling promote it through `stance-promotion` to `ruled`. Reuses the ladder; adds no new authority model.

## Acceptance

A run over real `humanOutcome` history produces a weight-adjustment proposal, it surfaces for a ruling, and it mutates nothing until ruled; a group below the sample floor produces nothing. Phase 1 delivers the inference + floor + proposal-authority contract; Phases 2–3 deliver the live extraction and the ledger.
