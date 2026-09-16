---
status: active
---

# WWWD decision over-escalation — diagnosis and rebalance plan

**Date:** 2026-09-16
**Epic:** EP-DECISION-TIER-REBALANCE (related: EP-1C37C089 — TAK alignment control surface)
**Umbrella item:** BI-7728C3B7
**Measured on:** customer 0 install (production), tree `d721935be`

---

## 0. Root cause, established 2026-09-16 — WWWD has no scope-admission test

Operator direction raised this to priority: *"all installs of this platform will have a conflated
starting point that will cause endless confusion until mitigated properly."* It is upstream of
everything in §2–§4, and it reframes them.

[decisions-belong-to-their-scope](../../founder-kernel/wiki/principles/decisions-belong-to-their-scope.md)
(core tier) requires: **"Before deciding, name which scope owns the question"** — platform/build to
WWMD, the organization's own business call to WWWD, craft to WSID — and "a deferred decision goes to
the right person, not a generic queue."

**No step in the WWWD initiation path performs that naming.** Two doors let anything in:

**Door A — consequence used as if it were scope. ALREADY FIXED; corrected 2026-09-16.**
`runTakAlignmentGate()` routed *every* consequential tool call into
`evaluateOrgBusinessDecisionGate`, with hardcoded `options: ["Proceed","Decline"]` and a question
composed mechanically from the tool name. That was real, and **BI-63B14D4B / PR #5260**
(`95f80bdc2`, 2026-09-09) closed it: `ToolDefinition.consequenceScope` is declared with the
consequence, and `consequential-tool-policy.ts` `alignmentRequiredFor()` skips the WWWD gate for
`consequenceScope: "platform"`. Its doc comment cites decisions-belong-to-their-scope by name.

Verified on the live DB: **zero** org-business decisions from any platform tool after 2026-09-09.
An earlier draft of this plan presented those rows as a live defect; they are residue from a fixed
one. The concept and substrate already exist and work.

What that leaves is **residue**, and it is the dominant queue problem. Unresolved org-business
escalations by route:

| routeContext | unresolved | last |
|---|---|---|
| `/platform/ai/operations` | **37** | 2026-09-09 |
| `/ops/demand` | 10 | 2026-09-06 |
| `/coworker-business` | 3 | 2026-09-01 |
| `/ops/workrooms` | 1 | 2026-09-07 |
| `/tool/create_portal_pr` | 1 | 2026-09-07 |
| `/tool/run_hive_scout_ingest` | 1 | 2026-08-31 |

**39 of 53 are residue from the now-fixed defect** — 37 of them the identical question
"run hive scout ingest: " from a scheduled task. Nobody will ever answer them, and they bury the
genuine items. The platform has no notion of **retracting a pending decision whose routing basis no
longer holds**: when a tool was reclassified, every pending row it produced became a question the
gate would no longer ask. A fix that stops producing bad rows but leaves the old ones is half a fix.

**Door B — authored questions get no scope test. LIVE.** The six field-service decisions arrived
via `/coworker-business` asking about employee-location capture, evidence-photo PII and lawful basis
per jurisdiction — on a **field-service** product surface, asked of a **software-platform** org's
business stance. They are craft/compliance (WSID), or platform/product (WWMD), or a customer's own
archetype — not "what would this software-platform business do." The operator's own ruling on
DI-F1666B2E39BA says so directly: the question *"required proper research into laws and contracts
that are established for the specific business"* — it was not yet a decision.

Those rulings are now `ruled`-tier stance material in a software-platform org's WWWD corpus,
describing field-service privacy. That is the conflation hardening into doctrine, which is exactly
why D4 authors criteria before answers.

**The archetype substrate exists and is simply not consulted.** `StorefrontArchetype` /
`storefrontConfig.archetype` is already surfaced to coworkers (`mcp/org-context-bundle.ts:170`,
`tak/route-context/providers/compliance.ts:65`). Extend it; do not build a parallel store.

**Why this is upstream.** A decision that should never have entered WWWD then hits the
constitutional-ambiguity veto (§2 — a tool name carries no market/product/motion criteria by
construction), can never be settled by a ruling (D2 — wrong corpus), and would poison the baseline
corpus if primed against (D4). Fixing admission first shrinks what the rest must cover.


## 1. The gap, measured

WWMD auto-resolves; WWWD escalates almost everything it touches. 30-day `DecisionInteraction`
totals by `gateKey` on the live install:

| Gate | Discipline | recommend / arbitrate | escalate | escalate rate |
|---|---|---|---|---|
| `kernel-consult` | WWMD | 170 | 14 | **7.6%** |
| `backlog-triage` | — | 297 | 0 | 0% |
| `org-business` | **WWWD** | 1 | 74 | **98.7%** |

Unresolved `org-business` escalations (`humanOutcome IS NULL`), attributed by rationale:

| Cause | Count |
|---|---|
| **Constitutional-ambiguity veto** | **62** |
| `aligned-not-settled` (BI-F5F2869D) | 1 |

The owner's WWWD queue is not a queue of hard calls. It is one defect, repeated 62 times.

## 2. Root cause — proven, not inferred

### 2.1 What actually fires

`apps/web/lib/decision-perspective/alignment-criteria.ts` → `extractAlignmentCriteria()`
classifies every business decision with a **hardcoded regex taxonomy shaped by the original
toaster / coffee-shop / MSP test fixtures**. The only products it recognises are toasters,
coffee shops, subscriptions and the literal tokens `software` / `platform`; the only geography
it knows is `alaska`; the only customer types are fishermen, MSP partner, software teams,
consumer.

`complete = Boolean(product && (market || motion))`. Anything outside that vocabulary returns
`status: "ambiguous"`, and `evaluateConstitutionalAlignment()` then short-circuits to
`verdict: "escalate"` with `checks: []` — **without reading the stance corpora at all**.

`constitutional-alignment-application.ts` → `applyConstitutionalAlignment()` then **overwrites an
already-computed, valid directional verdict**, setting `outcomeType = "escalate"` and
`stanceAlignment = "none"` while leaving the coverage-computed `confidenceScore` in place. That
is precisely the operator-observed signature: a uniform, meaningless `0.75` beside
`stanceAlignment: "none"`.

Probe over the 19 live open reviews, running `extractAlignmentCriteria` directly on each
question: **18/19 return `ambiguous`** → force-escalated before any stance, confidence or
embedding is consulted. The single `complete` case (DI-BD8CB44CBFDC) escalated on the adjacent
branch: any corpus returning `unknown` also escalates.

### 2.2 Where the 0.75 comes from

`0.75 = bestDirectionalWeight 1.0 × |alignmentScore| 1 − RISK_PENALTY.high 0.25`.

It is a real number from the coverage path that is then discarded. The six repro rows
(DI-2410D48092E6, DI-2212A7571020, DI-F1666B2E39BA, DI-0BBA6D485E4F, DI-6019399F3422,
DI-A572F57B3764) all persist `stanceAlignment = null`, `relevanceMethod = null`,
`materialCount = 19`, `coverageGap = false`, `confidenceScore = 0.75`.

### 2.3 Causes ruled out by running them

Both hypotheses in the operator's brief were tested and **both are false**:

- **Embeddings are healthy.** Fresh call DI-0376F7CC3C71 (toaster, risk-assessment/medium)
  returned `relevanceMethod: "semantic"`, `stanceAlignment: "decline"`, `alignmentScore: -1`,
  confidence 0.9. The semantic retrieval path works and discriminates correctly. WWWD has **not**
  degraded to lexical.
- **The confidence-policy threshold is not the lever.** Fresh repro DI-2ADF8CFEE82A (the
  field-service location question at risk-assessment/high) computed `alignmentScore: 1`,
  confidence 0.75, `relevanceMethod: "semantic"` — a supportive, semantically-grounded verdict —
  and the constitutional layer discarded it. The threshold branch was never reached.

This is a **classification** failure, not a retrieval or calibration failure. Lowering the
threshold or re-embedding the corpus would change nothing.

### 2.4 Relationship to the anchor BIs

BI-7E1F128A (content discrimination) is genuinely fixed — §2.3 demonstrates it working. The
present defect is a *different layer*, shipped under the `criteria-veto` deliverable of
[the TAK alignment gate P1 plan](2026-08-13-tak-alignment-gate-p1-foundation.md), reintroducing
the same observable symptom by a new mechanism. BI-1452AD76 (stance → dimension vectors) is done
and is prior work this plan builds on, not a deliverable here.

## 3. Three independent escalation forces

Fixing the veto alone will **not** drain the queue. Three forces stack, and the plan must address
all three or the measured outcome will not move:

1. **Constitutional-ambiguity veto** (§2) — 62/63 of current residue.
2. **`aligned-not-settled`** — by operator ruling (BI-F5F2869D), an approve-direction decision
   escalates unless a `ruled`-tier stance already answers it. This is *intended*, and stays.
3. **High-risk approvals** always escalate.

### 3.1 The tension this plan must not paper over

