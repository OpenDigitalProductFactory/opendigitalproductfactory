---
title: Job-Specific Intelligence (JSI) — a fluid, evidence-bound weight layer beneath WWMD/WWWD/WSID
authoredAt: 2026-07-24
authoredBy: mark-bodman
status: draft
specKind: design
backlogItem: pending — no live DPF MCP session was available while drafting this spec (see §9); a BI/epic must be filed against live Postgres before any implementation phase starts, per `backlog-lives-in-postgresql` and `db-fallback-explicit`.
epic: pending — same reason.
relatedSpecs:
  - docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md
  - docs/superpowers/specs/2026-07-21-memory-trust-and-evidence-currency-design.md
  - docs/superpowers/specs/2026-07-21-coworker-competence-flywheel-design.md
  - docs/superpowers/specs/2026-06-09-wsid-coworker-professional-corpus-design.md
  - docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md
  - docs/superpowers/specs/2026-07-11-wwwd-stance-onboarding-design.md
  - docs/superpowers/specs/2026-07-22-wwmd-design-quality-kernel-gap-design.md
relatedPlans:
  - docs/superpowers/plans/2026-07-24-profession-local-decision-axes.md
  - docs/superpowers/plans/2026-07-11-p5-memory-corpus-promotion.md
  - docs/superpowers/plans/2026-06-28-decision-shadow-ledger-trust-state.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/decisions-belong-to-their-scope.md
  - docs/founder-kernel/wiki/principles/consult-scopes-before-asking.md
  - docs/founder-kernel/wiki/principles/learnings-belong-in-the-shared-commons.md
  - docs/founder-kernel/wiki/principles/single-source-of-truth.md
  - docs/founder-kernel/wiki/principles/schema-honesty-over-aspirational-naming.md
---

# Job-Specific Intelligence (JSI): a fluid, evidence-bound weight layer beneath WWMD/WWWD/WSID

## Summary

DPF's premise has never been "build AGI." It has been, since before the term WSID existed as
a kernel scope: give every AI coworker the specific corpus, decision axes, and judgment a
given job requires, and nothing more. This spec names that premise **Job-Specific Intelligence
(JSI)** and states it as an explicit architectural bet against the industry's dominant
AGI framing — a single, ever-larger, general model whose competence at any one job is an
emergent side effect of scale, not a designed property.

The bet is not new; the platform already substantially embodies it (§1). What this spec adds
is a precise theoretical account of *why* JSI requires something an LLM's construction and
DPF's current kernel both lack: **a weight layer that moves on the timescale the job itself
moves on, instead of one frozen at authoring time** (§Thesis). It then names the gap this
implies with the same rigor the 2026-07-23 tier-rebalance spec used — most of the machinery
already exists, mostly unwired (§2) — and proposes the minimum design to close it: not one
fluid layer, but three, each moving at a different, deliberately bounded speed (§4).

Nothing here proposes training a model per job, per organization, or per coworker. That would
just be AGI's bet rerun at smaller scale, with the same frozen-until-retrain problem. Nor does
it propose making kernel doctrine adaptive — doctrine should stay exactly as slow and
deliberate as it is today. The claim is narrower and, I think, more defensible: **exactly one
layer of the existing substrate is missing its fluidity, and the machinery to give it that
fluidity is already built, tested, and sitting uncalled.**

---

## Thesis

### T1. What an LLM's construction actually buys you, and what it costs

The pipeline referenced in this project's originating discussion (github.com/w3cj/how-llms-work)
is, reduced to its essential moves: **tokenize** (reduce reality to a fixed vocabulary of
discrete units) → **embed** (place those units in a continuous space via exposure to
co-occurrence over a large general corpus) → **learn weights via backpropagation** (adjust
millions of continuous parameters against a loss function, in large batched training runs) →
**attend** (at inference time, dynamically weigh which context matters for the next token) →
**decode** (sample an output).

Generality is bought at exactly one place in that pipeline: the backprop step, run once
(or periodically, at great expense) over a corpus general enough to cover almost everything.
Attention is the only part of the pipeline that is fluid at inference time — and it operates
*over* frozen, backprop-trained weights. Updating those weights for a specific situation is
never first-class; it is bolted on afterward as fine-tuning, RAG, or a system prompt. This is
AGI's bet: buy generality once, expensively, at training time; rent specificity cheaply, and
imperfectly, at inference time via context.

