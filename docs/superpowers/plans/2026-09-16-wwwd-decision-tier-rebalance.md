# WWWD decision over-escalation — diagnosis and rebalance plan

**Date:** 2026-09-16
**Epic:** EP-DECISION-TIER-REBALANCE (related: EP-1C37C089 — TAK alignment control surface)
**Umbrella item:** BI-7728C3B7
**Measured on:** customer 0 install (production), tree `d721935be`

---

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
| `veto` | **BI-9E1E1939** | Constitutional alignment stops force-escalating: corpus-grounded criteria extraction; ambiguity abstains instead of vetoing; never overwrite a measured `stanceAlignment` | — |
| `settledness` | **BI-F5F2869D** | Settledness by absolute question↔ruling similarity rather than rank within the scored set; a matching owner ruling clears the threshold | `veto` |
| `posture` | **BI-B8DF2861** | Routine-op pre-authorization posture + semantic duplicate/pending-match suppression | `veto` |
| `priming` | **BI-7728C3B7** | Baseline WWWD stance corpus per archetype, software-platform (customer 0) first | `posture` |

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

### D4 — `priming` (BI-7728C3B7)

Author a baseline WWWD stance corpus per archetype, mirroring WWMD's altitude (a baseline stance
is doctrine, not an instance), covering the decision classes the live queue actually shows:

- funding / prioritization posture (7 of 19 open rows)
- data-handling & privacy defaults (6 of 19 open rows — the field-service cluster)
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

## 6. Cross-surface leak (operator question 5)

The decision ledger is measured precisely above. On the wider "79 items waiting for the owner":
`apps/web/lib/attention/sources/ai-decision.ts` projects `DecisionInteraction` rows with
`outcomeType` escalate/defer and `humanOutcome IS NULL` into the owner's attention feed, filtered
by `isFounderActionable` — so **this same defect leaks into the attention surface**, it is not
confined to the decision-review hub.

Founder-actionable residue by gate (unresolved): `org-business` 63, `build-studio` 21,
unattributed 12 — `profession` (124 defer / 26 escalate) and `kernel-consult` (18) are filtered
out as advisory / agent-internal.

**Not separately measured:** the attention feed aggregates ~20 non-decision sources
(`apps/web/lib/attention/sources/`) and is computed live rather than stored, so the exact
composition of the 79 was not reproduced from the database in this pass. The decision-derived
contribution is the 63 above; the remainder is backlog-readiness, approvals and the other
attention sources, which this plan does not size. Sizing those is a separate measurement task.
