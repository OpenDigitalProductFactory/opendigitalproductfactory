---
title: Vector Decisioning and Job-Specific Intelligence (JSI) — Mathematical Foundations
description: The real formalism behind DPF's decision substrate — structured alignment scoring, spine/profession-local axis projection, evidence discounting, and the three-timescale weight-fluidity model — with external prior art, positioned against the Trusted AI Kernel (TAK) and the Golden Triangle.
---

# Vector Decisioning and Job-Specific Intelligence (JSI): Mathematical Foundations

## Abstract

DPF makes AI coworker judgment auditable by scoring every option a coworker considers against a
fixed, named registry of decision dimensions, using signed weight vectors that are either
hand-authored (doctrine), statistically inferred from revealed choices (experience), or — in one
narrowly-scoped pilot — learned from a validated external signal (situation). This document
states the actual mathematics of that system as implemented, corrects an external write-up that
attributed a different (unimplemented) formalism to DPF, and grounds each real mechanism in its
closest external prior art so the design can be evaluated against the literature rather than
taken on faith.

This document does not introduce new mechanism. Every formula, threshold, and data shape below is
quoted or derived from code and specs that already exist and are cited inline. Its contribution is
synthesis: pulling the mathematical core out of four scattered specs into one academically
referenced account, and drawing the line — precisely — between what DPF has built and what a
future design could still add.

## 0. Relationship to TAK, JSI, and the Golden Triangle

Three DPF standards answer three different questions about the same governed action, and are
designed to compose, not overlap:

| Standard | Question it answers | Governs |
|---|---|---|
| **TAK** (`docs/architecture/trusted-ai-kernel.md`) | *May this agent act, under what authority, with what evidence trail?* | Runtime harness: authentication, tool-execution gating, HITL escalation, provider budgeting, audit/non-repudiation. |
| **Vector decisioning / JSI** (this document) | *What should this decision weigh, how much, and how confidently?* | The epistemic content of a judgment: which factors matter, at what strength, under whose authority, with what evidence backing it. |
| **Golden Triangle** (`docs/design/golden-triangle-design.md`) | *How hard should the system work to get this right, and how fast/cheap?* | Preference-to-policy compilation: model tier, effort, review depth, verification depth, retry posture — the resourcing envelope around the decision, not its content. |

TAK's own abstract states the boundary precisely: TAK "defines what a trustworthy agent harness
and runtime MUST, SHOULD, and MAY do once an identified agent is allowed to operate" — it is
concerned with *runtime governance and harness consistency*, not with the mathematics of what a
correct decision looks like. TAK's HITL and escalation controls (§7) are the **enforcement**
mechanism; this document's scoring engine is what **populates** the judgment that enforcement
gates on. A coworker blocked by a TAK tool-grant gate and a coworker whose recommendation crosses
an autonomy-policy confidence threshold in `evaluateDecisionPerspective` are stopped by two
different, complementary layers — one asks "is this agent allowed to do this," the other asks "is
this decision well-supported enough to act on without a human."

The Golden Triangle is deliberately orthogonal to both: it compiles a human's stated posture
("get this right" / "I need this now" / "keep this cheap") into routing and orchestration
parameters, and explicitly is not a second scoring engine — see its own Decision 4: it *feeds*
`inferContract()`, and its own Terms table draws a hard line between "assurance posture" (what the
system intends) and "realized quality" (what the vector-decisioning and verification layers
actually measure happened).

## 1. Authority scopes: WWMD / WWWD / WSID / per-decision override

DPF partitions decision authority into four non-inheriting scopes (`docs/design/golden-triangle-design.md`
§5; `decisions-belong-to-their-scope` kernel principle):

| Scope | User-facing framing | Governing source | Default role |
|---|---|---|---|
| **WWMD** — "What would Mark do?" | Platform/founder doctrine | Founder-kernel wiki, ratified commandments | Platform/Build-Studio decisions; **advisory-only** for any customer business decision |
| **WWWD** — "What would we do?" | This organization's policy | `DecisionPerspectiveProfile{kind:"organization"}`, org stance material | Customer/org default |
| **WSID** — "What should a competent professional do?" | Craft-level judgment | Profession corpus (`docs/professions/registry.json`, 23 families, 170 corpus pages as of 2026-06-16, BI-48B3CEC4) | Craft floor for specialist coworkers |
| **Per-decision override** — "What do I need here?" | This one decision | User choice, bounded by policy | Local override within hard limits |

