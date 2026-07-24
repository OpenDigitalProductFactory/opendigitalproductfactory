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

### Phase 1.5 — gate instrumentation (SHIPPED 2026-07-24, this session)

The archaeology described below turned out to be a dead end: none of the three human-facing decision gates (build-studio, org-business, profession) ever persisted per-option feature vectors or a kernel recommendation — `options` was a plain `string[]` display menu, and `evaluateDecisionPerspective` scores whether-to-proceed against materials, not an argmax over scored options. Verified live via `principle_decide` kernel consult (2026-07-24, `jsi-phase1-adapter-scope-decision` + `jsi-phase1-wwwd-path-vs-work-pattern-path-decision` calling surfaces): instrumenting the gates to persist real scored options + a recommendation, reusing `decide()`/`listPrinciplesByTier` rather than the sensitive `principle_decide` retrieval path, scored clearly above a diagnostic-only adapter.

Shipped: `DecisionInteraction.scoredOptions`/`recommendedOptionId`/`chosenOptionId` (additive columns, migration `20260724160000_weight_inference_scoring_and_proposals`); `option-recommendation.ts` (commandments-only `decide()` scoring, deliberately NOT the full Qdrant/RC2/RC3/RC6 retrieval path — see its header); `build-studio-gate.ts` and `work-pattern-review.ts` (both create paths) now populate all three columns. `work-pattern-review.ts` is closed end-to-end (its `chosenOption` already string-matched an option verbatim — no UI change needed). `build-studio-gate.ts`'s escalation-capture path (`decision-perspective.ts`) still needs a form redesign to capture a structured `chosenOptionId` (see follow-up BI below) — its `recommendedOptionId` populates now, `chosenOptionId` does not yet.

**Deliberately deferred to a follow-up BI** (materially larger, higher-blast-radius): `org-business-gate.ts`/`profession-gate.ts` take open-ended, MCP-caller-supplied options with no fixed menu — closing them needs a real per-option scoring mechanism added to the shared core `evaluateDecisionPerspective` evaluator plus 2 MCP tool schema extensions, not just a features column. Also deferred: the `decision-perspective.ts`/`org-decision-capture.ts` escalation-capture form redesigns (structured option pick, currently free text) needed to close `chosenOptionId` for those paths.

### Phase 2 — the DecisionInteraction adapter (SHIPPED 2026-07-24, this session)

`weight-inference-adapter.ts`: `extractWeightInferenceObservations()` queries only rows where `scoredOptions`/`recommendedOptionId`/`chosenOptionId` are all non-null (Phase 1.5's columns), and reads `chosenVector`/`recommendedVector` straight off `scoredOptions` by id lookup — no `humanOutcome` prose parsing needed for the two instrumented paths. A row from any other capture path is excluded by the query, not misread. A row whose `recommendedOptionId`/`chosenOptionId` doesn't resolve against its own `scoredOptions` (or whose `scoredOptions` isn't well-formed) is reported in `failures` with a closed-set reason, never silently dropped or thrown — this is the "fail loud" contract the original archaeology plan called for, achieved more simply once the upstream columns exist.

### Phase 3 — proposal ledger + surfacing (SHIPPED 2026-07-24, this session)

`weight-proposal-store.ts`: `persistWeightAdjustmentProposals()` (idempotent per (profileId, domainClass, axis) while still `proposed`; never overwrites a human's ruling), `ruleWeightAdjustmentProposal()` (accept → `ruled`, the same tier name `ruledTierForProposal()` already returns; reject → this model's own terminal `rejected` state, since `stance-promotion.ts`'s ladder has no reject primitive to reuse), `listOpenWeightAdjustmentProposals()`. Surfaced on `/coworker-decisions/review` via a new `FindingClass: "weight-proposal"` in `decision-review-findings.ts` and a `WeightProposalForm` client component mirroring `GapAnswerForm`'s disclosure pattern. New Prisma model `WeightAdjustmentProposal`, no reuse of `PerspectiveMaterial` (that's the post-ruling destination for STANCE, not a pending-evidence queue for an axis weight — verified live, no generic "pending ruling" table exists anywhere in the ~523-model schema).

Explicitly NOT wired: what a `ruled` weight-adjustment proposal actually does to a live composite score. That is JSI spec Phase 4 ("founder review of the first real weight-adjustment proposals... before either is allowed to influence a live composite score") — correctly out of scope until real proposals have accumulated and been reviewed.

## Acceptance

A run over real `humanOutcome` history produces a weight-adjustment proposal, it surfaces for a ruling, and it mutates nothing until ruled; a group below the sample floor produces nothing. Phase 1 delivers the inference + floor + proposal-authority contract; Phases 1.5–3 deliver the live extraction and the ledger, for the two gates (`build-studio-gate.ts`, `work-pattern-review.ts`) instrumented this session. `org-business-gate.ts`/`profession-gate.ts` and the two escalation-capture-form redesigns remain in a follow-up BI.
