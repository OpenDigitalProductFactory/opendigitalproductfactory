# Decision Vectors — the complete reference

## Abstract

Every judgement an AI coworker makes on this platform is scored against a **closed, named registry of
decision axes**. An option is not scored by a model's opinion; it is scored by how much it exhibits
each named axis, multiplied by how much each governing principle says that axis matters, with every
principle's individual vote left inspectable afterwards.

This document is the complete per-axis definition of that registry: what each axis means in plain
language, what a *high* score on it signifies, whether it is a benefit or a cost, whether it is
shared doctrine or one profession's vocabulary, where its weight comes from, and who is allowed to
change it.

It exists because the registry has, until now, only been fully documented in code comments
(`packages/db/src/wiki-taxonomy.ts`, `packages/db/src/dimension-scope.ts`). A prospective user
evaluating whether this platform's judgement is thoughtful should not have to read TypeScript to
find out what it weighs.

**Companion documents.** [Vector Decisioning for JSI](vector-decisioning-and-jsi.md) states the
mathematics and its external prior art. [TAK](trusted-ai-kernel.md) governs whether an agent may act
at all. [TAK-JSI](job-specific-intelligence.md) governs whether a profile is qualified for a job.
This document defines *what the judgement weighs*. For how the emphasis shifts by line of business,
see [Decision Vectors by Business Type](decision-vectors-by-archetype.md).

---

## 1. What a decision vector is

Three separate things are often collapsed into the word "vector". They are kept apart here because
they have different authors, different lifetimes, and different authority to change.

| Term | What it is | Who authors it |
|---|---|---|
| **Axis** (dimension) | One named thing a decision can be weighed on — e.g. `reversibility`. There are exactly 20, and the set is closed. | Platform, by PR, compile-enforced |
| **Option features** | For one option under consideration, how much it exhibits each axis, scored `0..1`. "This option has high blast radius" is a feature, not a weight. | The caller framing the decision |
| **Principle weight vector** | For one principle, a *signed* weight per axis it cares about, plus a written rationale. This is what encodes judgement. | Whoever owns that principle's scope |

The score of an option against a principle is the option's features projected onto that principle's
signed weights, normalised by the weight vector's L1 norm so principles that name three axes and
principles that name ten remain comparable:

```
alignment(option, principle) = ( Σ_d feature_d × weight_d ) / ( Σ_d |weight_d| )
```

A composite score is the evidence-weighted combination of that across every principle in scope — and
the per-principle breakdown (the **contribution ledger**) is retained, so "why" is always answerable
without re-running anything.

### 1.1 Sign convention — and why some axes are named for the bad thing

Option features are never negative: an option cannot exhibit *minus* blast radius. So the only way a
principle can say "I am against this" is a **negative weight**.

That makes axis *naming* load-bearing. Five axes are **costs** — a high feature score means the
option exhibits more of a bad thing — and a principle that opposes them must carry a negative weight:

`blast_radius` · `human_cognitive_load` · `vendor_lock_in` · `business_disruption` · `operator_effort`

A positive weight on a cost axis makes the scorer reward the very harm the principle exists to
prevent. This is not hypothetical: `never-wipe-db-for-code-fixes` once carried `blast_radius: 1.0`
and consequently scored "wipe the database" as its best-aligned option (recorded in the 2026-06-14
dimension sign audit, linked below). A
seed-time guard now enforces the convention, and cost axes are deliberately **named for what a high
score means** so a benefit-shaped name cannot re-import the inversion.

### 1.2 Spine vs profession-local

The 20 axes are split into two scopes.

- **Spine (12 axes)** — the *commensurability layer*. These are the axes that let a security
  objection and a design objection be weighed in one ledger. Kept deliberately small.
- **Profession-local (8 axes)** — one profession's craft vocabulary, scored at full resolution
  inside that profession, and **projected** onto one or more spine axes when the decision leaves it.

Reduction was by **demotion, not deletion**: nothing left the registry, and every profession-local
axis carries a mandatory non-empty `projectsOnto`, because a demotion without a projection silently
drops the axis from cross-profession decisions — deletion wearing a demotion's name.