### T2. A job is not a corpus

A training corpus, however large, is a snapshot. A job is not. A job is a continuously live
relationship between a worker (human or AI) and a stream of things that keep changing under
it: which customers are being served this quarter, who the current suppliers are, which
employees hold which judgment and preference, and a stream of external conditions — season,
local events, a regulatory change, a run of bad weather on a delivery route — that never
stops moving. The "ground truth" of what a good decision looks like in this job, in this
organization, this month, is not a fact that can be baked into a corpus and then frozen. It is
itself a moving target that competent judgment must track continuously. Chasing AGI's bet at
the level of a single job — "train a smaller model, just for this role" — does not escape this
problem. It just reruns the same frozen-until-retrain failure mode at a smaller radius.

DPF's own WWMD/WWWD/WSID substrate, researched in depth ahead of this spec (evidence in §1–§2
below), does not make that mistake — it never trains a model per job. But it makes a related
one: every `principleDimensionVector` — the signed, per-axis weight that determines how
strongly a candidate option aligns with a given principle (`packages/db/src/wiki-taxonomy.ts:144`,
scored in `apps/web/lib/decision/option-scoring.ts:81-106`) — is **hand-authored once, in a PR,
and frozen until a human deliberately re-authors it.** This is *more* auditable than a neural
net's weights (every number has a name and a rationale, per the `principleWeightRationale`
convention already in use), but it is exactly as static in the one property that matters for a
job that keeps moving: neither a gradient step nor a PR happens on the timescale the job's own
drift happens on.

### T3. The three timescales a job-specific weight layer needs

The fix is not "make all the weights fluid" — that would trade away the auditability that is
this platform's actual advantage over a black-box model, for a fluidity an ungoverned neural
net already has and DPF explicitly does not want (per `decisions-belong-to-their-scope` and
the whole discipline in `docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md`).
The fix is recognizing that a competently-done job is being scored against **three genuinely
different timescales of truth**, and today only the slowest of the three has a working
mechanism:

| Timescale | What moves on it | Today's mechanism | Status |
|---|---|---|---|
| **Slow / doctrinal** | Kernel commandments, cross-fleet-comparable axes — things that should change rarely and only by deliberate human ratification | PR + founder ratification of `principleDimensionVector` | **Working, correctly slow — not a target of this spec** |
| **Medium / revealed-preference** | What this org's or this coworker's accumulated rulings reveal about how they actually weigh a tradeoff, once enough evidence exists to say so with confidence | `apps/web/lib/decision-perspective/weight-inference.ts` (BI-D88DFEEA) — sample-floor-gated, consistency-gated, never auto-applied | **Built and unit-tested. Zero callers anywhere in the codebase (verified by direct grep of `apps/web`).** |
| **Fast / contextual-situational** | The immediate situation — this week's calendar, this customer's stated urgency, a live external signal like weather or a local event, once *validated* to actually correlate with outcome | None. Named explicitly in the tier-rebalance spec as the "predictive/signal vector class" and deferred as "the largest, least-constrained piece." | **Absent. No scoring dimension, evaluator input, or data-model field exists anywhere in the decision substrate.** |

This table is the spine of the rest of this spec. Each row below is expanded with the concrete
evidence behind its status claim (§1–§2), then a minimum design to close the gap in the two
rows that aren't working (§4), sized deliberately small and sequenced behind the rebalancing
work the platform's own architects already flagged as a prerequisite.

### T4. Why "JSI" is the right name for the bet, not a rebrand of WSID

WSID (the profession-scope decision layer) is the closest existing piece to a JSI
implementation, but JSI is the broader claim: that a coworker's competence at its job should
be a **designed, measured, continuously-recalibrated property**, not an emergent side effect
of a bigger foundation model, and not a one-time hand-authored ruleset either. WSID supplies
the corpus and the slow-timescale axes. The coworker certification lifecycle (`AGENTS.md`
"Coworker lifecycle contract": `draft → defined → certified → active`, gated by a nightly
golden-journey sweep of evidence-based oracles) supplies a measurement harness. What's missing
is the medium and fast timescales — the part of "job-specific intelligence" that actually
means *specific*, as opposed to merely *scoped*.