Precedence is strict subsidiarity: the most-local scope that *owns* the decision applies; a
non-owning scope is advisory only and never substitutes as authority. A customer business decision
is never defaulted from WWMD even when WWWD is silent — the gate defers to a human rather than
borrow a neighboring scope's doctrine.

**External grounding.** This is a direct software application of the **subsidiarity principle** —
the norm that a matter should be handled by the smallest, most local competent authority, and a
higher authority should support rather than supplant it. Subsidiarity has two well-documented
formal lineages DPF's own founder-kernel material already cites
(`docs/founder-kernel/raw-sources/frameworks/subsidiarity.md`): Catholic social teaching's
articulation in *Quadragesimo Anno* (Pius XI, 1931), and its codification in public administration
via Article 5(3) of the Treaty on European Union — the modern reference point for subsidiarity as
a governance-design constraint rather than a moral one. DPF's contribution is applying the same
non-inherit rule to *software authority scopes* rather than governmental ones.

## 2. The structured alignment engine

### 2.1 The dimension registry

`PRINCIPLE_DIMENSIONS` (`packages/db/src/wiki-taxonomy.ts`) is a closed, compile-time-enforced set
of ~20 named axes — e.g. `blast_radius`, `reversibility`, `data_privacy`, `long_term_maintainability`,
`governance_compliance`, `evidence_density`, `speed_to_value`, `cost_efficiency`,
`human_cognitive_load`, `operator_effort`. Every kernel principle, org-policy item, and
profession-corpus page that participates in structured scoring declares a **signed
`principleDimensionVector`** — a hand-authored weight per axis it cares about, with a written
rationale (`principleWeightRationale`).

`PRINCIPLE_DIMENSION_SCOPE` (`docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md`
§2.1) splits this registry into a **spine** (axes that trade off across every profession — kept
small, kept commensurable) and **profession-local** axes (declared inside one profession's corpus,
richer resolution, mandatory `projectsOnto` rule mapping every local axis onto ≥1 spine axis). This
is the direct, measured answer to over-generalization: a UX judgment about typographic hierarchy is
scored at full resolution *inside* the design profession, then rolls up onto the shared
`human_cognitive_load` spine axis when it needs to be weighed against a security or cost concern
from a different craft. Profession-local axes proliferate where the criteria actually live,
without inflating the one space every decision reasons over.

### 2.2 The scoring formula

For an option `o` with numeric features `f_d` and a principle `p` with signed weights `v_d` over
the same dimension set `D`, `computeStructuredAlignment` (`apps/web/lib/decision/option-scoring.ts`)
computes:

```
alignment(o, p) = ( Σ_{d ∈ D} f_d · v_d ) / ( Σ_{d ∈ D} |v_d| )
```