The classification was made on **specialist-authorship share**, not raw usage, because raw usage
mostly measures which profession happened to author the corpus. Two guards override the measurement:
universal obligations stay on the spine regardless of how rarely they are used (`public_safety`,
`data_privacy`), and axes less than a few weeks old are protected, because low usage measures their
age, not their reach.

### 1.3 How much a principle's vote is worth

Weight magnitude defaults by the principle's tier, chosen so the hierarchy degrades gracefully
rather than acting as a categorical override:

| Tier | Default magnitude | Effect |
|---|---|---|
| `commandment` | 1.0 | One commandment at full alignment outweighs ten contextual principles at full alignment |
| `core` | 0.4 | |
| `contextual` | 0.1 | |

A principle may override its own magnitude with a written rationale; divergence is linted, not
silently accepted.

---

## 2. How to read an axis entry

Each entry below states:

- **Question** — the question the axis actually asks about an option.
- **A high score means** — what a feature score near `1.0` signifies. For cost axes this is bad.
- **Kind** — benefit or **cost** (a principle opposing a cost carries a negative weight).
- **Scope** — spine, or profession-local with its owning profession and its projection.
- **Why it is scoped that way** — the recorded rationale, not a post-hoc summary.

---

## 3. The spine — 12 axes every profession shares

### `long_term_maintainability`
- **Question:** how expensive will this be to keep correct over time?
- **A high score means:** the option stays correct cheaply as the world changes around it.
- **Kind:** benefit.
- **Scope:** spine.
- **Why:** durability is profession-neutral. A contract, a menu, a network topology and a software
  module all get more expensive to keep correct over time. Its heavy specialist-authorship share
  reflects who wrote the corpus, not what the axis means. It is also the single most-used axis
  (68% of principles load it), which is itself a finding — see §6.

### `governance_compliance`
- **Question:** does this satisfy the policy, audit, and regulatory obligations that bind here?
- **A high score means:** the option meets the obligations rather than needing an exception.
- **Kind:** benefit.
- **Scope:** spine.
- **Why:** policy and audit obligations bind every profession, so an option that satisfies them must
  be comparable to one that does not, wherever the objection originates.

### `evidence_density`
- **Question:** how much verifiable backing does this option have, as opposed to assertion?
- **A high score means:** the claim is grounded in checkable material.
- **Kind:** benefit.
- **Scope:** spine.
- **Why:** it is the platform's shared epistemic floor. Evidence, not confidence, is what makes a
  recommendation actionable.

### `speed_to_value`
- **Question:** how quickly does this reach a usable outcome?
- **A high score means:** value lands sooner.
- **Kind:** benefit — but legitimately carries a *negative* weight where a principle deliberately
  trades speed away for correctness. It is a genuine trade-off axis, not a virtue.
- **Scope:** spine.
- **Why:** time-to-usable-outcome is the universal trade partner for every quality axis. It has the
  lowest specialist-authorship share of the high-usage axes, i.e. everyone uses it.

### `blast_radius`
- **Question:** how much of the estate does this reach if it turns out to be wrong?
- **A high score means:** **more** of the estate is exposed. Worse.
- **Kind:** **cost.**
- **Scope:** spine.
- **Why:** it is the shared risk currency — the axis a security objection and an architecture
  objection both speak.

### `human_cognitive_load`
- **Question:** how much human attention and judgement does this demand?
- **A high score means:** **more** demand on people. Worse.
- **Kind:** **cost.**
- **Scope:** spine.
- **Why:** the demand is borne by the same humans regardless of which profession produced the
  option, so it cannot belong to one of them.

### `public_safety`
- **Question:** does this protect people outside the organisation from harm?
- **A high score means:** the option protects them.
- **Kind:** benefit.
- **Scope:** spine.
- **Why:** a **universal obligation, not a frequency call** — it is used by only a handful of
  principles and stays on the spine anyway. If a safety objection could not be weighed against a
  design objection in one ledger, the spine would have failed at its only job.