---

## 1. Where DPF already embodies JSI — grounded in existing platform work

Per `consult-specs-first` and `verify-substrate-before-proposing-new`, this section names what
already exists rather than treating any of it as a gap.

- **Scope separation with a non-inherit boundary.** `DecisionPerspectiveProfile.kind` ∈
  `platform | organization | profession`, one substrate, three non-inheriting scopes, codified
  in the kernel principle `decisions-belong-to-their-scope.md`. This is the correct shape for
  "job-specific" — a job's competence is never allowed to borrow another scope's authority by
  default.
- **A real confirmation ladder for revealed preference at the material level.**
  `apps/web/lib/decision-perspective/stance-promotion.ts`: `unconfirmed` (archetype default,
  evidenceGrade B, confidenceWeight 0.6, effective weight 0.45) → `confirmed` (owner explicitly
  ruled, A/0.9) → `ruled` (a human ruled on a real escalated decision in this class, A/1.0,
  never downgrades). This is genuine revealed-preference capture — but at the level of a
  *piece of material*, not an *axis weight* in the scoring formula. It is the correct pattern;
  §4.2 proposes extending the same pattern one level down.
- **A profession corpus that is deliberately family-scoped, never per-instance.**
  `docs/superpowers/specs/2026-06-09-wsid-coworker-professional-corpus-design.md` §2/§9 states
  as an explicit non-goal: "Per-individual coworker *instance* profiles... WSID is per role
  family, not per agent id." Every coworker holding a profession (`build-data-architect`,
  `data-architect`, `data-steward`, all → `data-architect`) is served identical corpus and
  identical variant filtering. This is a deliberate anti-AGI, anti-snowflake design decision
  already made — JSI does not mean "one model per employee" any more than it means "one model
  for everyone."
- **A measurement harness for competence, not just a knowledge base.** The coworker lifecycle
  contract (`AGENTS.md` §"Coworker lifecycle contract (mandatory for new AI coworkers)"):
  `draft → defined → certified → active`, where certification is earned by "the nightly
  golden-journey sweep... exercises every roster coworker through the real execution path with
  evidence-based oracles." Separately, `apps/web/lib/decision/golden-decisions.ts` +
  `decision-drift.ts` re-score a founder-curated `GOLDEN_SCENARIOS` panel against the live
  corpus on every load, flagging `"flip"` (winner changed) or `"thin-margin"` drift — a
  regression harness for judgment quality, not just for code.
- **A declared boundary on how far personalization is allowed to fragment the fleet.** Per the
  2026-07-23 spec §2.3: "An organization may not declare new axes. It re-weights the spine...
  Without this rule the space fragments per-install and nothing is comparable across the
  fleet." This is already, functionally, a federated-learning-style constraint: a frozen shared
  feature space (the spine + profession-local axes), with per-tenant re-weighting the only
  degree of freedom. §4 below takes this as a hard constraint, not something to loosen.
- **Vector retrieval is correctly treated as general-purpose, reusable infrastructure.**
  Semantic embedding (`ai/nomic-embed-text-v1.5`, 768-dim, native pgvector as of the completed
  Qdrant migration, `packages/db/src/qdrant.ts` now a re-export of `pgvector-store.ts` per
  BI-2A3BE4D7) answers "which pages/principles are relevant" and is shared across every job.
  This is exactly the right thing to keep general — nothing in this spec touches it.

## 2. The gap, precisely

The tier-rebalance spec already diagnosed most of this; this section restates it against the
three-timescale frame in T3 and adds the WSID-specific evidence the earlier spec didn't cover.