Force 2 interacts badly with the priming programme. `coverage-scoring.ts` `isRuledTier()`
(`evidenceGrade === "A" && confidenceWeight >= 1`) means *a human ruled on a real decision*, and
`settledByRuling` gates autonomous approval on it. BI-7728C3B7 forbids fabricating an owner
ruling, so **baseline seeds must not be minted at `ruled` tier** — which means baseline stances
cannot, by construction, satisfy `settledByRuling`.

Therefore priming alone cannot lower the approve-path escalation rate. A baseline stance must be
able to **pre-authorize a decision class** as a distinct concept from an owner ruling. That is
D3, and it is a prerequisite for D4 delivering its measured outcome — not an optional extra.

## 4. Deliverables

One BI, one branch, one PR each.

| Key | BI | Deliverable | Depends on |
|---|---|---|---|
| `retract` | **BI-13C38318** (pt 1) | Retract pending decisions whose routing basis no longer holds; backfill the 39 obsolete rows | — |
| `admission` | **BI-13C38318** (pt 2) | Name the scope for authored questions before the org-business gate asserts authority; refuse rather than guess | — |
| `criteria` | **BI-7728C3B7** (pt 1) | Elicit, per archetype, the criteria for initiating WWWD at all | `admission` |
| `veto` | **BI-9E1E1939** | Constitutional alignment stops force-escalating: corpus-grounded criteria extraction; ambiguity abstains instead of vetoing | `admission` |
| `settledness` | **BI-F5F2869D** | Settledness by absolute question↔ruling similarity rather than rank within the scored set | `veto` |
| `posture` | **BI-B8DF2861** | Routine-op pre-authorization posture + semantic duplicate/pending-match suppression | `admission` |
| `priming` | **BI-7728C3B7** (pt 2) | Baseline WWWD stance corpus, only for classes `criteria` admits | `criteria`, `posture` |

### D0 — `retract` + `admission` (BI-13C38318) — root, do first

**Part 1 — retract obsolete pending decisions.** When the routing basis changes (a tool reclassified
to `consequenceScope: "platform"`), retract the pending WWWD rows that basis produced, recording
why, and backfill the 39 existing ones. Never silently delete — retract with a reason the owner can
see. This is the largest single reduction in the owner's queue and needs none of Part 2.

**Part 2 — name the scope for authored questions.**

1. Classify WWMD / WWWD / WSID **before** the org-business gate asserts authority; route to the
   owning scope's corpus and the owning scope's human.
2. When scope cannot be established, return "not established as a business decision — here is what
   is missing", rather than an escalate card in the owner's business queue.
3. **Never default an unclassified authored question into WWWD.** Default-into-WWWD *is* the
   conflation.
4. Consult the existing archetype substrate (`StorefrontArchetype`) rather than adding one.
5. Declare `consequenceScope` explicitly on the 8 outward tools that currently default to
   `business`, so the classification is a claim rather than an omission.

Guard: no decision reaches the org-business gate without a recorded scope classification.

### D1 — `veto` (BI-9E1E1939)

Highest leverage: addresses 62 of 63 unresolved rows.

1. Replace the fixture-shaped regex taxonomy with extraction grounded in the org's own published
   stance / portfolio / GTM corpora, reusing the semantic layer the relevance path already uses
   successfully.
2. **Ambiguity must abstain, not veto.** A veto is for a *detected boundary breach*; failure to
   parse is not a finding. When criteria cannot be established, leave the computed directional
   verdict standing.
3. Never overwrite `stanceAlignment` with `"none"` when the coverage path measured a real value —
   the recorded value must stay faithful so the queue's displayed reason is honest.
4. **Regression risk to protect:** the genuine boundary veto (toaster / coffee-shop) must still
   decline, citing the corpus boundary.

### D2 — `settledness` (BI-F5F2869D)

Already open with its fix direction stated from live evidence (DI-ED7F5EC2CED6): settledness is
currently tested by relevance *rank* within the scored set, so a generic stance can out-rank a
specific ruling. Rank is relative; settledness is absolute. Test question↔ruling similarity
directly. Carries the operator's requirement that the owner's own ruling wins relevance and can
clear the threshold.

### D3 — `posture` (BI-B8DF2861)

1. Classify routine operational actions out of the WWWD business-decision path, governed by an
   operational posture the owner sets once. Live instances: `"run hive scout ingest: "`
   (DI-03E1EB6A75C2), `"create portal pr: "` (DI-0AE6533B5AD4),
   `"create marketing campaign: …"` (DI-5ACFD02ACF1B).
   **Check `apps/web/lib/federation/operational-posture-*.ts` first (§1 verify-substrate-first)** —
   an operational-posture concept already exists and may extend rather than duplicate.