### `data_privacy`
- **Question:** does this protect personal data?
- **A high score means:** personal data is better protected.
- **Kind:** benefit.
- **Scope:** spine.
- **Why:** a **universal obligation**, authored entirely by non-specialist principles. Protection of
  personal data is a legal duty crossing every profession, so it cannot be scoped to one.

### `reversibility`
- **Question:** if this turns out to be wrong, can it be undone?
- **A high score means:** the action can be reversed.
- **Kind:** benefit.
- **Scope:** spine.
- **Why:** whether an action can be undone is a property of *any* action in any profession. It is
  authored purely by universal principles, which is the signal — its low usage count is not.

### `cost_efficiency`
- **Question:** what does this cost in money?
- **A high score means:** the same outcome for less money.
- **Kind:** benefit.
- **Scope:** spine.
- **Why:** money is the one axis every profession trades against. It is the registry's **explicit
  exception to the demote-if-rarely-used rule**: it is scored by essentially no principles today,
  and that is recorded as a *gap in the corpus*, not evidence that the axis is niche. A
  cost-sensitivity principle is scoped as separate work.

### `operator_effort`
- **Question:** how many operations, and how much elapsed time, does the operator have to spend to
  reach the outcome?
- **A high score means:** **more** clicking, waiting, and re-entry. Worse.
- **Kind:** **cost.**
- **Scope:** spine.
- **Why:** effort and elapsed time are borne identically whichever profession authored the option.
  A young axis — its low usage count measures its age, not its reach. It was deliberately renamed
  from a benefit-shaped working name precisely to avoid the sign inversion of §1.1.

### `legibility_of_consequence`
- **Question:** before authorising this, can the operator foresee what it will actually do?
- **A high score means:** the consequence is visible in advance.
- **Kind:** benefit.
- **Scope:** spine.
- **Why:** foreseeing the consequence is a **precondition of informed authorisation everywhere**,
  not a design-profession concern. Authored entirely by non-specialist principles.

---

## 4. Profession-local — 8 axes, each projecting back onto the spine

These score at full resolution inside their owning profession. When the decision leaves that
profession, the axis projects onto its spine target(s), with weight split evenly across them, and
the projection must land on the spine in a single hop.

| Axis | Kind | Owner | Projects onto | Question it asks |
|---|---|---|---|---|
| `schema_grounding` | benefit | software-engineer | `long_term_maintainability` | Is this anchored in the substrate that already exists, rather than inventing alongside it? |
| `reusability` | benefit | software-engineer | `long_term_maintainability` | Does this serve more callers and contexts than the one in front of us? |
| `operational_independence` | benefit | devops-platform | `long_term_maintainability`, `blast_radius` | How much does this keep running without an external party? |
| `vendor_lock_in` | **cost** | devops-platform | `long_term_maintainability` | How deeply does this tie us to a single supplier? |
| `capacity_utilization` | benefit | operations | `cost_efficiency` | Does this make fuller use of capacity already paid for? |
| `evidence_confidence` | benefit | security | `evidence_density` | How *conclusive* is the investigation — distinct from how much evidence exists? |
| `business_disruption` | **cost** | security | `blast_radius` | Does the protective response break production? |
| `customer_consent_state` | benefit | marketing | `governance_compliance` | How broad is the customer's standing approval for this contact or action? |

**Notes on the two least obvious calls.**

`schema_grounding` is the largest demotion and the clearest instance of the whole policy: it is the
third most-used axis in the entire corpus, and it was still demoted, because half its uses were
authored by one profession and the axis is *literally named in that profession's vocabulary*. Its
apparent load-bearing weight came from that cohort's over-representation. Grounding work in existing
substrate is how software buys durability — so it rolls up onto durability, where every other
profession can weigh it.

`evidence_confidence` versus `evidence_density` is a real distinction that only one profession
routinely needs. How *conclusive* an investigation is, is not the same judgement as how *much*
material backs it — a security analyst separates them daily; elsewhere the difference does not pay
for the extra axis, so it rolls up.

