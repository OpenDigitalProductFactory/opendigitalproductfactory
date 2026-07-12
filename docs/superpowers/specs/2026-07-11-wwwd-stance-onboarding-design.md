# Company-Stance Onboarding — priming the WWWD corpus so common business decisions clear the gate

- **Epic:** EP-0AF96937 — Decision Governance Surface (extends it: the *first-run* leg of the see → adjust → review loop)
- **Related BI:** BI-EBBBD275 (author the two escalated stances — the tactical instance of the gap this design closes systemically)
- **Date:** 2026-07-11 (design) · **updated 2026-07-12** (all phases shipped)
- **Status:** ✅ **Shipped** — founder go received 2026-07-11 ("deliver on this here locally"); all four build phases merged and live-verified on the local install. Build plan + phase→PR map: [2026-07-11-wwwd-stance-onboarding-build.md](../plans/2026-07-11-wwwd-stance-onboarding-build.md). See §12 for the shipped-state summary.
- **Kernel routing:** both design forks routed through `principle_decide` (`callingPopulation=external_coding_agent`, surface `stance-onboarding-design`), both **high confidence, no commandment conflict** — ledgers in §6.
- **UX-Fit:** new setup step + scenario-card capture → binds the UX-Fit gate (AGENTS.md §12/§16/§17). Reviewed in §7.4.
- **Adjacent:** the archetype **stance-vector derivation** this spec adds (`resolveStanceVectors`) is a member of the same archetype-derivation family the [Operational Twin Framework](2026-07-12-operational-twin-framework-design.md) builds on; that spec's cog-confirm HITL + needs-you quests are governed by the WWWD gate this spec primes. Cross-reference in §13.

---

## 1. Problem — verified live, arithmetically explained

Two real business decisions escalated to the founder on 2026-07-10 that the WWWD gate should have
handled:

| Decision | domainClass / riskTier | Live outcome | Why (verified in code) |
|---|---|---|---|
| DI-C9F8B475B652 — billing-error goodwill | `risk-assessment` / medium | **defer**, 0 materials | `seedOrgWwwdCorpus` seeds materials **only** in `plan-readiness` ([seed-org-wwwd-corpus.ts:346](../../../apps/web/lib/onboarding/seed-org-wwwd-corpus.ts)); the gate matches by exact `domainClass` ([material.ts:117](../../../apps/web/lib/decision-perspective/material.ts)), so the other three classes are empty → coverage gap. |
| DI-A190B8B3FEB7 — existing-customer quality vs new offering | `plan-readiness` / low | **escalate** @ 0.45 | The four seeded materials carry `evidenceGrade:"B"` (×0.75) × `confidenceWeight:0.6` = effective **0.45** — the exact live confidence. Below every recommendation band. |

Three structural facts govern any fix (all verified against
[evaluator.ts](../../../apps/web/lib/decision-perspective/evaluator.ts) /
[material.ts](../../../apps/web/lib/decision-perspective/material.ts)):

1. **The gate never reads the question text.** Confidence is the *mean of material effectiveWeights*
   in the matching `domainClass`, minus a risk penalty (medium −0.1) — a function of corpus *quality
   metadata*, not semantic relevance. The semantic layer (org-overlay WikiPages in Qdrant) grounds
   the coworker's *deliberation content*; the relational layer (`PerspectiveMaterial`) grants the
   *authority*. Both are written by the same seeding path.
2. **Crossing 0.55 is necessary, not sufficient.** The outcome ladder requires ≥ 0.7 to recommend at
   low risk and ≥ 0.9 at medium; `high`/`critical` always escalate regardless of corpus. The
   risk-posture knob (EP-ONBOARDING-INTAKE) moves the thresholds: conservative 0.65 / balanced 0.55 /
   progressive 0.5 + arbitration at medium risk from 0.8.
