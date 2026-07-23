---
title: WWMD design-quality kernel gap — three-altitude reframe, two admitted dimensions, five design principles
authoredAt: 2026-07-22
authoredBy: mark-bodman
status: draft
specKind: design
backlogItem: BI-B5EA2FB2
epic: EP-0AF96937
relatedSpecs:
  - docs/superpowers/specs/2026-07-22-holistic-ux-system-and-agent-codification-design.md
  - docs/superpowers/specs/2026-05-24-founder-kernel-evolution-discipline-design.md
  - docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md
  - docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md
  - docs/superpowers/specs/2026-03-20-ux-usability-standards-design.md
relatedPlans:
  - docs/superpowers/plans/2026-05-22-principle-scope-refactor.md
  - docs/superpowers/plans/2026-05-26-portal-ux-simplification-spine.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/no-hardcoded-colors.md
  - docs/founder-kernel/wiki/principles/design-research-required.md
  - docs/founder-kernel/wiki/principles/optimize-for-the-whole.md
  - docs/founder-kernel/wiki/principles/destructive-actions-require-explicit-go.md
  - docs/founder-kernel/wiki/principles/schema-honesty-over-aspirational-naming.md
---

# WWMD design-quality kernel gap

## Summary

BI-B5EA2FB2 records that `principle_decide` cannot evaluate design/UX decisions,
evidenced by the binary UI-hygiene commandment **No Hardcoded Colors** showing up
as a top contributor across three unrelated design and scope decisions
(DI-B812A3E7713C, DI-35165F022B01, DI-F2CE9FF30BB7). The BI's diagnosis was
"the dimension registry has no design axes."

That diagnosis is correct but incomplete, and the part it names turns out to be
the smallest contributor. A substrate sweep on 2026-07-22 found **four
compounding causes** plus a defect that blocked the governed procedure for
fixing any of them:

- **Cause 0 (dominant, new):** the embedding provider is 404ing on this install,
  so every semantic retrieval returns empty *silently* and `principle_decide`
  consults **only commandments — 25 principles out of 162**. Filed as
  **BI-512FBD20**, priority 1. Everything the BI observed about design decisions
  is downstream of this.
- **Cause A:** commandment retrieval never filters by consumer context, so the
  kernel's single `ui`-context commandment enters every consult unconditionally.
- **Cause B:** short generic dimension vectors are near-universal high scorers —
  the math rewards under-specification.