### 4.1 Profession-declared (namespaced) axes

Beyond the eight demoted spine axes above, a profession may declare **net-new namespaced axes**
inside its own corpus (`<profession>/<axis>`, registry `packages/db/src/profession-local-axes.ts`),
each typed benefit/cost, sourced, and projecting onto the spine with matching polarity. The
registry currently carries:

| Axis | Kind | Projects onto |
|---|---|---|
| `ux-design/hierarchy_flatness`, `ux-design/content_density`, `ux-design/disclosure_debt`, `ux-design/perceptual_clutter` | cost | `human_cognitive_load` |
| `data-architect/referential_backing` | benefit | `long_term_maintainability` |
| `data-architect/migration_fleet_risk` | **cost** | `blast_radius` |
| `software-engineer/supersession_debt` | **cost** | `human_cognitive_load` |
| `security/exposure_surface` | **cost** | `blast_radius` |
| `devops-platform/upgrade_continuity` | benefit | `reversibility` |
| `mcp-integration/protocol_window_conformance` | benefit | `governance_compliance` |
| `mcp-integration/context_economy` | benefit | `cost_efficiency` |

The internal-developer acumen set (everything below the ux-design rows) carries the
architecture-shape principles of the 2026-08-16 simplify-strengthen pass into each craft's own
decision vocabulary (BI-CC44E74F, EP-413F2602).

---

## 5. Where a weight comes from — sourcing classes

Selecting *which* axes a decision weighs and setting *how much* each weighs are two different
problems with two different authorities. Conflating them is how a registry rots: a fact about the
world gets frozen into a hand-authored constant and nobody notices it drifted.

Four sourcing classes are defined. Their **status differs**, and this document states it plainly
rather than describing the design as though it were the system.

| Class | What the weight is | How it is refreshed | Status |
|---|---|---|---|
| **basic** | Hand-scored doctrine. Stable, shared, deliberate. | PR + ratification by the scope's owner. | **Shipped.** Every weight in the registry today is this class. |
| **corpus-derived** | A profession-owned axis whose meaning comes from that profession's own corpus. | Corpus changes → re-derive. | **In use.** The namespaced registry carries the ux-design set and the internal-developer acumen set (§4.1). |
| **revealed** | A weight *inferred from rulings* — what the organisation's accumulated overrides reveal about a trade-off it actually makes. Never the axis *selection*, only the magnitude. | Statistical inference over past decisions, then a human ruling. | **Engine shipped and fed;** it proposes, it never applies. |
| **external** | A live looked-up signal (a season, a market condition) that modulates a decision at inference time. | Validated against recorded outcome before it may score anything. | **Not built.** One pilot scoped. |

The label itself — making sourcing a declared property of each axis rather than prose in a design
document — is **designed, not yet implemented** (tracked as Phase 0 of the per-job vector
inventory). Today every weight is hand-authored regardless of which class it conceptually belongs
to, and that is precisely the gap the classification exists to close.

### 5.1 The revealed class in detail

This is the one adaptive path currently wired, so its floors matter. An adjustment is proposed only
when all three hold within a single `(domain, profile)` group — with no pooling across groups to
manufacture a sample:

- **sample floor** — at least 8 observations;
- **consistency floor** — at least 70% of the decisions that actually *separated* on that axis went
  the same way (agreements that separated on nothing count toward the base but cannot create a
  signal);
- **magnitude floor** — mean separation of at least 0.1, so a systematic but trivial preference does
  not trigger anything.

A surfaced proposal enters the same confirmation ladder the platform already uses for material
authority — `unconfirmed` 0.6 → `confirmed` 0.9 → `ruled` 1.0 — but strictly **below** the bottom
rung, at 0.3, enforced by a runtime assertion. A statistical inference can therefore never outweigh
authored doctrine, and it mutates nothing at all until a human rules on it.

### 5.2 Confidence is discounted before any of this is acted on