3. **The mean drags.** A confirmed grade-A stance coexisting with unconfirmed B/0.6 defaults in the
   same class pulls the class *below* the gate (A/1.0 + 2×B/0.6 → 0.633 < 0.7). Confirmation
   semantics must operate on the whole class bundle.

And one loop gap: the **escalation → founder-answer → corpus write-back** cycle is not closed.
`captureDecisionInteraction` is build-gated (`buildId` required — WWWD decisions have none), and
`candidateMaterial` is read by no promotion path. A founder can answer an escalated business
decision today and the corpus learns nothing.

## 2. Design goal

After first-run onboarding, a fresh org's coworkers can **autonomously clear the common low-risk
business decision classes** (and, under a progressive posture, arbitrate medium-risk ones) from the
org's *own confirmed stance* — with the owner answering **five plain-language scenario cards**, most
of them pre-answered by the archetype. Everything else stays escalate-first and is captured
just-in-time, so the corpus grows exactly where real decisions demand it.

**Non-goals.** No change to the evaluator formula, outcome ladder, autonomy-policy table, or any
schema/enum (kernel-decided, §6). No unlocking of high/critical-risk decisions — the simulation
asserts that invariant explicitly (§8). No long-tail stance interrogation at onboarding.

## 3. The coverage-vector set (Phase 2 result)

Decision classes enumerated from the live ledger, the tool's own framing, the archetype
`howWeDecide` corpus, and the attention sources; vectors chosen by coverage-per-question:

| Vector (plain-language card) | Unlocks decision classes | Gate bundle (domainClass) |
|---|---|---|
| **V1 Customer goodwill & remediation** — "when we caused the problem, what do we do, up to what amount?" | remediation/goodwill, per-customer policy exceptions, proactive disclosure | `risk-assessment` + echo in `professional-practice` |
| **V2 Pricing & discount integrity** — "honor a mistaken quote? match a competitor? discount ceiling?" | pricing exceptions, promo commitments | `risk-assessment` |
| **V3 Growth vs stability** — "existing-customer quality vs new offerings — where do we lean?" | prioritization, launch-vs-fix, staffing flex, marketing bets | `plan-readiness` |
| **V4 Quality bar** — "work is below our standard but 'acceptable' — redo at our cost?" | rework calls, rush-job/commitment exceptions | `professional-practice` |
| **V5 Spend authority** — "what can the business spend without asking the owner, per purchase?" | routine spend/restock, tooling adoption | `risk-assessment` + echo in `architecture-tradeoff` |

Already captured elsewhere (no new question): **mission / who-we-serve / how-we-decide / supplier
posture** (seeded pages, retagged into their bundles), **risk appetite** (the `riskPosture` knob →
autonomy policy). Folded: transparency/communication posture folds into V1+V4 card copy.

**80/20 evidence:** 5 questions cover 11 of the 12 enumerated decision classes (~2.2
classes/question). The 12th (supplier selection) is covered by the existing seeded supply-chain
stance re-echoed into `architecture-tradeoff`.

## 4. Archetype-first defaults

`resolveBusinessProfile` ([archetype-business-context.ts](../../../apps/web/lib/onboarding/archetype-business-context.ts))
already carries per-industry starter doctrine (17 industry categories + flagship overrides). This
design extends `ArchetypeBusinessProfile` with a `stanceVectors` block — one default choice + ceiling
per vector per industry, e.g.:

- *retail-goods*: V1 "make it right immediately" / $75 · V2 "honor our mistakes, discounts up to 10%" · V3 lean-stability · V4 redo-if-visible · V5 $200
- *healthcare-wellness*: V1 "make it right + owner notified" / $150 · V3 strong-stability · V4 never-compromise · V5 $500 (recurring clinical supplies)
- *professional-services*: V1 "remediate via extra work first, credit second" · V2 "never discount below cost of quality" · …

Defaults are **editable starters in the operator's own vocabulary** (same contract as the existing
profiles — broad, true, never fabricated specifics). The owner *confirms or adjusts*; they never
author from scratch.