2. Semantic duplicate suppression against *unresolved* pending rows. Live: the Workroom-owner
   funding question escalated three times (DI-7A0E1390EE95, DI-BD8CB44CBFDC, DI-12FD5B8BDE8E),
   differing only in trailing rationale text — so matching must be semantic, not string equality.
   Seven of the 19 open rows are near-identical funding-sweep questions.
3. Resolution of a joined row resolves all instances. Never suppress against *resolved* rows.

### D4 — `criteria` + `priming` (BI-7728C3B7)

**Part 1 (blocking) — establish the initiation criteria.** Per archetype, elicit what makes a
decision a WWWD decision for this business: which classes it owns (vs WWMD, vs WSID, vs a
customer's archetype), what context must already be established before the question is answerable,
what it pre-authorizes as routine operation, and who owns it when it is not WWWD. This is
elicitation (`dpf-elicit-tacit-knowledge`), not authoring — ask the owner enough to establish the
criteria; do not infer them.

**Part 2 — baseline corpus**, only for classes Part 1 admits. Mirror WWMD's altitude (a baseline
stance is doctrine, not an instance). Candidate classes from the live queue, subject to Part 1:

- funding / prioritization posture (7 of 19 open rows)
- data-handling & privacy defaults — **note: the 6 field-service rows are the conflation case
  (§0) and are likely WSID/WWMD, not WWWD for this archetype; Part 1 decides**
- customer-goodwill ceilings
- partner / outreach rails (DI-AB432BFF8956)
- routine-op pre-authorization (consumes D3's posture)

Software-platform (customer 0) first, then generalize. **Baseline seeds are owner-refinable
starting stances, never owner rulings** (§3.1), and must not be minted at `ruled` tier.

## 5. Success measure

Re-run the §1 query after each deliverable. Target: the `org-business` escalate rate for covered
decision classes approaches the WWMD baseline (~8%, not 0% — genuine novel and high-stakes calls
*should* escalate), and unresolved rows attributable to constitutional ambiguity reach 0.

A regression guard asserts that ambiguous criteria extraction does not change `outcomeType`.

## 6. Cross-surface leak (operator question 5) — measured

Founder-actionable unresolved `DecisionInteraction` rows (escalate/defer, `humanOutcome` null,
`gateKey != profession`): **53**. By question:

| Rows | Question |
|---:|---|
| **39** | `"run hive scout ingest: "` |
| 5 | `Should we fund "Governed appointment of a Workroom…` |
| 5 | `Overlap scan (kernel-evolution discipline §4.3) fo…` |
| 2 | `For the two newly structured … partner prospects…` |
| 2 | *(empty question)* |
| 2 | `Choose the lowest-cognitive-load placement for fou…` |

**One question is 39 of the 53**, left pending by the defect fixed on 2026-09-09.

### Why the owner sees ~79 but the review hub shows 19

The two owner-facing surfaces read the same rows and only one of them collapses duplicates:

- `founder-review/queue.ts` `dedupeFounderReviewCandidates()` collapses by (perspective,
  profileLabel, normalised question) — hence 19 on the review hub.
- `attention/sources/ai-decision.ts` `loadAiDecisionItems()` did a plain `findMany(… take: 50)`
  with **no dedupe**, so it rendered the 39 identical rows as 39 separate cards.

So roughly three quarters of the owner's attention list was one obsolete question. Two distinct
defects sit behind that, and they need different fixes:

1. **No retraction** (owned by BI-13C38318). When `run_hive_scout_ingest` was reclassified
   `consequenceScope: "platform"`, every pending row it had produced became a question the gate
   would no longer ask. Nothing retracts them, so they are pending forever. This is the correct
   fix, at the ledger.
2. **Dedupe was not single-sourced** (fixed). The same rows, two surfaces, two behaviours. The
   normaliser is now exported from the review queue and imported by the attention source. The flood
   also exposed a **starvation** bug: `take: 50` was the render limit applied in SQL, so a genuine
   decision ranked below 50 identical rows was never loaded at all — not merely buried. The loader
   now reads a wide window, filters to actionable, collapses, then caps, and a collapsed card says
   how many times the question was asked so repeated demand stays visible.

**Not separately measured:** the attention feed aggregates ~20 non-decision sources
(`apps/web/lib/attention/sources/`) and is computed live rather than stored, so backlog-readiness,
approvals and the rest of the 79 were not sized in this pass. The decision-derived contribution is
the 53 rows above.