Separately from scoring options, the platform scores whether *enough trustworthy material exists to
recommend at all*. Each supporting item's weight is multiplied by independent `[0,1]` discounts:

```
effectiveWeight = confidenceWeight × freshness × evidenceGrade × reviewState × promotionState
```

Freshness: current 1 · stale 0.5 · superseded 0.2 · contradicted 0. Evidence grade: A 1 · B 0.75 ·
C 0.4 · D 0. Review: approved 1 · draft 0.35 · rejected 0. Promotion: promoted 1 · candidate 0.45 ·
revoked 0. Domain confidence is the **mean** effective weight across applicable material, minus a
risk-tier penalty (0 / 0.1 / 0.25 / 0.5) and a capped recent-override penalty.

Two consequences worth stating because they surprise people: contradicted, rejected, or revoked
material scores **zero outright** rather than being argued down; and because confidence is a *mean*,
adding weakly-graded material to a strong domain **dilutes** it. More sources is not automatically
more confidence.

### 5.3 The high-stakes hold, and how it is released

An unattended platform seed does **not** make craft doctrine live for a high-stakes profession.
`packages/db/src/profession-material-promotion.ts` withholds derived-tier material for any family
whose registry `contextSlugs` touch finance or compliance: those rows land `reviewStatus: draft` /
`promotionState: candidate`. Per §5.2 that is a 0.35 × 0.45 discount — but the gate never gets that
far, because it selects only `approved` + `promoted` material. Held material is therefore invisible
to the gate entirely, and the profession falls back to platform doctrine with
`professionProfileSelected: false`.

That is deliberate: machine-seeded doctrine for a compliance-adjacent craft should not govern
decisions until a human has read it. `security` (`contextSlugs: ["data-security", "compliance"]`) is
held; `data-architect` (`["data-model", "data-security"]`) is not — the trigger is the
compliance/finance slugs specifically.

**The release path is the operator queue on `/coworker-decisions/review`.** Held families surface
there as "Craft doctrine waiting on you", and approving one flips its rows to approved+promoted and
records the approving user (`reviewedByUserId` / `reviewedAt`). The write is scoped by the held
state itself, so it is idempotent and can never pull an already-approved row backwards — the same
non-downgrade invariant the promotion module holds on the write side.

Before that surface existed the hold had **no release at all** (BI-5F3BFD13): nothing listed the
held rows, `list_open_decision_reviews` did not return them, and no tool could promote them, so a
high-stakes profession stayed permanently mute on a fresh install. A hold with no release is
indistinguishable from a silent drop, which is the failure this section exists to prevent recurring.

---

## 6. What the registry currently gets wrong

A document that only described the design would be marketing. The measured state of the corpus, from
the decision-tier rebalance analysis (measured over a 19-axis registry, before the most recent axis
landed):

- 95 principles use an average of **3.6 of 19** available axes.
- `long_term_maintainability` is loaded by **68%** of them; `cost_efficiency` by
  **none**.
- The effective rank of the decision space is roughly **6** — meaning that although 20 axes exist,
  the corpus only genuinely discriminates along about six directions.
- Around **41%** of principle vectors were authored by a single persona, which concentrates the
  blind spots.

This is the open problem the per-job inventory work exists to fix, and it is the honest answer to
"how good is this really": the *mechanism* is sound and inspectable; the *corpus filling it* is
under-determined and over-concentrated, and repairing that is ongoing rather than done.

---

## 7. Crowd validation and hive intake

The long-term intent is that these weights are **crowd validated and sourced** rather than authored
by one organisation — and that the platform's ability to take that input in is part of the hive
mind, not a side channel.

### 7.1 What exists today

The hive is a lightweight git-and-ledger mechanism, not a service: contributions leave an install as
a pull request against the public upstream repository under a pseudonymous per-install identity,
and knowledge arrives back through a scheduled research ingest and through platform upgrades. That
means an outside contribution to the decision registry travels the path any other contribution
travels:

1. A contributor proposes a change — a rationale, a weighting, a profession-local axis — as a PR
   against the shared corpus.