This is a **normalized weighted sum** — the option's features projected onto the principle's
signed weight vector, divided by the L1 norm of that weight vector so the result is bounded and
comparable across principles with different numbers of active dimensions. A composite score per
option is then the evidence-weighted combination of `alignment(o, p)` across every applicable
principle (the "contribution ledger" — every principle's vote is individually inspectable, which is
the platform's stated differentiator over an opaque scorer).

When a principle has no `dimensionVector` (or the option shares no scoreable dimension with it),
the engine falls back to `computeSemanticAlignment`: cosine similarity between the option's and the
principle's text embeddings. The mode selection is deliberately two-sided (`hasScoreableOverlap`) —
structured only when *both* the principle declares dimensions *and* the option scores at least one
of them — because scoring from the principle side alone silently returns a confident-looking
`alignment: 0` when the option simply never described that axis, which is indistinguishable from
"actively neutral" without the both-sides check.

**External grounding.** The weighted-sum formula is the classical **Simple Additive Weighting
(SAW)** / **Weighted Sum Model (WSM)** from Multi-Criteria Decision Analysis — one of the oldest
and most widely used MCDA aggregation rules, formalized in the operations-research literature
(Churchman & Ackoff, *An Approximate Measure of Value*, 1954; surveyed alongside its competitors
in Hwang & Yoon's standard MCDM reference, *Multiple Attribute Decision Making: Methods and
Applications*, 1981). **This is the correct citation — not the Analytic Hierarchy Process (AHP).**
An external write-up submitted for evaluation attributed DPF's decisioning to full MAUT/AHP with a
Saaty pairwise-comparison matrix and eigenvector-derived weights (Saaty, *The Analytic Hierarchy
Process*, 1980); no such matrix, eigenvector computation, or consistency-ratio check exists
anywhere in this codebase. The distinction matters for a research-grounded document: SAW assumes
attribute weights are already known and simply sums them; AHP is a *specific method for deriving*
those weights from pairwise judgments. DPF hand-authors its weights today (§3), so SAW is what is
actually running. §4 below identifies AHP's pairwise-elicitation method as a legitimate, currently
unbuilt technique for a specific unmet need (cold-start weight elicitation), rather than as a
description of the present system.

The semantic-alignment fallback is a direct application of the **vector space model** for
information retrieval (Salton, Wong & Yang, *A Vector Space Model for Automatic Indexing*, CACM
1975) using modern sentence/document embeddings in place of term-frequency vectors — standard,
well-established grounding for the cosine-similarity path.

The hierarchical spine/profession-local split, with mandatory projection back onto a shared spine,
is structurally the same move AHP itself makes at the *problem-structuring* stage (decomposing a
goal into a hierarchy of criteria and sub-criteria before any weight is assigned) — DPF's
architecture borrows AHP's hierarchical decomposition discipline without borrowing its
pairwise-eigenvector weight-derivation method. This is a legitimate, precise partial debt worth
recording rather than either denying influence or overclaiming the whole method.

### 2.3 Evidence discounting

`evaluateDecisionPerspective` (`apps/web/lib/decision-perspective/evaluator.ts`) does not score
options against dimension vectors directly; it scores whether *enough trustworthy material exists*
to support a recommendation at all. `scorePerspectiveMaterial` (`material.ts`) computes:

```
effectiveWeight = confidenceWeight × freshnessFactor × evidenceFactor × reviewFactor × promotionFactor
```

where each factor is an independent [0,1] discount: `freshnessFactor` (current 1 / stale 0.5 /
superseded 0.2 / contradicted 0), `evidenceFactor` by grade (A 1 / B 0.75 / C 0.4 / D 0),
`reviewFactor` (approved 1 / draft 0.35 / rejected 0), `promotionFactor` (promoted 1 / candidate
0.45 / revoked 0). Confidence for a domain is the mean `effectiveWeight` across applicable
materials, minus a risk-tier penalty (0 / 0.1 / 0.25 / 0.5 for low/medium/high/critical) and a
recent-override penalty (capped at 0.3).

**External grounding.** A confidence score built as a **product of independent reliability
discount factors applied to a base weight** is the same structural move as the **GRADE framework**
(Grading of Recommendations Assessment, Development and Evaluation — Guyatt et al., *GRADE: an
emerging consensus on rating quality of evidence*, BMJ 2008), the standard used across
evidence-based medicine and policy to discount a recommendation's confidence by evidence quality,
recency, and consistency before it is acted on. DPF's A/B/C/D evidence-grade discounting is a
direct structural analogue, applied to platform/business decisions instead of clinical ones. It is
deliberately *not* a formal Dempster-Shafer belief-combination rule (Shafer, *A Mathematical Theory
of Evidence*, 1976) — there is no explicit handling of conflicting-evidence mass reassignment,
only exclusion (contradicted/rejected/revoked material scores zero outright) — and this document
does not claim that heavier formalism; the simpler multiplicative-discount model is what is
implemented and is accurately described as GRADE-like, not Dempster-Shafer-like.

## 3. Weight fluidity: the JSI three-timescale model

`docs/superpowers/specs/2026-07-24-job-specific-intelligence-fluid-weight-layer-design.md` names
the central limitation the sections above still have: every `principleDimensionVector` is
hand-authored once and frozen until a human deliberately re-authors it in a PR. That is more
auditable than a neural network's weights, but exactly as static in the one property a live job
needs — a job is not a training corpus; its ground truth of "what a good decision looks like" is a
moving target (seasonal demand, an organization's accumulating preferences, a craft's evolving
standards), not a fact that can be baked in once.

JSI resolves this by recognizing three genuinely different timescales of truth, each requiring a
different update rule:

| Timescale | What moves on it | Mechanism | Update rule |
|---|---|---|---|
| **Slow / doctrinal** | Kernel commandments, spine axes | PR + founder ratification | Human-authored, rare, deliberate — unchanged by this document |
| **Medium / revealed preference** | What an org's or coworker's accumulated rulings reveal about a real tradeoff weighting | `apps/web/lib/decision-perspective/weight-inference.ts` | Statistical inference over paired (chosen vs. recommended) decision vectors, gated, never auto-applied |
| **Fast / contextual-situational** | The immediate situation (season, live signal) | Not yet built; one pilot correlate scoped | Validated correlation-to-outcome required before any influence on a live score |

### 3.1 Medium timescale: weight inference as preference learning

`inferWeightProposals` reads `WeightInferenceObservation[]` — paired `chosenVector` /
`recommendedVector` axis scores for real past decisions in one `(domainClass, profile)` group —
and proposes an adjustment only when:

- **sample floor**: ≥8 observations in the group (no pooling across groups to clear it);
- **consistency floor**: a super-majority (≥0.7) of decisions that *separated* on an axis went the
  same direction (agreements with zero separation count toward the base but cannot manufacture a
  signal);
- **magnitude floor**: mean separation ≥0.1 (a systematic-but-trivial preference does not trigger a
  proposal).

A surfaced proposal enters the same confirmation ladder `stance-promotion.ts` already uses for
material authority (`unconfirmed` 0.6 → `confirmed` 0.9 → `ruled` 1.0), but strictly *below*
`unconfirmed`, at `entersAtConfidenceWeight: 0.3` — enforced by a runtime assertion — so an
un-ruled statistical inference can never outweigh authored doctrine. It mutates nothing until a
human rules on it.

**External grounding**, per the JSI spec's own research pass (§3), independently arrived at and
consistent with this document's framing:

- **Revealed preference theory** (Samuelson, *A Note on the Pure Theory of Consumer's Behaviour*,
  1938) is the classical economic grounding for inferring a preference ordering from observed
  choices rather than stated weights — precisely what "the human systematically overrode the
  kernel in a consistent direction" is doing.
- **Bradley-Terry model** (Bradley & Terry, *Rank Analysis of Incomplete Block Designs*, Biometrika
  1952) is the standard statistical model for inferring a latent strength/weight ordering from
  paired-comparison outcomes. DPF's consistency-floor check (a distribution-free super-majority
  test on separated pairs) is a simplified, non-parametric cousin of what a full Bradley-Terry fit
  would estimate with a likelihood model; naming the lineage is honest, naming it *as* Bradley-Terry
  estimation would overclaim statistical rigor not implemented.