## 5. The confirmation ladder (authority semantics)

| State | Material metadata | Effective weight | What it clears |
|---|---|---|---|
| Archetype default, unconfirmed (or step skipped) | B / 0.6, approved+promoted | 0.45 | Nothing — identical to today's behavior. Honest: the org hasn't said it yet. |
| **Owner-confirmed** (onboarding step or later adjust) | **A / 0.9** | 0.9 | Every **low-risk** class under every posture (0.9 ≥ 0.7); **medium-risk arbitration** under progressive posture (0.8 ≥ 0.8). |
| **Human-ruled** (JIT capture from a real escalated decision) | **A / 1.0** | 1.0 | A fully human-ruled class reaches mean 1.0 → **medium-risk recommends even under balanced** (0.9 ≥ 0.9). |

Confirmation upgrades the **whole class bundle** (including the retagged mission/who-we-serve
echoes shown on the step's summary) — the mixed-drag hazard (§1.3) makes per-material upgrades
self-defeating. Skipping the step leaves everything at the unconfirmed tier; no regression.

Graduation story: **0.45 (default) → 0.9 (confirmed) → 1.0 (ruled)** — autonomy is earned by the
org saying so, then proven by the org ruling so. High/critical never unlock (evaluator invariant).

## 6. Kernel decision ledgers (routed before design commitment)

**D1 — vector applicability architecture.** Options: (a1) seed vector bundles within the existing 4
domainClasses, no engine change; (a2) extend `DecisionDomainClass` with business-topic enum values;
(a3) activate the dormant `domains[]` field as topic tags with additive `isMaterialApplicable`
sub-matching. → **a1 wins, composite 8.708 vs 7.079 (a3) / 5.783 (a2), margin 1.629, high
confidence, no commandment conflict.** Top contributors: *Never Fabricate*, *evidence discipline*,
*Build Gate*. The known weakness of a1 — class-level confidence conflates topics within a class — is
accepted and mitigated by the 80/20 vector coverage plus JIT capture; a3 is the recorded follow-up
if topical honesty proves insufficient in practice (re-weigh with live escalation evidence).

**D3 — capture surface placement.** Options: (c1) fold cards into the business-context step; (c2) a
dedicated skippable "How you decide" setup step; (c3) JIT-only, no onboarding surface. → **c2 wins,
composite 8.431 vs 7.012 (c1) / 6.501 (c3), margin 1.419, high confidence.** One mental frame per
step ("this is how your AI decides"), anchors the adjust/review loop, and keeps business-context from
mixing identity facts with decision policy.

Resolved by evidence rather than the kernel: **bundle-vs-per-material confirmation** (simulation §8
shows per-material mixing drags below the gate) and **evaluator/band changes** (not needed — the
target decisions clear within existing bands and postures).

## 7. The capture UX ("How you decide" setup step)

### 7.1 Placement & shape

New `SETUP_STEPS` entry `how-you-decide` immediately after `business-context`
([setup-constants.ts](../../../apps/web/lib/actions/setup-constants.ts)). Skippable like its peers.
One screen, five **scenario cards**, each:

- a one-sentence everyday scenario in the archetype's vocabulary (no jargon — never "domainClass",
  "confidence", "stance material");
- 2–3 plain-language choices with the **archetype default pre-selected**;
- V1/V2/V5 carry a small ceiling picker (archetype-suggested amounts) — the number the business can
  act up to without asking.

Example (retail): *"An order arrives damaged and it's our fault. What's our default?"*
◉ Make it right on the spot — replace or refund, up to **$75** · ○ Make it right after checking with
the owner · ○ Always check with the owner first.

### 7.2 Cognitive-load budget