**Medium timescale — built, unwired.** `weight-inference.ts`'s `inferWeightProposals` takes
`WeightInferenceObservation[]` (paired `chosenVector`/`recommendedVector` axis scores per real
past decision), requires `minSampleSize: 8`, `minConsistency: 0.7`, `minMeanSeparation: 0.1`,
and emits a `WeightAdjustmentProposal` that enters the stance ladder at
`entersAtConfidenceWeight: 0.3` — deliberately below even `unconfirmed` (0.6), enforced by a
runtime assertion, so an un-ruled inference can never outweigh authored doctrine. Grepping
`apps/web` confirms: **this module and its observation type are referenced nowhere outside
their own file and test.** There is no adapter extracting observations from real
`DecisionInteraction`/`humanOutcome` rows, no persistence of a proposal, no surfaced review
queue entry, and no caller. The engine is the medium-timescale mechanism T3 calls for. It does
not run.

**Fast timescale — not designed at all, in either WWMD or WSID.** Confirmed by direct
inspection: no scoring dimension, evaluator input, or `DecisionDomainClass` value carries any
notion of time-of-day, season, weather, or local event. The one textual trace found across the
whole corpus is decorative prose in one archetype's seeded stance content ("keeping high-demand
items available through peak season") — read by a human, never scored. The 2026-07-23 spec
names this class and calls it explicitly out of scope, "the largest and least-constrained
piece," deferred to its own epic. WSID inherits the same absence: `PROFESSION_COMPETENCY_LEVELS`
and jurisdiction/archetype variants are wired into retrieval eligibility, but nothing in the
profession-corpus path takes a live situational signal as an input at decision time.

**The sequencing risk is real and already correctly named — this spec does not relitigate it.**
The tier-rebalance spec's own numbers: effective dimension rank ≈ 6 of 20 (most principles load
the same handful of axes), and ~41% of the 95 kernel principles authored by one specialist
persona. Its own conclusion — "inferring weights over a rank-deficient space would learn
noise" — is taken as a hard precondition here too (§6).

**The competence-flywheel spec independently confirms the same shape from the coworker side.**
Its Judgment pillar: `DecisionInteraction` records rich per-consult evidence, and
`DecisionShadowLedger`/`TrustState` exist with `proposed`/`actual`/`agreement` fields for
calibration — but "nothing links a decision to its eventual real-world result, so nothing can
learn from being wrong." Its own proposed fix (BI-A834EE61, infer outcome verdicts from
downstream signals like a reverted PR or a re-opened ticket, surface for confirmation) is the
same shape as the medium-timescale fix this spec proposes, aimed at a different feeder signal —
this spec treats them as the same missing edge with two candidate sources, not two separate
problems (§4.2).

## 3. Research & Benchmarking

Per `design-research-required`, comparing systems that solve the general problem this spec
targets — adapting an operational weight from live evidence, under a bounded, auditable update
rule, without full retraining.

**Open-source:**

1. **Vowpal Wabbit / contextual bandits (LinUCB, Thompson sampling).** The standard open-source
   formalism for "adjust a weight vector online from bounded reward signal, with an explicit
   confidence bound alongside the point estimate, without gradient backprop over a full model."
   *Adopt:* pairing every inferred weight with an explicit confidence/sample-count, exactly as
   `weight-inference.ts` already does with `minSampleSize`/`consistency` — this validates that
   the engine's existing gating is the right shape, not just a safety add-on. *Reject:* bandit
   algorithms optimize one scalar reward per arm; DPF's decisions are multi-axis and
   multi-principle by design, and collapsing that to a single reward would erase the
   interpretability (`per-principle contribution ledger`) that is this platform's actual
   differentiator.
2. **River / scikit-multiflow (streaming ML — ADWIN, DDM concept-drift detectors).** Purpose-
   built for detecting when a live distribution has drifted enough that a stale model needs
   re-estimating, using a windowed statistical comparison rather than a fixed schedule.
   *Adopt:* the drift-detection *trigger logic* — the medium-timescale layer in §4.2 should
   re-evaluate when accumulated disagreement crosses a significance threshold, not merely on a
   cron, mirroring how `detectStaleClaims` already triggers on an age threshold for corpus
   pages. *Reject:* the underlying models these libraries adapt are themselves opaque; DPF
   should keep the interpretable weighted-dot-product formalism it already has and apply only
   the *drift-detection statistic*, not the model family.
3. **Open Policy Agent (Rego).** Cited as a contrast, not a pattern to adopt: OPA represents the
   slow/doctrinal end of the spectrum done well — versioned, human-authored, deliberately
   inert between deploys. It is useful evidence that DPF's *existing* commandment-tier
   mechanism is already the right design for that one timescale, and this spec does not
   propose changing it (§4.1, §6).