- **Contextual bandits** (LinUCB — Li, Chu, Langford & Schapire, *A Contextual-Bandit Approach to
  Personalized News Article Recommendation*, WWW 2010; Thompson sampling, Thompson 1933) are the
  standard open formalism for adjusting a weight online from a bounded reward signal while carrying
  an explicit confidence/sample-count alongside the point estimate — validating that pairing every
  inferred weight with `minSampleSize`/consistency, as `weight-inference.ts` already does, is the
  right shape rather than an ad hoc safety add-on. DPF explicitly does not adopt full bandit
  optimization (a single scalar reward per arm), because its decisions are multi-axis and
  multi-principle by design and collapsing to one reward would erase the per-principle contribution
  ledger.
- **Concept-drift detection** (ADWIN — Bifet & Gavaldà, *Learning from Time-Changing Data with
  Adaptive Windowing*, SDM 2007; DDM — Gama et al., *Learning with Drift Detection*, SBIA 2004) is
  the correct pattern for *when* to re-evaluate a proposal — on a windowed statistical disagreement
  threshold, not a fixed cron — while explicitly not adopting the underlying (opaque) models these
  libraries adapt.

### 3.2 Fast timescale: situational signal validation

Not yet built. The design (JSI spec §4.3) proposes exactly one pilot: a single correlate, in a
single archetype, that starts as unscored evidence and is promoted to a scored input only after a
minimum-sample, minimum-correlation-with-*actual-recorded-outcome* test, ratified by a human — a
deliberately higher bar than the medium layer, because an external signal has no author vouching
for it. Once validated it modulates a decision at inference time only; it is never persisted as a
stored weight (the "attention, not backprop" distinction the spec draws explicitly from how a
transformer's attention mechanism re-weighs context at inference time over frozen training-time
weights — the LLM-construction analogy the JSI spec opens with).