2. It carries **evidence, and the evidence is graded** (§5.2). An assertion with no backing is
   scored at grade D, which is zero.
3. Nothing it proposes can enlarge the axis set, because the registry is closed and compile-enforced
   (§7.3).
4. A weight it proposes enters the promotion ladder **below** `unconfirmed` and mutates nothing
   until a human with authority over that scope rules on it (§5.1).

Every one of those four is shipped. Together they are the reason crowd input can be accepted without
the corpus becoming whatever the loudest contributor said last.

### 7.2 What is not built, stated plainly

There is currently **no per-axis validation record** — no count of how many independent
organisations have corroborated a given weighting, no provenance chain from a weight back to the
evidence and installs that support it, and no published disagreement surface showing where the fleet
genuinely splits. A weight today is authored and ratified; it is not yet *attested*.

That gap is the substantive work between "we accept contributions" and "these weights are crowd
validated", and it should not be read as done.

### 7.3 The constraint that makes all of this safe

An install **may not declare new axes.** It re-weights the shared set, or a profession declares a
namespaced local axis inside its own corpus that projects onto the spine. Nothing else is available:
option features naming unknown axes are rejected outright, and adding an axis without classifying
its scope is a compile error rather than a silently unlabelled axis.

This is the guardrail the whole approach rests on. Per-organisation axes would make every install's
judgement incomparable with every other's, and would destroy exactly the property that makes a hive
worth having — the ability to generalise across installs. Richness is allowed to proliferate where
the criteria actually live, inside a profession; the space every decision must reason over stays
small and shared.

---

## 8. What an organisation may choose

### 8.1 The layer an owner actually touches — business stance vectors

The 20 axes above are the scoring substrate. They are not what a business owner is asked to fill
in. The owner-facing layer is a separate, deliberately small set of **five business stance
vectors**, each phrased as a question the owner recognises, each pre-answered from their business
type, and each editable in plain English:

| Stance vector | The question it answers | Carries a spend ceiling |
|---|---|---|
| `customer-goodwill` | When something goes wrong on our side, how far do we go to make it right — and how far may a coworker go without asking? | Yes |
| `pricing-integrity` | Do we honour a quote we got wrong? When is a discount legitimate? | Yes |
| `growth-vs-stability` | When new opportunities compete with existing commitments, which wins? | No |
| `quality-bar` | What standard does work have to meet before it leaves our hands? | No |
| `spend-authority` | What may be bought without asking the owner? | Yes |

Three of the five carry an explicit **authority ceiling in money**, which is what converts a stated
value into an actual delegation: "resolve it on the spot up to the ceiling; above it, the owner
decides."

**These defaults change by business type — which is the point.** The generic goodwill ceiling is
$100; a restaurant's is $60 and framed around fixing the visit while the guest is still at the
table; a clinic's is $150 with a same-day response; a software platform's is $200 and framed around
outages and billing errors. A clinic's spend ceiling is $500 because a stock-out delays care. Public
sector does not get a goodwill ceiling at all — remedies follow the published schedule, "not
discretion" — and its pricing stance says fees change by public decision, never as a service
gesture. A nonprofit's spend stance is written around the fact that every dollar carries a donor's
trust. Twelve business types currently override at least one vector; the rest inherit the generic
set. See [Decision Vectors by Business Type](decision-vectors-by-archetype.md) for how this pairs
with the axis emphasis.

The owner sees these as cards during onboarding and can revise them at any time on the **business
stance surface** (`/coworker-decisions/stance`), which lists the organisation's own stance pages and
offers a plain-language authoring form. Nothing here requires understanding the axis registry.

### 8.2 The honest boundary between the two layers

An org's stance pages are **corpus material, not weight vectors.** They are seeded as published
organisation pages and retrieved by the decision gate as the org's own policy, where they carry
evidence grading and the confidence discounting of §5.2. They do **not** currently carry a
`principleDimensionVector`, which means they steer a decision through retrieval and semantic
alignment rather than through structured scoring on the 20 axes.