- **Cause C:** the registry has no design axes (the BI's finding).
- **Cause D:** the discipline's own §4.3 overlap scan was unrunnable —
  **BI-85341A52**, fixed in this PR.

The resolution is not "add six design dimensions." It is a **three-altitude
reframe**: the kernel governs *where a surface lives and what it may do*; the
`dpf-ux-fit-review` gate renders the *verdict on a specific surface*; and the
already-seeded `ux-design` **WSID profession corpus** holds the *craft*. Design
quality is a WSID decision that is currently misrouted to WWMD by default.

Two dimensions are admitted (`operator_effort`, `legibility_of_consequence`),
four candidates are rejected with reasons, five design principles are drafted
for founder ratification, and the routing contract is specified.

Scope decision recorded as **DI-A6EF19F286ED** — `principle_decide` recommended
the hybrid option (composite 10.276, margin 1.674, confidence `high`, no
commandment conflict) over both "add the full design dimension family" and
"pure defer, no new dimensions." **Read that consult with §1.0 in hand:** it ran
against commandments only, so it is a directional signal, not a full-kernel
verdict, and it should be re-run once BI-512FBD20 lands. That it recommended the
option a human would defend anyway is reassuring, not confirming.

The kernel is also **not** design-blind, as the BI implied: `ui-surface-features.ts`
already scores interface-surface additions through `principle_decide` against
`remove-avoidable-failure-opportunities`, with measured visual cognitive load
blended in. This spec extends that precedent rather than opening a new front —
see §1.4a for the three shipped pieces it must build on.

## 1. Verified substrate truth (2026-07-22)

Every claim below was checked against `origin/main` at `a8976e0af` and the
running canonical install. Causes are ordered by size, which is **not** the order
the BI proposed them: the dimension registry turned out to be the smallest of
them.

### 1.0 Cause 0 — the kernel is running on commandments alone (the dominant cause)

`principle_decide` consults **only commandments** on this install. Of 162
published principles, 25 are commandments; ~85% of the kernel has been silently
absent from every governed decision.

Chain, verified end to end:

1. `apps/web/lib/inference/embedding.ts` requests `ai/nomic-embed-text-v1.5`.
   Docker Model Runner serves exactly one model, `docker.io/ai/qwen3.6:latest`.
2. Every embedding call 404s — `docker logs dpf-portal-1` carries a steady
   `[embedding] LLM inference returned 404`.
3. `generateEmbedding` returns null by design ("degrade silently, chat still
   works").
4. `apps/web/lib/wiki/embeddings.ts:225` — `if (!vector) return []` — so
   `searchWikiPages` returns empty for every query, with no error.
5. `principle-recall.ts` branches 2 (core) and 3 (contextual) both ride
   `searchWikiPages`. Only branch 1, commandments from Postgres, survives.

Measured, not inferred: consult **DI-A6EF19F286ED** reports
`appliedPrincipleCount: 18`, every row `tier: "commandment"`, zero core, zero
contextual — while flagging `structuredCoverage: "strong"` and
`semanticFallbackRatio: 0`. The consult reported itself well-grounded while
missing 85% of the corpus. `wiki_query` likewise returns `{"results":[]}` for
every query, verified against a term that must match a published commandment.

**This is the dominant cause of the BI's original observation.** With core and
contextual retrieval dark, only commandments can score — and the single
`ui`-context commandment is always among them. Filed as **BI-512FBD20**
(priority 1). Until it is fixed, no conclusion about "what the kernel weighs on
a design decision" is measuring the kernel; it is measuring the commandment
list.

### 1.1 The registry

`packages/db/src/wiki-taxonomy.ts:144` — `PRINCIPLE_DIMENSIONS` holds **18** axes
(the discipline spec's table still says 14; four were added for EP-SOVEREIGN-SOC).
Exactly one, `human_cognitive_load`, is a design vector. `PRINCIPLE_COST_DIMENSIONS`
holds four: `blast_radius`, `human_cognitive_load`, `vendor_lock_in`,
`business_disruption`.

The kernel now holds **95 principle files, 25 of them commandments**.

### 1.2 Cause A — commandment retrieval never filters by consumer context

`apps/web/lib/wiki/principle-recall.ts:213-231` retrieves commandments from
Postgres filtered by **population** and **ring scope** only.
`packages/db/src/wiki-store.ts:599-640` confirms the `where` clause: `pageKind`,
`status`, `principleTier`, `organizationId`, `principleAppliesTo`,
`principleRingScope`. There is **no `principleConsumerContexts` predicate
anywhere in the commandment branch.**

This is scope-refactor Phase B, proposed 2026-05-22, still open — the
discipline spec §2.2 flagged the gap and assumed Phase B would land. It has not.

Consequence: of the 25 commandments, exactly **one** carries
`principleConsumerContexts: [ui]` — `no-hardcoded-colors`. Because commandments
are *always injected* and never context-filtered, that `ui`-scoped commandment
enters **every** consult for its population. It is not being selected because a
design decision made it relevant; it is present unconditionally.

### 1.3 Cause B — short generic vectors are near-universal high scorers

`computeStructuredAlignment` is a **normalized dot product over the principle's
declared dimensions**. `no-hardcoded-colors` declares three:

```json
{"long_term_maintainability": 0.9, "reusability": 0.7, "schema_grounding": 0.5}
```

All three are generic engineering-positive axes. Any option described as
"maintainable, reusable, well-grounded" — which is *every* option a competent
agent drafts — normalizes to a high alignment. In the fresh consult run for this
spec (DI-A6EF19F286ED), `no-hardcoded-colors` scored **0.767** on the winning
option: third-highest of 18 commandments, on a decision that has nothing to do
with colour tokens.

So the "tell" the BI observed is only incidentally about design. A principle
with a short vector over generic axes scores high on almost anything. The
narrower the vector, the higher the normalized score — the math rewards
under-specification.

### 1.4 Cause C — the registry has no design axes (the BI's original finding)

Confirmed — and demoted. It is real, but it is the *smallest* of the four, and
it is only visible because Cause 0 removed everything that would otherwise
drown it out. The kernel is not failing to weigh design decisions because it
lacks design axes; it is failing to weigh **any** decision on more than its
commandment list.

The registry gap still matters for the reason §3 gives — two axes are genuinely
missing and genuinely commensurable — but "add design dimensions" would not
have fixed the reported symptom, because on this install those dimensions would
have been attached to core-tier principles that never reach a consult.

### 1.4a What already exists — do not rebuild it

The sweep found three shipped pieces this spec must extend rather than
reinvent. All three were absent from the BI's framing.

| Shipped | What it is | Consequence for this spec |
|---|---|---|
| `apps/web/lib/decision/ui-surface-features.ts` | A **design gate already wired into `principle_decide`**. `scoreUiSurfaceChange` derives a feature vector from interface-change signals (controls added/removed, justification, reuse breadth, clarifies-outcome) and scores "ship this surface" against a retire/rework baseline, grounded in `remove-avoidable-failure-opportunities`. It already blends measured `visualCognitiveLoad` from a vision model. | The kernel is **not** design-blind. There is a precedent, a rubric, and a working option-feature derivation. `operator_effort` belongs on its cost model, and `scoreUiSurfaceChange` becomes a second authoring consumer of the axis. §3 is an extension, not a new idea. |
| `apps/web/lib/decision/work-warrant-altitude.ts` (BI-8AB0E66D, **done**, EP-7B169558) | A shipped, pure, corpus-free classifier returning `{altitude: WSID\|WWWD\|WWMD, basis, confidence, needsOperatorConfirm, reasons}` from deterministic structural signals. | §7.1 originally proposed building an altitude classifier. One exists. The work is to **extend `classifyAltitude` with a design signal**, reusing `AltitudeVerdict`, not to add a parallel classifier in `perspective-intent.ts` (which is a message-text WWMD/WWWD classifier for coworker chat — a different seam entirely). |
| `apps/web/lib/ux-budget/` (merged 2026-07-22, EP-UX-SYSTEM L2) | Per-shell UX budgets + pure DOM measurement: `countVisibleFields`, `countPrimaryActions`, max choices per control (Hick's law), default-visible words with collapsed disclosure excised. Feeds agent prompts, CI checkers, and the migration league table from one source. | The measured-evidence contract this spec originally drafted is superseded — see §8. |

**Epic boundary.** EP-UX-SYSTEM (spec
`2026-07-22-holistic-ux-system-and-agent-codification-design.md`, rev 2) owns
design quality as *generation constraints and CI gates*: tokens, page shells,
budgets, route sweep, ARIA-snapshot hierarchy gate, perceptual metrics, judged
evaluation. It says nothing about `principle_decide`, `PRINCIPLE_DIMENSIONS`, or
decision altitude. **The kernel seam is the one plane it does not touch**, and
that seam is this spec's entire scope. The two meet at exactly one place: this
spec consumes EP-UX-SYSTEM's measurements as kernel evidence (§8).

*Note for whoever picks this up:* EP-UX-SYSTEM and its 18 BIs are cited in that
merged spec as filed, but no epic `EP-UX-SYSTEM` resolves in this install's
backlog and `BI-B9BE9A29` — whose code is merged — does not resolve either.
Worth reconciling before treating those ids as addressable here.

### 1.5 Cause D — the governed procedure for fixing this is unrunnable

The kernel-evolution discipline §4.3 prescribes the overlap scan as: *"call the
existing `principle_decide` MCP tool with the candidate principle's
`principleDirection` as a single option, and the full existing kernel as the
principle field. The contribution ledger names the closest matches by
alignment."*

Running exactly that for the five candidates in §5 returned **every contribution
zero**, `insufficientSignal: true`, and no recommendation (DI-69C4965333C3).

Root cause at `apps/web/lib/decision/option-scoring.ts:364`:

```ts
const useStructured = Object.keys(p.dimensionVector).length > 0;
```

Mode is selected **from the principle side alone**. A principle that has a
dimension vector always takes the structured path — so a *featureless* option
(the exact shape §4.3 prescribes) scores 0 against it, and the semantic path
never fires. BI-3C1A6451 previously added server-side embedding of the option
description for this case
(`apps/web/lib/mcp/packs/principle-decide-pack.ts:399-427`); that embedding is
computed and then never consulted for any vectored principle.

Net effect: **the promotion gate for every new principle is unrunnable**, not
just for design principles. Filed as **BI-85341A52**.

**Fixed in this PR.** `buildOptionScores` now selects mode from both sides via
`hasScoreableOverlap(option, principle)`: structured when the principle declares
a dimension AND the option scores at least one of those same dimensions,
semantic otherwise. Partial coverage (one or more shared dimensions) still
scores structured and still reports `missingDimensions`, so every caller that
supplies features is unaffected; only the zero-overlap case — where structured
alignment is arithmetically pinned to 0 and says nothing — falls through.
Regression tests in `option-scoring.overlap-scan.test.ts` pin the ranking
behaviour, the honest `structuredCoverage: "weak"` reporting, and the
BI-5CE7CF0B zero-signal guard for the genuinely-no-signal case.

The scan still cannot be *run* against the live kernel until BI-512FBD20 is
fixed, because the semantic path needs embeddings and this install cannot
generate them (§1.0). The fix and the running of it are separate gates.

## 2. The reframe

The BI proposed "WWMD decides governance/scope altitude; design quality defers
to `dpf-ux-fit-review`." That is right, and the substrate sweep sharpens it:
the third home already exists and is already populated.

| Altitude | Question it answers | Where it lives today | Wired? |
|---|---|---|---|
| **WWMD** (kernel) | Where does this surface belong, what may it do, who authorizes it, can the consequence be foreseen? | `principle_decide` + 95 principles | yes |
| **ux-fit-review** (gate) | Does *this specific* surface fit — `fits` / `fits-with-guardrails` / `defer` / `reject`? | `packages/dpf-skill-pack/skills/dpf-ux-fit-review/SKILL.md` | yes, but its verdict is not consumed as kernel evidence |
| **WSID `ux-design`** (profession) | What does the craft say — heuristics, POUR, contrast minimums, heuristic-evaluation method? | `docs/professions/ux-design/wiki/` (8 pages); registered in `docs/professions/registry.json` with `contextSlugs: ["ui"]` | seeded, but no design decision routes to it |

The gap is therefore **not** "the kernel lacks design principles." It is that a
design decision has no altitude classifier, so it falls through to WWMD by
default and lands in a field of engineering principles plus one unconditionally-
injected colour commandment.

`tierForProfileKind("profession") === "wsid"` already exists
(`apps/web/lib/wiki/decision-audit.ts:13`), and BI-1BE30A9A already made the
recorded tier derive from *the gate that ran* rather than the fallback-resolved
profile. The routing rail is built. Nothing drives it for design.

**The reframe in one line: design quality is a WSID decision that is currently
misrouted to WWMD. The kernel's job is not to score it but to recognise it and
hand it off — then consume the verdict as evidence.**

## 3. Dimensions admitted (2)

Each satisfies the discipline's §4.4 bar: an orthogonality claim against the
existing 18, and ≥2 authoring principles.

### 3.1 `operator_effort` — COST

> How many operations and how much elapsed time the operator must spend to reach
> their outcome on this surface. Higher = worse.

**Naming note.** The BI proposed `interaction_efficiency` "(COST axis)". That is
exactly the inversion the 2026-06-14 sign audit caught: a benefit-shaped name in
the cost list makes a positive weight reward the very cost the principle
opposes, which is how `never-wipe-db-for-code-fixes` once scored "wipe the db"
as its top-aligned option. Applying `schema-honesty-over-aspirational-naming`:
if it is a cost axis, name it for the cost. `operator_effort` joins
`PRINCIPLE_COST_DIMENSIONS`, and the existing sign-convention guard in
`seed-wiki-kernel.test.ts` enforces negative weights on it for free.

**Orthogonality claims:**

- vs `human_cognitive_load` — cognitive load is what the operator must *hold in
  their head*; operator effort is what they must *do*. They diverge routinely
  and the divergence is the design decision: a 12-step wizard of trivially
  obvious steps is low cognitive load and high operator effort; one dense
  configuration screen is the reverse. Collapsing them erases the trade-off.
- vs `speed_to_value` — delivery speed (how fast the team ships) versus
  operation cost (how fast the user finishes). Different subject entirely.
- vs `capacity_utilization` — platform and agent capacity, not human effort.

**Authoring principles:** `count-the-operations-to-outcome` (−0.9),
`disclose-before-you-add-a-surface` (−0.6), `one-home-per-capability` (−0.5).

**Existing consumer.** `ui-surface-features.ts` already derives an option-feature
vector for interface-surface changes and already carries the cost model this axis
belongs to — today it approximates operator effort with `human_cognitive_load`
alone, which is why "12 obvious steps" and "one dense screen" score the same
there. Adding `operator_effort` to `deriveUiSurfaceFeatures` is the cheapest real
test of whether the axis earns its place, and it can be done before any new
principle is authored.

**Measurement.** `apps/web/lib/ux-budget/measure.ts` supplies the per-surface
half of the score today — `countVisibleFields`, `countPrimaryActions`, max
choices per control. What it does not measure is the **journey**: operations
across screens to reach an outcome, which is what the clicks-to-outcome metric
under EP-COWORKER-RT actually counted. That gap is noted for EP-UX-SYSTEM in §8;
the axis is scoreable from per-surface signals in the meantime.

### 3.2 `legibility_of_consequence` — BENEFIT

> Before authorizing, can the operator foresee what will happen, to what, under
> whose authority, and how it is undone?

This is the axis the anti-YOLO concern in the BI actually names, and it is
already latent across the kernel — several authority principles currently
approximate it with `governance_compliance`, which is part of why
`governance_compliance` and `blast_radius` look ~70% co-linear (discipline spec
§7.2). Admitting it should *reduce* co-linearity, not add to it.

**Orthogonality claims:**

- vs `reversibility` — reversibility is whether it can be undone *after*;
  legibility is whether it could be foreseen *before*. Complementary and both
  needed: an irreversible action with a perfect preview is safer than a
  reversible one with none.
- vs `evidence_density` — evidence density is whether the system leaves a
  queryable record after the fact, for audit. Legibility is what the human sees
  before consenting. Opposite time direction, different consumer.
- vs `governance_compliance` — compliance is whether the declared rule is
  satisfied. A fully compliant action can still be completely opaque to the
  person authorizing it.
- vs `blast_radius` — reach versus visibility of that reach. Orthogonal by
  construction: large-and-legible is fine, small-and-opaque is not.

**Authoring principles:** `show-the-consequence-before-the-confirm` (+0.9), plus
the additive amendments in §6 to `destructive-actions-require-explicit-go`,
`propose-acknowledge-reassign`, and `human-in-the-loop-at-phase-boundaries`.

## 4. Dimensions rejected (4)

The BI floated six candidates. Four fail the admission bar and are routed to the
fit gate or to measured evidence instead. Recording *why* is the point: the
rejections are what keep the registry from bloating into noise.

| Candidate | Verdict | Reason |
|---|---|---|
| `information_hierarchy` | reject → measured gate | Rejected for a *different* reason than first drafted. It is not "unmeasurable" — EP-UX-SYSTEM D2 ships an **ARIA-snapshot hierarchy gate**, a deterministic diffable projection of the accessibility tree (roles, heading levels, nesting). But that is a **regression check on a rendered page**, not a 0..1 estimate an author can supply about an option that does not exist yet. Measured after, not weighed before. |
| `progressive_disclosure` | reject → principle, not axis | A construct choice, not an axis. The platform usability standards already prescribe *which* construct by relationship (`CollapsibleList` / `ExpandableCard` / `<details>` / drawer / route), and `ux-budget/scope.ts` already excises collapsed subtrees so disclosure is rewarded by the budget rather than taxed. It is a means to lower `operator_effort`, so it would be co-linear with the axis it serves. Becomes the principle `disclose-before-you-add-a-surface`. |
| `discoverability` | reject → measured evidence | Genuinely measurable (time-to-find), but only by a study, not by an author's estimate at decision time. Belongs in §8, consumed as a finding. |
| `learnability` | reject → measured evidence | Same: time-to-second-task is real and is not available when the decision is made. |

The shared test that separates §3 from §4 is worth stating plainly, because it
is the reusable rule: **an axis belongs in the registry when an author can
honestly score it for an option that has not been built yet.** Everything else —
however rigorously measurable once rendered — is evidence, and evidence enters
the kernel as a finding, not as a weight.

## 5. Design principles for founder ratification (5)

All five are **drafts pending founder ratification** — the discipline's §4.1
condition 2 (operator-ratified) is not yet met, and per the BI these are the
founder's to author. Tier, ring scope, and vectors below are proposals.

The §4.3 overlap scan **could not be run** — see §1.5. Scan results are marked
`PENDING` and are a merge blocker for each principle file; they unblock when the
defect in §9 is fixed.

### 5.1 `one-home-per-capability`
- **Tier** core · **Ring scope** `ring-2-workflow` · **Archetype** `route-domain-specific` · **Contexts** `[ui]`
- **Direction:** Give every capability exactly one canonical route home; secondary surfaces link to it and never restate it. Prefer a filtered view of the existing home over a new dashboard, tab, or route family.
- **Vector:** `{"operator_effort": -0.5, "long_term_maintainability": 0.7, "reusability": 0.6, "human_cognitive_load": -0.5}`
- **Why:** the single most-invoked rule in the fit rubric ("Do not approve a new dashboard when a section home or filtered view would do"). Adjacent to the `single-source-of-truth` commandment but distinct: that governs *data*, this governs *navigation and IA*. Expect the scan in the 0.70–0.85 band; the additivity paragraph is the one just given.

### 5.2 `disclose-before-you-add-a-surface`
- **Tier** core · **Ring scope** `ring-2-workflow` · **Archetype** `route-domain-specific` · **Contexts** `[ui]`
- **Direction:** When a surface outgrows its first viewport, disclose progressively inside the existing home using the canonical construct before adding a new route, tab, or dashboard band.
- **Vector:** `{"operator_effort": -0.6, "human_cognitive_load": -0.7, "reusability": 0.5}`
- **Why:** encodes the disclosure-construct table in `docs/platform-usability-standards.md` as a decision rule rather than a style note. Pairs with 5.1 (that one says *one home*; this one says *what to do when the home gets full*).

### 5.3 `count-the-operations-to-outcome`
- **Tier** core · **Ring scope** `ring-2-workflow`, `ring-4-sandbox-prod` · **Archetype** `route-domain-specific` · **Contexts** `[ui]`
- **Direction:** Judge a design by the operator operations and elapsed time to the operator's outcome, measured on the running portal — not by screens or features shipped.
- **Vector:** `{"operator_effort": -0.9, "evidence_density": 0.6, "human_cognitive_load": -0.3}`
- **Why:** the anchor author for `operator_effort`, and the only one of the five that makes design quality *falsifiable*. Grounded in the clicks-to-outcome metric recorded under EP-COWORKER-RT. Composes with `structural-verification-is-not-functional` — a route test proves the button exists, not that the outcome is reachable in a sane number of moves.

### 5.4 `show-the-consequence-before-the-confirm`
- **Tier** core · **Ring scope** `ring-1-coworker`, `ring-2-workflow` · **Archetype** `ai-coworker-universal`
- **Direction:** Every affordance that authorizes an AI action must state, before the confirm, what will happen, to what, under whose authority, and how it is undone.
- **Vector:** `{"legibility_of_consequence": 0.9, "human_cognitive_load": -0.4, "evidence_density": 0.4}`
- **Why:** the anchor author for `legibility_of_consequence`, and the UI-side counterpart to the existing authority commandments. Highest overlap risk of the five: `destructive-actions-require-explicit-go` and `outbound-actions-require-explicit-go` mandate **that** you ask; this governs **what the ask must show**. `propose-acknowledge-reassign` governs the handoff protocol, not the affordance. If the scan lands above 0.85 against any of them, the correct outcome is to *extend that principle's body* rather than ship a sixth near-duplicate — the discipline's default outcome is rejection.

### 5.5 `kernel-defers-design-quality-to-the-fit-gate`
- **Tier** core · **Ring scope** `universal-ring` (earned — see below) · **Archetype** `universal`
- **Direction:** The kernel decides where a surface belongs and what it may do; it does not score design quality by weighted sum. Design quality routes to the `ux-fit-review` gate and the `ux-design` profession corpus, and the kernel consumes the verdict and its measured evidence as inputs.
- **Vector:** `{"schema_grounding": 0.8, "evidence_density": 0.7, "governance_compliance": 0.5, "human_cognitive_load": -0.3}`
- **Why:** this is the reframe made into doctrine — the kernel declaring a boundary on its own competence. It is the highest-leverage of the five because it generalizes: any future "the kernel can't really weigh X" finding gets the same treatment (recognise the altitude, route to the profession that owns the craft, consume the verdict) instead of another dimension-family proposal.
- **Universal-ring justification:** binds at Ring 1 (a coworker choosing how to present an action), Ring 2 (Build Studio design phases), and Ring 4 (promotion gates consuming a fit verdict) — three of five rings, meeting the §4.2 bar.

## 6. Additive amendments to existing principle vectors

`legibility_of_consequence` was always latent in the authority principles; they
have been proxying it with `governance_compliance`. Adding the key is additive —
no existing key is removed or repurposed.

| Principle | Add | Rationale |
|---|---|---|
| `destructive-actions-require-explicit-go` | `legibility_of_consequence: 0.8` | The "explicit go" is only meaningful if the operator can see what they are consenting to. |
| `propose-acknowledge-reassign` | `legibility_of_consequence: 0.6` | A proposal the recipient cannot evaluate is not a proposal. |
| `human-in-the-loop-at-phase-boundaries` | `legibility_of_consequence: 0.7` | A phase-boundary stop with an illegible diff is a rubber stamp. |

Optional, decide at authoring time: `never-auto-execute-irreversible-or-estate-wide-response`,
`outbound-actions-require-explicit-go`, `prefer-reversible-containment`.

## 7. Design-altitude routing contract

Three changes, smallest first. None requires a new table.

**7.1 Classify the altitude — extend the shipped classifier.**
`apps/web/lib/decision/work-warrant-altitude.ts` (BI-8AB0E66D, done) already
returns `{altitude, basis, confidence, needsOperatorConfirm, reasons}` from
deterministic structural signals, and its `AltitudeVerdict` shape is exactly what
a design-altitude verdict needs. Add a `designSurface` signal to
`AltitudeSignals` and a rule that routes design-*quality* work to the `ux-design`
profession, reusing the existing basis/confidence/confirm contract. A consult so
classified resolves its governing profile to the `ux-design` **profession**
profile, which makes `tierForProfileKind` record it as `wsid` with no change to
the audit surface.

Do **not** put this in `apps/web/lib/wiki/perspective-intent.ts` — that module
classifies WWMD-vs-WWWD from *message text* for coworker chat, which is a
different seam with different inputs. Two altitude classifiers would be the
`single-source-of-truth` violation this spec exists to argue against.

One vocabulary hazard to resolve in the implementing BI: `classifyAltitude` uses
WSID to mean **task/job altitude** (small, leaf, cheap-if-wrong), while
EP-0AF96937 and `tierForProfileKind` use WSID to mean **profession/role tier**.
Today a medium UI change on a customer surface classifies WWWD, not WSID. The
two readings are compatible in spirit and *not* interchangeable in code; pick one
and document it before adding a rule that assumes the other.

**7.2 Return a deferral, not a score.** When the altitude is design *quality*
(as opposed to design *governance* — placement, authority, blast radius, which
stay WWMD), `principle_decide` returns an advisory deferral naming
`dpf-ux-fit-review` as the gate and the `ux-design` corpus as the craft source,
instead of a weighted-sum recommendation. The kernel is explicit about the
limit rather than producing a confident number over the wrong field. This is
`fail-fast-explain-clearly` applied to the kernel itself.

**7.3 Consume the verdict.** The fit gate's structured output (§Required Output
of the skill: decision, owning area, route family, persona, reuse, source truth,
evidence) becomes a recordable finding the kernel reads as evidence on the next
consult — closing EP-0AF96937's review-and-adjust loop for design decisions
specifically. `record_execution_evidence` and the existing decision-review
findings surface are the likely carriers; confirm at implementation.

**Prerequisite, not optional:** Cause A (§1.2) must be fixed or the routing is
cosmetic — a `ui`-scoped commandment will keep entering every non-UI consult
regardless of altitude. That is scope-refactor Phase B: add a
`principleConsumerContexts` predicate to the commandment branch of
`listPrinciplesByTier` and `recallPrincipleContext`, symmetric with the
ring-scope filter already there.

## 8. Measured-evidence contract — consume EP-UX-SYSTEM, do not rebuild it

This section originally drafted a measurement contract. That contract is
EP-UX-SYSTEM's, it is better researched, and part of it is already merged. This
spec's only job here is to name **which of its outputs the kernel consumes as
evidence**, and to flag the one measure nobody owns.

| Measure | Owner | Kernel use |
|---|---|---|
| Default-visible words, primary actions, visible fields, choices-per-control, tiny controls, next-action marker | `apps/web/lib/ux-budget/measure.ts` (merged) | Supplies the per-surface half of an `operator_effort` score |
| Route budget sweep + regression ratchet | EP-UX-SYSTEM L4 (BI-BD81682A) | League-table position is the evidence a design claim cites |
| ARIA-snapshot hierarchy gate | EP-UX-SYSTEM L4 / D2 | The structural finding the kernel consumes instead of scoring `information_hierarchy` |
| Perceptual metrics (AIM) | EP-UX-SYSTEM L4.5 / D3 | Deterministic visual evidence; regression-ratcheted |
| Fit verdict + required edits | `dpf-ux-fit-review`, upgraded attestation → measured artifact by BI-D967DEE0 | The verdict §7.3 consumes; ride that BI's `*.ux-fit.json` manifest rather than inventing a carrier |

**The one gap nobody owns: journey length.** Every measure above is
*per-surface*. Nothing measures operations across screens to reach an outcome —
which is precisely what the clicks-to-outcome metric under EP-COWORKER-RT
counted, and the thing `operator_effort` is named for. A route can pass every
budget on every screen and still take twenty moves end to end. Recommended to
EP-UX-SYSTEM as a sibling of the route sweep; recorded here so the gap has a
written home.

`structural-verification-is-not-functional` applies throughout: a passing route
test is not evidence that the design is good, only that the surface renders.

## 9. Sequencing

Phase 0 is a hard prerequisite — it is the tooling that makes the discipline's
own promotion gate runnable, and every later phase depends on it.

| Phase | Work | State | Blocks |
|---|---|---|---|
| **−1** | **BI-512FBD20** — restore the embedding provider, re-embed the corpus, and make the retrieval plane fail loud instead of returning `[]`. Nothing downstream is measurable until the kernel consults more than its commandment list. | open, priority 1 | everything |
| **0** | **BI-85341A52** — both-sides mode selection in `buildOptionScores` so the §4.3 overlap scan produces a ranking ledger. | **done in this PR** | 2, 3 |
| **1** | Scope-refactor Phase B: `principleConsumerContexts` predicate on the commandment branch of `listPrinciplesByTier` / `recallPrincipleContext` (Cause A), symmetric with the ring-scope filter already there. | open | 3, 4 |
| **2** | Founder ratifies the §5 principle set and the §3 dimension names, **after** Phase −1 lets the real overlap scans run. | blocked on −1 | 3 |
| **3** | Author the ratified principle files with real scans; add the two dimensions to `PRINCIPLE_DIMENSIONS` + `operator_effort` to `PRINCIPLE_COST_DIMENSIONS`; apply the §6 amendments; add `operator_effort` to `deriveUiSurfaceFeatures`. | blocked on 2 | 4 |
| **4** | Design-altitude rule on `classifyAltitude` (§7.1), deferral return (§7.2), fit-verdict consumption via BI-D967DEE0's manifest (§7.3). | blocked on 1, 3 | — |

The `deriveUiSurfaceFeatures` half of Phase 3 is the one piece that can move
early and independently: it needs no new principle, no ratification, and no
registry change beyond the axis itself, and it is the cheapest honest test of
whether `operator_effort` earns its place.

Cause B (short generic vectors scoring high on anything) is **not** fixed by
this spec. It is a property of the normalized-dot-product math — the fewer axes
a principle declares, the higher its normalized alignment on almost any option —
it affects the whole kernel rather than design decisions specifically, and it
warrants its own design pass: most likely a coverage penalty for narrow vectors,
or a minimum-vector-breadth lint on commandments. Recommended as a follow-up BI
under the same epic. Note it will become *more* visible, not less, once
BI-512FBD20 restores core and contextual retrieval — with 162 principles
reaching a consult instead of 18, a three-axis generic vector competes against
a much larger field.

## 10. Acceptance criteria

1. This spec merged via DCO-signed PR.
2. **BI-512FBD20 fixed**, and re-running a consult shows core and contextual
   principles in the ledger — the acceptance test is `appliedPrincipleCount`
   materially above the commandment count, with `tier` values other than
   `commandment` present. Until this is true, criteria 3–6 cannot be honestly
   evaluated.
3. Phase 0 merged with its regression test (**done in this PR**), and the §4.3
   overlap scan demonstrated runnable end to end against the five candidate
   directions on a live kernel.
4. Founder ratification of §5 and §3 recorded as a decision, not a chat reply —
   taken *after* criterion 3, with real scan numbers in hand.
4. Each ratified principle file carries a real `principleOverlapScan` block; any
   candidate scanning above 0.85 is folded into the existing principle instead
   of shipped.
5. `PRINCIPLE_DIMENSIONS` grows by exactly two, each with its orthogonality
   claim in the PR body and ≥2 authoring principles in the same PR.
6. A design-altitude consult records tier `wsid` and returns a deferral naming
   the fit gate.
7. BI-B5EA2FB2 closed citing the merged PRs.

## 11. Out of scope

- Cause B (vector-breadth scoring bias) — follow-up BI, §9.
- Pruning the existing co-linear pairs (`governance_compliance` ↔ `blast_radius`,
  `evidence_density` ↔ `schema_grounding`) — the discipline spec §9.5 already
  deferred this and nothing here changes that call.
- Any change to the `ux-fit-review` rubric itself. This spec routes *to* the
  gate; it does not redesign the gate.
- WWWD business-stance routing. Design altitude is orthogonal to the
  WWMD/WWWD perspective split.
- **Everything EP-UX-SYSTEM owns** — tokens, page shells, budget calibration,
  the route sweep, the hierarchy and perceptual gates, the critique corpus, the
  judge, the `ux-design-critic` coworker. This spec consumes their outputs as
  kernel evidence (§8) and adds nothing to that program.
- Repairing the embedding provider itself. BI-512FBD20 owns it; this spec only
  establishes that nothing here is measurable until it lands.