**External grounding**: signal half-life / confidence decay on a live risk signal, with a
human-reviewable rule layer staying inspectable while a statistical layer adapts underneath, is
established practice in production fraud-detection systems (e.g. Stripe Radar's public
documentation of analyst-overridable, decaying risk signals) and in hybrid recommender systems that
blend stable hand-curated features with continuously updated collaborative-filtering signal as
distinct components combined at serving time, not merged into one representation (the
architecture pattern documented publicly by Netflix's and Spotify's recommendation engineering
writing). Both are cited as structural precedent in the JSI spec, not as endorsements to adopt
either platform's underlying (opaque) model.

## 4. Where AHP-style pairwise elicitation would actually fit

Section 2.2 established that DPF runs Simple Additive Weighting, not AHP, today. There is one
concrete, currently-unmet need where AHP's actual contribution — deriving a weight vector from a
human's pairwise judgments rather than requiring raw numbers — is the right tool: **cold start**.

`weight-inference.ts`'s sample floor (§3.1) means a brand-new organization profile, or a newly
onboarded archetype, has *no* revealed-preference signal to learn from and must run on hand-authored
spine/profession defaults alone until enough decisions accumulate. Saaty's pairwise-comparison
method — present a business owner with simple binary/intensity comparisons ("is cost more or less
important than turnaround time, and by how much, on a 1–9 scale?"), build the reciprocal comparison
matrix, and take the principal eigenvector as the derived weight vector, checking a Consistency
Ratio against Saaty's empirical Random Index to catch incoherent judgments — is a well-validated way
to extract an initial weight vector from a non-technical operator without asking for raw numbers.
This is exactly the "Active Preference Elicitation" idea the external write-up raised, and it is
sound decision theory; the write-up's error was claiming it as already implemented, not in
recommending it.

**Scoped correctly, this is additive, not architecturally new:** an AHP-derived initial vector
would enter the *same* `WeightAdjustmentProposal` ladder §3.1 already defines, at the same
sub-`unconfirmed` confidence tier, superseded the moment enough real decision history exists to run
genuine weight inference. It would not create a second authority model, and it would not apply to
the spine (a per-org AHP session cannot invent new axes — §2.1's projection rule and the
`decisions-belong-to-their-scope` non-inherit boundary both hold unchanged). This is recorded here
as a candidate for a future, separately-scoped BI — not proposed as done, and not scheduled ahead of
the JSI spec's own sequencing (§6 of that spec; medium-timescale wiring is the higher-leverage,
already-designed gap).

## 5. Summary table