That is a real seam, and it is worth stating rather than glossing: today an organisation edits its
judgement in plain English, and separately the platform scores options on named axes. Connecting
them — so that "we honour a quote we got wrong" measurably moves `governance_compliance` and
`cost_efficiency` on the options a coworker weighs, rather than only influencing what gets retrieved
— is exactly the per-job vector inventory work described in §5, and it is not done.

### 8.3 The full selection contract

An install's decision posture is selectable within hard bounds. What follows is the contract, with
each row marked for what is available today.

| The organisation may… | How | Status |
|---|---|---|
| Answer the five business stance questions in plain English, pre-filled from its business type, with money ceilings that delegate real authority | The business stance surface (§8.1) | Shipped |
| Set its own policy material, which is what the org scope weighs | Organisation decision-perspective profile, authored as org stance material | Shipped |
| Have its real trade-offs learned from its own rulings, then ratify them | The revealed class (§5.1) — proposals surface, a human rules | Engine shipped |
| Override any single decision | Per-decision override, bounded by policy | Shipped |
| Inherit a profession's craft floor for specialist work | Profession corpora bound to coworker roles | Shipped |
| Start from a considered weighting before it has any decision history | Guided pairwise elicitation at onboarding — answering "is cost more important than turnaround, and by how much?" rather than typing numbers | **Candidate, not built** |
| Declare a new axis | — | **Never** (§7.3) |
| Have platform doctrine decide its business decisions by default | — | **Never.** A non-owning scope is advisory only; the gate defers to a human rather than borrow a neighbouring scope's doctrine |

That last row is the subsidiarity rule the whole authority model turns on: **the most local scope
that owns a decision applies, and a scope that does not own it is advisory, never a substitute
authority.** Platform doctrine ("what would the founder do") is explicitly advisory-only for any
customer business decision — when an organisation's own policy is silent, the answer is to ask a
human, not to quietly inherit someone else's judgement.

---

## 9. Status summary

| Capability | Status |
|---|---|
| Closed 20-axis registry, compile-enforced | Shipped |
| Spine / profession-local classification with mandatory projection | Shipped |
| Signed weight vectors with written rationales + sign-convention guard | Shipped |
| Structured alignment scoring + inspectable contribution ledger | Shipped |
| Evidence-graded confidence discounting | Shipped |
| Weight inference from rulings (proposes only, never applies) | Shipped |
| Profession-local axis registry | Shipped, populated (§4.1) |
| `dimensionSourcing` label on each axis | Designed, not built |
| Five owner-facing business stance vectors, archetype-defaulted, with spend ceilings | Shipped |
| Stance answers expressed as weights on the 20 axes | Not built (§8.2) |
| Per-job vector inventory across all professions | Designed, in progress |
| External / situational signals | Not built, one pilot scoped |
| Cold-start pairwise elicitation | Candidate |
| Per-axis crowd attestation and provenance | Not built (§7.2) |

---

## References

Registry and scope policy: `packages/db/src/wiki-taxonomy.ts`, `packages/db/src/dimension-scope.ts`,
`packages/db/src/profession-local-axes.ts`. Scoring:
`apps/web/lib/decision/option-scoring.ts`. Confidence and inference:
`apps/web/lib/decision-perspective/material.ts`, `.../stance-promotion.ts`,
`.../weight-inference.ts`.

Design record (the `docs/superpowers/` tree is not published to this site; these link to the public
repository): the [decision-tier rebalance and vector epistemology
design](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md),
the [job-specific decision-vector
inventory](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/specs/2026-07-25-job-specific-decision-vector-inventory-design.md),
the [JSI fluid weight
layer](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/specs/2026-07-24-job-specific-intelligence-fluid-weight-layer-design.md),
and the [dimension sign
audit](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/docs/superpowers/audits/2026-06-14-principle-dimension-sign-audit.md).

Mathematics and external prior art: [Vector Decisioning for JSI](vector-decisioning-and-jsi.md).