Owner reads a short intro line ("Your AI checks these answers before acting on business calls. We've
pre-filled them for a business like yours."), then **one decision per card, five cards, every card
pre-answered**. The fast path is *Confirm all* (one click). Adjusting is per-card, inline, no
sub-forms. A footer line shows the already-captured frame ("Based on your mission and who you serve"
with the two one-liners) so confirming legitimately covers the retagged bundle echoes. Estimated
completion: < 60 seconds on the fast path.

### 7.3 What confirm/adjust/skip writes

- **Confirm/adjust** → per vector: an org-overlay `WikiPage` (`stances/<vector>` slug, `pageKind:
  "stance"`, `status:"published"`, embedded via `storeWikiPage`) with the chosen text + ceiling, plus
  `PerspectiveMaterial` rows in the vector's bundle classes at **A / 0.9**; the pre-seeded pages'
  materials in confirmed classes upgrade to A / 0.9 (bundle semantics, §5). Idempotent upserts keyed
  on stable ids, mirroring `seedOrgWwwdCorpus`.
- **Skip** → seeding still happens (vector pages + materials at B / 0.6) so the *content* layer can
  ground deliberation and the step can be completed later from `/wiki/stance`; the *authority* layer
  stays at today's escalate-everything behavior.
- Ceilings additionally land in the stance body text (the coworker's deliberation reads them
  semantically) — no new schema field.

### 7.4 UX-Fit review (AGENTS.md §12/§16/§17)

- **First-viewport**: one intro line + five cards; no tables, no tabs, no metric tiles.
- **Progressive disclosure**: fast path = one click; per-card adjust is the only second level; the
  full stance editor (`/wiki/stance`) remains the advanced surface, linked once at the bottom
  ("Fine-tune later in Decision Governance").
- **No over-exposed controls**: no weights, grades, thresholds, or domain classes anywhere; ceilings
  are concrete dollar choices, not free numeric inputs (curated options + "other").
- **Non-technical readability**: every card is answerable by a business owner with no platform
  vocabulary; defaults mean zero-answer completion is acceptable.
- **Nav/IA**: no new nav entry; the step lives in setup and completion redirects into the existing
  flow. The same cards render inside `/wiki/stance` (Decision Governance → WWWD → Adjust) for
  later editing — one component family, two mounts (no duplicate surface).

## 8. Simulation evidence (Phase 4)

Committed as a real-evaluator backtest
([stance-onboarding.simulation.test.ts](../../../apps/web/lib/decision-perspective/stance-onboarding.simulation.test.ts))
— 8 tests, driving `evaluateDecisionPerspective` (no mocks) across 6 corpora × 3 postures × 6
scenarios (108-row matrix), including the two live escalations:

| Evidence | Result |
|---|---|
| Current seed reproduces the live failures | quality-vs-offering **escalate @ exactly 0.45**; billing-goodwill **defer, 0 materials** ✅ |
| Unconfirmed archetype defaults (B/0.6, all classes) | **never** clear the gate, any posture — confirmation is structurally the lever ✅ |
| Confirmed bundles A/0.85–0.9 | **every low-risk scenario clears under every posture** (recommend, or arbitrate under progressive) — includes DI-A190B8B3FEB7's class ✅ |
| Billing-goodwill (medium risk, DI-C9F8B475B652's class) | clears via **progressive posture + A/0.9 → arbitrate @ 0.8**; or **fully human-ruled class (A/1.0) → recommend @ 0.9 even under balanced**; stays escalated otherwise — the honest trust story ✅ |
| Mixed confirmed + unconfirmed in one class | drags to 0.633 < 0.7 → **bundle upgrade semantics required** ✅ |
| **Safety invariant** | high-risk always escalates, even at A/1.0 under progressive ✅ |

Post-build acceptance re-runs the same two questions through the live
`evaluate_org_business_decision` tool on a primed install (BI-EBBBD275's acceptance criteria fold
into Phase 1 below).

## 9. External research (Phase 1b)

Deep-research sweep (104 agents, multi-source, 3-vote adversarial verification per claim; all
retained findings survived 3-0). What comparable production systems do, and what it confirms or
corrects here:

| Finding (confidence) | Design consequence |
|---|---|
| Production support-AI platforms encode company stance as a **bounded set of plain natural-language policies** — Gorgias "Guidance" (≤100/store, highest-priority knowledge layer), Intercom Fin Guidance (brand voice/policies in natural language, applied at response time). (high, 3-0) | Validates stance-as-plain-language WikiPages over structured rule trees; validates *bounding* the set (5 cards, not an open questionnaire). |
| Fin's shipped starter taxonomy is **five guidance categories**. (high) | Independent convergence on a ~5-dimension minimum viable stance set. |
| Escalation stance ships as **three layers**: zero-config defaults (ask-for-human, frustration, loops) + a configurable layer (rules + NL guidance) + a **non-configurable safety floor** (Gorgias second-model confidence QA that merchants cannot lower). (high, 3-0) | Maps exactly onto: archetype defaults → posture/ceiling adjustments → the evaluator's unconditional high/critical escalation. The floor stays non-configurable. |
| Pre-AI **Delegation-of-Authority** practice converges on few (5–8) role-based authority levels with thresholds; DMN decision tables make policy machine-executable. (high) | Validates the ceiling pickers (curated authority levels, not free numerics) and the vector count. |
| **A documented policy without system enforcement does not change decision behavior** — stance must be embedded in the operational tooling. (medium, 3-0) | Confirms the dual-layer design: stance *text* alone (WikiPages) is not enough; the `PerspectiveMaterial` authority layer is the enforcement. Also why §10 Phase 4 (publish→promotion) matters — an authored-but-unpromoted stance is a policy PDF. |
| **Under-priming is the asymmetric failure**: users abandon algorithmic deciders disproportionately after witnessing errors (Dietvorst algorithm-aversion studies); early interactions are decisive for calibrated trust. (high, 3-0) | Strong evidence for up-front priming over JIT-only (independently matches kernel D3's rejection of c3): if the first week is all escalations and misses, trust never forms. |
| **Adjustable automation is trusted more than fixed automation.** (medium, 3-0) | Validates confirm-and-adjust over locked archetype defaults, and the visible ceilings. |
| **Progressive disclosure** measurably lowers learning cost and errors when the core/advanced split is right. (high, 3-0) | Validates 5 pre-answered cards up front, full stance editor behind "fine-tune later". |
| Direct evidence that over-questioning at onboarding causes abandonment was **not found** — it survives only by analogy to progressive-disclosure findings. (caveat) | Honestly noted; the 5-card bound is justified by coverage-per-question and the disclosure evidence, not by an abandonment statistic. |

## 10. Phasing & backlog

Each phase independently shippable; the operator can stop after any. **All shipped** (2026-07-11/12);
the design phases below map onto three build PRs (grouped in the [build plan](../plans/2026-07-11-wwwd-stance-onboarding-build.md)).

- **Phase 0** ✅ — spec + simulation backtest + BIs (PR #2784). No production code.
- **Phase 1 — Archetype stance-vector defaults + seeder redistribution** (**BI-70ADC71F**) ✅ **PR #2800**:
  extended `ArchetypeBusinessProfile` with `stanceVectors` (`resolveStanceVectors`); `seedOrgWwwdCorpus`
  seeds a `stances/<key>` page + per-class `PerspectiveMaterial` bundles (B/0.6) across all four domain
  classes and retags the original four pages into their bundles; a **shape-aware boot backfill** carries
  the redistribution to already-onboarded installs.
- **Phase 2 — "How you decide" setup step** (**BI-D6DC2432**) ✅ **PR #2837**: the §7 card UI
  (`HowYouDecideCards`) + confirm/adjust/skip write paths + bundle-upgrade semantics (`confirmStanceVectors`);
  same cards mounted in `/wiki/stance` for later adjustment.
- **Phase 3 — JIT capture write-back** (**BI-9677364B**) ✅ **PR #2812**: `captureOrgDecisionOutcome`
  non-build capture path for WWWD escalations — owner answers from the `/wiki/review` "Waiting on your
  call" cards, optional "remember this" writes a ruled (A/1.0) `stances/ruling-<id>` page and sets
  `humanOutcome`. Closes the loop found open in §1.
- **Phase 4 — Stance publish → promotion** (**BI-002DEB85**) ✅ **PR #2812**: `publishBusinessStance`
  publishes + embeds a `/wiki/stance` draft and promotes an owner-confirmed (A/0.9) `PerspectiveMaterial`
  in the picked decision area — an authored stance is now gate-live instead of an inert draft.

The confirm/promote/rule write path is unified in `lib/decision-perspective/stance-promotion.ts`
(`promoteStanceMaterial`, tiers `confirmed` A/0.9 / `ruled` A/1.0, never-downgrade).

## 11. Founder go/no-go — resolved

The three go/no-go questions were answered by the founder go ("deliver on this here locally", 2026-07-11)
and are settled in the shipped code:

1. **Ceiling defaults per archetype** — shipped as editable per-industry starters in
   `INDUSTRY_STANCE_VECTORS` (goodwill/pricing/spend); the owner confirms or adjusts each via a curated
   ceiling picker. Not free-authored.
2. **Medium-risk posture story** — shipped as the honest ladder: balanced-posture orgs keep escalating
   medium-risk decisions until a class is fully human-ruled (A/1.0 → recommend @ 0.9); progressive posture
   arbitrates medium-risk from A/0.9. No aggressive auto-opt-in to progressive.
3. **Step title** — shipped as **"How you decide"** (`STEP_LABELS["how-you-decide"]`).

## 12. Shipped state (2026-07-12)

- **Merged:** #2784 (design), #2800 (Phase 1), #2812 (Phases 3+4), #2837 (Phase 2). BIs BI-70ADC71F /
  BI-D6DC2432 / BI-9677364B / BI-002DEB85 → **done**.
- **Live-verified** on the local install (`:3000`, redeployed at the merge SHA): the org's WWWD corpus
  now carries archetype-default material in all four decision classes; the two originally-escalated
  decisions reproduce the pre-confirmation rung exactly — billing-goodwill `escalate @ 0.35` and
  quality-vs-offering `escalate @ 0.45`, both now **from the org's own profile** (not platform fallback) —
  and the high-risk probe still escalates (invariant holds).
- **The last rung is the owner's, by design:** a Confirm-all at `/wiki/stance` (or a ruling via the
  `/wiki/review` capture loop) upgrades the bundle to A/0.9+ and clears the low-risk classes. The AI never
  self-confirms — consent is the mechanism, not a gap. **BI-EBBBD275** (the two specific founder rulings)
  stays open for exactly this reason: the tooling to satisfy it is live, but authoring the two standing
  answers is a one-click owner action, not an engineering task.

## 13. Adjacency — the Operational Twin Framework

The [Operational Twin Framework](2026-07-12-operational-twin-framework-design.md) derives a per-archetype
"twin" from the archetype's operating-model surfaces. Its `deriveTwinProfile` family and the
`resolveStanceVectors` derivation this spec added are **two consumers of the same archetype substrate**,
and they meet at the twin's **cog**: when the cog proposes an allocation that carries a business judgment
(comp/waive, spend, priority), that tap-to-confirm is exactly an `evaluate_org_business_decision` call,
and an escalation is exactly a **needs-you quest** — answerable in place through the capture loop this spec
shipped (the `/wiki/review` "Waiting on your call" pattern). See that spec's §5.1 (added by this PR) for
how the stance-vector derivation sits in its derivation family and how the cog/quest primitives bind to the
WWWD gate. Incorporation shape kernel-routed: `principle_decide` → additive cross-reference, high
confidence, margin 3.59 (DI-4E2943E733A7).