| Mechanism | File | Real external prior art | Status |
|---|---|---|---|
| Authority scope partition | `docs/design/golden-triangle-design.md` §5 | Subsidiarity (*Quadragesimo Anno* 1931; TEU Art. 5(3)) | Shipped |
| Dimension registry, spine/profession-local split | `packages/db/src/wiki-taxonomy.ts` | AHP's hierarchical problem-structuring (Saaty 1980) — decomposition only, not weight derivation | Shipped (BI-AA7D80FE) |
| Structured alignment scoring | `apps/web/lib/decision/option-scoring.ts` | Simple Additive Weighting / Weighted Sum Model (Churchman & Ackoff 1954; Hwang & Yoon 1981) | Shipped |
| Semantic alignment fallback | `apps/web/lib/decision/option-scoring.ts` | Vector space model (Salton et al. 1975) | Shipped |
| Evidence-coverage confidence discounting | `apps/web/lib/decision-perspective/material.ts` | GRADE evidence-quality discounting (Guyatt et al. 2008) | Shipped |
| Material authority ladder | `apps/web/lib/decision-perspective/stance-promotion.ts` | Revealed preference (Samuelson 1938) | Shipped |
| Medium-timescale weight inference | `apps/web/lib/decision-perspective/weight-inference.ts` | Bradley-Terry (1952); LinUCB/Thompson sampling; ADWIN/DDM | Engine shipped and unit-tested; **zero live callers** (JSI spec §2) |
| Fast-timescale situational signal | Not yet built | Stripe Radar signal decay; Netflix/Spotify hybrid blend | Design only, one pilot scoped (JSI spec §4.3) |
| Cold-start pairwise elicitation | Not yet built | AHP eigenvector method + Consistency Ratio (Saaty 1980) | Candidate, not scoped as a BI (§4 above) |
| Cost/quality/time preference compiler | `docs/design/golden-triangle-design.md` | PMI triple constraint; NIST AI RMF; RouteLLM; FrugalGPT | Slice 3 shipped (v0.3.5) |
| Runtime authority/harness enforcement | `docs/architecture/trusted-ai-kernel.md` | ISO/IEC 42001; NIST AI RMF; MCP; OWASP Agentic Top 10 | Normative standard, implementation ongoing |

## References

- Bifet, A. & Gavaldà, R. (2007). *Learning from Time-Changing Data with Adaptive Windowing.* SDM.
- Bradley, R. A. & Terry, M. E. (1952). *Rank Analysis of Incomplete Block Designs.* Biometrika 39(3/4).
- Churchman, C. W. & Ackoff, R. L. (1954). *An Approximate Measure of Value.* Journal of the Operations Research Society of America 2(2).
- Gama, J., Medas, P., Castillo, G. & Rodrigues, P. (2004). *Learning with Drift Detection.* SBIA.
- Guyatt, G. et al. (2008). *GRADE: an emerging consensus on rating quality of evidence and strength of recommendations.* BMJ 336.
- Hwang, C.-L. & Yoon, K. (1981). *Multiple Attribute Decision Making: Methods and Applications.* Springer.
- Keeney, R. L. & Raiffa, H. (1976). *Decisions with Multiple Objectives: Preferences and Value Tradeoffs.* Wiley.
- Li, L., Chu, W., Langford, J. & Schapire, R. E. (2010). *A Contextual-Bandit Approach to Personalized News Article Recommendation.* WWW.
- Samuelson, P. (1938). *A Note on the Pure Theory of Consumer's Behaviour.* Economica 5(17).
- Saaty, T. L. (1980). *The Analytic Hierarchy Process.* McGraw-Hill.
- Salton, G., Wong, A. & Yang, C. S. (1975). *A Vector Space Model for Automatic Indexing.* CACM 18(11).
- Shafer, G. (1976). *A Mathematical Theory of Evidence.* Princeton University Press.
- Thompson, W. R. (1933). *On the Likelihood that One Unknown Probability Exceeds Another in View of the Evidence of Two Samples.* Biometrika 25(3/4).
- Pius XI (1931). *Quadragesimo Anno.*
- Treaty on European Union, Article 5(3) (subsidiarity).
- DPF internal: `docs/architecture/trusted-ai-kernel.md`; `docs/design/golden-triangle-design.md`; `docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md`; `docs/superpowers/specs/2026-07-24-job-specific-intelligence-fluid-weight-layer-design.md`; `docs/superpowers/plans/2026-07-24-weight-inference-from-rulings.md`; `docs/superpowers/specs/2026-06-09-wsid-coworker-professional-corpus-design.md`.