**Commercial:**

1. **Netflix/Spotify-style recommendation platforms.** Blend stable, hand-curated content
   features with continuously-updated collaborative-filtering signal, as two distinct model
   components combined at serving time rather than merged into one representation. *Adopt:*
   the hybrid-blend architecture — this is structurally identical to what §4 proposes: a
   frozen doctrinal vector blended with a continuously re-estimated revealed-preference
   adjustment, never merged into a single opaque number before the point of use.
2. **Fraud-detection platforms (e.g., Stripe Radar).** Explicit signal half-life / confidence
   decay on risk signals, a human-reviewable rule layer that stays inspectable while a
   statistical layer adapts underneath, and analyst override/pinning of specific rules.
   *Adopt:* signal decay applied even to *high-confidence* signals — this is precisely the fix
   the memory-trust spec already proposed and this platform has not shipped (grade-A materials
   are today permanently exempt from staleness decay, `docs/superpowers/specs/2026-07-21-memory-trust-and-evidence-currency-design.md`
   §3–4); Radar's practice of decaying even trusted signals is independent, external validation
   that this is a real gap, not a hypothetical one.
3. **Enterprise adaptive-decisioning platforms (e.g., Pega Customer Decision Hub).** Hand-
   authored business rules sit alongside a continuously-adapting per-customer propensity model,
   arbitrated by a governance layer requiring human sign-off before an adaptive recommendation
   becomes an action. *Adopt:* the three-part shape — rules, adaptive layer, governance
   arbitration — is close to isomorphic with this spec's three timescales plus the existing
   stance-promotion ladder as the arbitration gate. *Reject:* Pega's adaptive layer is a
   largely opaque propensity classifier; DPF should keep its signed, per-axis, human-legible
   vector formalism for the medium layer rather than adopt a black-box scorer.

**Gap this design fills that none of the above solve wholesale:** none of these systems
combine (a) a fully human-legible, per-axis contribution ledger, (b) a three-scope
non-inheriting authority model (WWMD/WWWD/WSID), and (c) a bounded, never-auto-mutating
promotion ladder from inferred signal to ratified doctrine, in one substrate. The design below
is a synthesis of patterns proven independently elsewhere, applied to a substrate that already
has the auditability piece right.

## 4. Proposed design — the three-layer weight architecture

### 4.1 Slow / doctrinal — unchanged, intentionally

Kernel commandments and the spine/profession-local axis registry stay exactly as they are:
hand-authored, PR-reviewed, founder-ratified, changing rarely. This spec's thesis is precise
about *which* layer needs fluidity — making doctrine adaptive would sacrifice the property
that makes it doctrine. No change proposed here.

### 4.2 Medium / revealed-preference — build the missing adapter, not a new engine

The highest-leverage single piece of work this spec identifies:

1. **An ETL adapter from real decision history to `WeightInferenceObservation[]`.** Read
   `DecisionInteraction` rows where `humanOutcome` is populated (currently read in exactly one
   direction — "is it null" — per the tier-rebalance spec's own finding); normalize the ≥5
   distinct shapes `humanOutcome` is written in today (escalation capture, org-decision
   capture, work-pattern capture, profession-gate defer, backlog-triage) into the engine's
   clean `{chosenVector, recommendedVector}` contract. This is real, non-trivial mapping work —
   explicitly named as out of scope by `weight-inference.ts`'s own header comment — and is the
   one piece this spec adds beyond what's already built.
2. **Persist and surface proposals in the existing review queue**, not a new UI. WWWD gap-
   answering already has a working pattern (`/coworker-decisions/review`, "Answer this once →")
   for exactly this shape of ask: a system-generated candidate that a human either confirms
   (promotes it up the same `unconfirmed → confirmed → ruled` ladder `stance-promotion.ts`
   already implements) or rejects. Reuse it; do not build a second review surface.
3. **Gate re-evaluation on drift, not just accumulation.** Borrowing the concept-drift
   discipline from §3: recompute a proposal set when *new* disagreement accumulates past the
   existing sample/consistency floors, not on a fixed schedule — this keeps the mechanism
   quiet when a job is stable and responsive when it isn't.
4. **This closes the same gap the competence-flywheel spec named independently** (its Judgment
   pillar: "nothing links a decision to its eventual real-world result"). One adapter, two
   consumers: weight-inference proposals for WWWD/WSID material, and outcome-verdict inference
   for the flywheel's calibration fields. Build the extraction logic once.

### 4.3 Fast / contextual-situational — a narrowly-scoped pilot, not a general framework

The tier-rebalance spec is right to defer a general "external signal" framework — it is
genuinely the least-constrained piece, and a general subscription mechanism invites exactly the
kind of spurious-correlation risk `never-fabricate` and `schema-honesty-over-aspirational-naming`
exist to prevent. This spec proposes the minimum viable version of that class instead of a
framework:

1. **One pilot correlate, one archetype, chosen for a job where seasonality is already
   acknowledged in prose** (the existing rental-archetype "peak season" stance content is a
   ready-made candidate — it is already *believed* true by whoever wrote it; this pilot asks
   whether it is *measurably* true).
2. **A candidate signal starts as unscored evidence, never a vector.** It is logged alongside
   the decisions it might explain, exactly like a `PerspectiveMaterial` candidate starts as
   `draft` — visible, inert, not yet influencing any composite score.
3. **Promotion to a scored input requires the same discipline §4.2 applies to weight
   proposals**: a minimum sample size, a minimum correlation with actual recorded outcome (not
   with the decision recommendation — with what actually happened), and a human ratifying the
   correlation before it is allowed to modulate a decision. This is deliberately a higher bar
   than the medium-timescale layer, because an external signal has no author vouching for it
   the way a hand-written principle does.
4. **Once validated, it modulates the decision at inference time only — it is never persisted
   as a stored weight.** This is the "attention," not "backprop," half of the LLM analogy in
   T1: a validated situational signal should shift *this decision*, computed fresh, not rewrite
   a stored parameter that then quietly outlives the situation that justified it.

## 5. Non-goals

- **Training a model per job, per organization, or per coworker.** Rejected explicitly in T2 —
  this is AGI's bet rerun at smaller scale, with the same frozen-until-retrain failure mode.
- **Making kernel commandments or the spine registry adaptive.** The slow layer is correctly
  slow; nothing here proposes changing §4.1.
- **A general "subscribe to any external source" framework.** §4.3 proposes one validated
  pilot, not a subscription platform. Building the general case before one instance has proven
  the validation discipline works would repeat the exact mistake the tier-rebalance spec warned
  against for weight-inference itself.
- **Merging retrieval embeddings and scoring dimension-vectors into one representation.** These
  remain architecturally distinct mechanisms (semantic relevance vs. axis alignment); nothing
  here proposes collapsing them.
- **Per-coworker-instance learning inside WSID.** Reaffirmed from the 2026-06-09 spec's own
  non-goal; individual-coworker adaptation continues to live in the separate, smaller
  `CoworkerMemoryNote`/agent-memory substrate, not in the profession-scoped corpus.

## 6. Sequencing

This spec does not reorder the tier-rebalance spec's own sequencing; it slots into it.

| Phase | Work | Depends on |
|---|---|---|
| 0 | Tier-rebalance spec's own steps 1–4 (embedding-provider fix, spine classification, corpus migration, profession-local axis authoring) | already sequenced, this spec inherits it |
| 1 | §4.2 ETL adapter from `DecisionInteraction`/`humanOutcome` → `WeightInferenceObservation` | Phase 0 (inferring over a rank-deficient, imbalanced space "would learn noise" — the earlier spec's phrase, not loosened here) |
| 2 | §4.2 proposal persistence + review-queue surfacing, reusing the WWWD gap-answer UI | Phase 1 |
| 3 | §4.3 one pilot correlate, one archetype, validation-before-scoring discipline | independent of 1–2; can run in parallel once an archetype and metric are chosen |
| 4 | Founder review of the first real weight-adjustment proposals and the first validated situational correlate, before either is allowed to influence a live composite score | Phases 2 and 3 |

## 7. Risks

- **Learning fatigue, not preference** (named identically in the tier-rebalance spec): the
  medium layer risks learning a human's inconsistency or exhaustion rather than a real
  preference. Mitigated by the existing sample-floor/consistency-floor/human-ruling gates in
  `weight-inference.ts` — this spec adds no new mitigation beyond wiring the existing one.
- **Spurious correlation in the fast layer.** An external signal correlating with past outcomes
  by coincidence, then treated as causal. Mitigated by requiring correlation with *actual
  recorded outcome*, a minimum sample size, and mandatory human ratification before any
  situational signal is allowed to modulate a score — never automatic promotion.
- **Discriminatory or sensitive correlates.** A situational signal could proxy for a protected
  or sensitive attribute. The human-ratification gate in §4.3 is the checkpoint; this spec
  does not attempt to enumerate every disallowed correlate and instead requires the same
  founder-review step every kernel-adjacent change already requires.
- **Review-queue overload.** If Phase 2 surfaces proposals faster than a human can rule on
  them, the queue itself becomes the bottleneck. The drift-triggered (not cron-triggered)
  re-evaluation in §4.2 is the intended throttle; if it proves insufficient, that is a finding
  for the implementing phase, not something to solve speculatively here.

## 8. Acceptance criteria

1. This spec merged via DCO-signed PR, with a live BI/epic filed against Postgres before
   Phase 1 implementation begins (§9).
2. Phase 0 (tier-rebalance prerequisites) verified complete before Phase 1 work starts — cite
   the rebalance spec's own acceptance criteria, not a duplicate check here.
3. Phase 1: the ETL adapter is demonstrated against real `DecisionInteraction`/`humanOutcome`
   rows on a live install, producing at least one `WeightInferenceObservation` set that meets
   the engine's existing sample/consistency floors.
4. Phase 2: at least one weight-adjustment proposal is surfaced in the existing review queue
   and either ruled or explicitly deferred by a human — never auto-applied.
5. Phase 3: one pilot situational correlate is logged as unscored candidate evidence against
   real decisions in one archetype, with its correlation-to-outcome measured before any
   proposal to promote it to a scored input.
6. No change in this spec touches `principleDimensionVector` authoring, commandment tiering, or
   the retrieval embedding path — verified by diff review at each phase.

## 9. Open questions for founder ratification

1. **Which feeder should Phase 1 target first** — the WWWD/WSID stance ladder (§4.2) or the
   competence-flywheel's outcome-verdict calibration (§2, BI-A834EE61)? This spec treats them
   as the same missing adapter with two consumers; the founder may prefer sequencing one before
   the other.
2. **Which archetype and correlate for the Phase 3 pilot.** The rental-archetype seasonality
   candidate named in §4.3 is a proposal, not a decision.
3. **Backlog/epic homes.** No live DPF MCP session was available while drafting this spec
   (`db-fallback-explicit`) — this needs a BI under an existing epic (EP-WWMD-MCP and
   EP-CORPUS-BOOTSTRAP are the two closest candidates surfaced by prior research) or a new one,
   filed against live Postgres before Phase 1 begins.
4. **Whether `schema-honesty-over-aspirational-naming` requires renaming anything in §4.3
   before it ships** — a "situational modifier" that is not yet validated should probably not
   be called a signal or a vector anywhere in its own code, to avoid the exact naming trap the
   2026-07-22 design-quality spec found and fixed once already.

---

## Appendix: terms used in this spec

- **JSI (Job-Specific Intelligence):** the architectural bet that a coworker's competence at
  its job should be a designed, measured, continuously-recalibrated property — as opposed to
  AGI's bet that competence at any one job is an emergent side effect of general-purpose scale.
- **Slow / medium / fast timescale:** the three rates of change T3 identifies in what "correct"
  means for a given decision — doctrine (rare, deliberate), revealed preference (accumulates
  over many decisions), situation (changes decision to decision).
- **Vector (retrieval sense):** a semantic embedding used to rank relevance. General-purpose,
  shared across every job scope. Unchanged by this spec.
- **Vector (scoring sense) / dimension vector:** a hand-authored signed weight over the
  `PRINCIPLE_DIMENSIONS` registry, used in the structured dot-product alignment computation.
  The slow layer in this spec's frame.
