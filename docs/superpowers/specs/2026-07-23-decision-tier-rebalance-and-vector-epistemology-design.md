# Decision-Tier Rebalance & Vector Epistemology — Design

- **Date:** 2026-07-23
- **Status:** Draft for review
- **Family:** WWMD (founder/platform) → WWWD (organization) → WSID (profession/role)
- **Origin:** Operator direction, 2026-07-23 — *"Some vectors on the WWMD level are better suited to be part of a specific AI coworker and corpus. The one generic corpus that was used to bootstrap this platform needs to be re-evaluated for specialists that can take on those criteria with greater rigor… I'd like this to be more objective than subjective, and add more vectors where there are more criteria to consider."*

---

## 0. What this spec is, and what it is not

The three-tier decision architecture is **built**. This spec does not re-propose it. It addresses what became true *after* it was built: the founding corpus was authored when only one tier existed, so it still holds content that now has a better home, and the vector space it scores into was sized for one tier rather than three.

Three prior findings were re-verified before drafting, and two working assumptions were **falsified**:

| Assumption going in | Verified reality |
|---|---|
| WSID is an unfilled slot | **False.** Shipped 2026-06-16 (BI-48B3CEC4, PR #2016): `kind: "profession"`, 23 families in `docs/professions/registry.json`, `profession-gate.ts`, `resolve-profession-profile.ts`, 170 corpus pages. |
| Nothing learns from recorded human verdicts | **False.** `stance-promotion.ts` ladders *material authority* on human rulings: `unconfirmed` 0.6 → `confirmed` 0.9 → `ruled` 1.0. |
| Core-tier signed vectors never reach structured scoring | **True, and already filed** — RC2 in `2026-06-05-situational-aware-decision-weighting-design.md`, open as BI-E1267C6D. |

Everything below is scoped to what those verifications left standing.

---

## 1. Problem — measured

### 1.1 The founding corpus is largely one profession's corpus

Of 95 kernel principles, **50 are already self-tagged `principleConsumerArchetype: route-domain-specific`** — by their own metadata, not universal doctrine. Classifying those 50 by subject:

| Candidate profession | Principles |
|---|---|
| **software-engineer** | **39** |
| devops-platform | 4 |
| data-architect | 2 |
| build-studio / scrum-master / qa-engineer / enterprise-architecture | 1 each |
| genuinely unmapped | 1 (`mirror-dont-migrate`) |

`all-changes-land-via-pr`, `dco-sign-off-required`, `branch-guard-before-implementation`, `always-push-after-committing` are a software-delivery professional's craft, not platform invariants. **~41% of WWMD is one specialist's corpus at doctrine altitude.**

Meanwhile the `software-engineer` profession corpus holds **9 pages** while 39 of its principles sit upstairs. The specialist is starved of exactly the content the kernel is bloated with.

This was not a mistake. The corpus was authored when WWMD was the only tier that existed. It became a defect the moment WSID shipped.

### 1.2 The vector space has collapsed to roughly a third of its declared width

Across the 95 principles: **average 3.6 dimensions each, of 19 available.**

| Concentration | Dimensions |
|---|---|
| Carry 39–68% of principles | `long_term_maintainability` (68%), `governance_compliance` (48%), `evidence_density` (46%), `speed_to_value` (42%), `blast_radius` (39%), `schema_grounding` (39%) |
| Used by ≤6% | `capacity_utilization`, `operational_independence`, `evidence_confidence`, `public_safety`, `vendor_lock_in`, `reversibility`, `business_disruption`, `customer_consent_state`, `data_privacy` |
| **Never used by any principle** | `cost_efficiency` |

**Effective rank ≈ 6, not 19.** When two-thirds of principles load the same axis, most decisions light the same contributors and tradeoffs stop discriminating. This is the geometric explanation for BI-B5EA2FB2 (`no-hardcoded-colors` surfacing at 0.843 on an unrelated decision) — that ledger is not glitching, it is reporting a rank-deficient space honestly.

Compounding it, RC2 (BI-E1267C6D) means the **60 `core` + 9 `contextual` + 1 `heuristic` = 70 of 95 principles have inert signed vectors**; only the 25 commandments score structurally. The measured concentration above is therefore an *optimistic* reading of what actually reaches a decision.

### 1.3 One flat closed space serves three tiers with different jobs

`PRINCIPLE_DIMENSIONS` is a closed `as const`; `DIMENSION_KEYS` validation rejects any unrecognised axis as `unknown-dimension`. All three tiers score into it. But the tiers do different work:

- **WWMD** encodes *invariants* — what holds regardless of company or job.
- **WWWD** encodes *valuation* — how this company, at this maturity, weighs the same axes.
- **WSID** encodes *discrimination* — telling a good tradeoff from a bad one inside one craft, at a resolution no generalist axis carries.

A profession-specific tradeoff has nowhere to land, so it is crushed into the nearest generic axis. A UX judgment about typographic hierarchy versus information density becomes `human_cognitive_load` and is thereby made indistinguishable from a build-queue latency concern. **That flattening is the mechanism behind "ambiguous vectors that don't discern the multiple tradeoffs."**

### 1.4 Vectors differ in epistemology, and the platform treats them as if they do not

| Class | Example | How established | Available at t=0? |
|---|---|---|---|
| **Measured** | blast radius, money, words on screen | Computed from system state | Yes |
| **Policy** | tax rules, WCAG 2.5.8 | Externally mandated; changes when the rule does | Yes, via corpus |
| **Revealed preference** | dark over light, tone, risk appetite | Learned from recorded choices | No — needs history |
| **Predictive / signal** | event calendar → demand | Learned correlate, validated by outcome | No — needs signal *and* outcome |

Today all four are authored the same way: a hand-written signed vector in frontmatter. That works for measured and policy. It cannot work for the other two, because their *values are not knowable at authoring time* — they are properties of a particular business accumulated over time.

This is the operator's Netflix parallel, and it has a precise structure: **Netflix never asked users to score dimensions; it recorded choices and learned weights.** Its cold-start answer was crowd plus content features. DPF's cold start is the **profession corpus** (WSID prior); its personalisation is **instance history** (WWWD posterior). That is exactly why the two tiers must stay distinct — collapse them and a fresh install has nothing to run on, while a mature install can never generalise what it learned.

DPF holds an advantage Netflix did not: `DecisionInteraction` records `options`, `evidenceBundle`, `sources`, `rationale`, `riskTier`, `confidenceBefore/After` and `humanOutcome` — the *reasons*, not just the click. Fewer examples are needed, and the result is explainable.

### 1.5 What the learning loop does and does not cover

`stance-promotion.ts` ladders **material authority** from human rulings (`ruled` = 1.0, "a human ruled on a real decision in this class"). That is genuine revealed-preference capture, and it is live.

What does not exist is learning at the **dimension-weight** level. Nothing reads accumulated `humanOutcome` rows and concludes *"this org systematically weights `speed_to_value` above `long_term_maintainability` in the `storefront-content` class."* `humanOutcome` is read in exactly one direction — is it null, i.e. is this decision still unresolved residue (`attention/sources/ai-decision.ts`).

So the gap is narrower and more tractable than "we cannot capture preferences": **capture is built; material-authority laddering is built; weight inference is not.**

### 1.6 The predictive class has no substrate at all

`ImprovementSignal` is platform self-improvement. There is no demand-signal, external-event, or seasonality model. The operator's worked example — a cap shop near an arena, where event size predicts demand, and where a holiday raises demand for one business and lowers it for another — has nowhere to land. This is the one genuinely net-new substrate in this spec.

---

## 2. Design

### 2.1 Spine reduction (WWMD)

Keep a **spine** of axes that genuinely trade off across every profession. Commandments stay on the spine. The spine is the commensurability layer: it is what lets a design objection and a security objection be weighed in one ledger.

Reduction is by *demotion, not deletion* — an axis used by ≤6% of principles is a candidate to become profession-local (§2.2), not to vanish. `cost_efficiency` is the exception: it is used by zero principles and BI-E1267C6D already scopes authoring a principle for it.

### 2.2 Profession-local axes with mandatory projection (WSID)

A profession may declare its own axes, in its own corpus, subject to three rules:

1. **Typed** — `benefit` or `cost`, with a `highMeans` statement, matching `DimensionGuidance`.
2. **Projected** — every local axis declares a weight onto ≥1 spine axis. `hierarchy_clarity` projects onto `human_cognitive_load`. This is what preserves cross-profession commensurability: inside the profession the decision is scored at full resolution; when it leaves, it rolls up.
3. **Sourced** — same provenance invariant WSID already enforces: a local axis without a cited source cannot publish.

This is the direct answer to *"add more vectors where there are more criteria to consider."* Vectors multiply **inside** a profession, where the criteria actually live, without inflating the shared space every profession must reason over.

### 2.3 Instance weighting, not instance axes (WWWD)

An organization **may not** declare new axes. It re-weights the spine (and, where it has adopted a profession, that profession's local axes).

This is a deliberate constraint. An instance's evolution from install to well-oiled is a change in *what it values*, not in *what exists to be valued*. Without this rule the space fragments per-install and nothing is comparable across the fleet — which would destroy the hive's ability to generalise.

### 2.4 Weight inference from decision history

Extend the existing ladder from material authority to dimension weight:

- **Input:** `DecisionInteraction` rows with non-null `humanOutcome`, grouped by `domainClass` and profile.
- **Inference:** where the human systematically overrode the kernel in a consistent direction, propose a weight adjustment on the axes that separated the chosen option from the recommended one.
- **Output:** a *proposal*, never a silent mutation. It enters the same confirmation ladder stance material uses, and requires the same human ruling to reach `ruled`.
- **Floor:** a minimum sample count and a stated confidence before any proposal surfaces — no learning from n=3.

This deliberately reuses the promotion ladder rather than inventing a second authority model.

### 2.5 Signal ingestion (predictive class)

Net-new, and deliberately last. A signal model requires: an external observation with a timestamp and a scope; a business-local outcome series; and a learned correlate that must *prove itself against outcome* before it may influence a decision. Until a correlate is validated it is evidence for a human, not a vector.

Scope for this spec: name the contract and the acceptance bar. Building it is a separate epic — it is the largest and least-constrained piece, and it should not delay §2.1–2.4.

---

## 3. Sequencing (this order is load-bearing)

1. ~~**RC2 first (BI-E1267C6D).**~~ **Step 1 is code-complete (2026-07-23).** Until core/contextual principles score structurally, every measurement in §1.2 is taken through a distorting lens and any migration would be validated against the wrong signal.

   **What shipped, and one correction to this spec.** The fix keeps Qdrant as the relevance index and rehydrates the authoritative `WikiPage` rows from Postgres by `pageId`, so signed vectors and `principleWeight` overrides reach structured scoring without duplicating the vector outside its authoring store. Approach chosen via `principle_decide` (9.755 vs 5.369, high confidence).

   RC2 was **not the only thing suppressing the corpus**, which this spec did not know. `maxPrinciples` — documented as a cap on the core/contextual set — was applied to the *merged, commandments-first* candidate list. With the live org at 41 commandments against a default cap of 20, every core and contextual principle was dropped before scoring, along with 21 commandments. So §1.2's census was distorted by **two** independent mechanisms, and the "70/95 inert" figure was, if anything, generous: on a universal-ring call the effective corpus was 20 alphabetically-ordered commandments. Both are fixed in the same change; a recurrence guard now warns when commandment retrieval returns exactly its limit.

   **Step 2 is not unblocked yet.** Deploy is operator-gated, so the live install still runs the pre-fix image. The §1.2 census must be **re-run after the next portal rebuild** — that re-run, not the merge, is what gates spine reduction (BI-AA7D80FE), because the whole point of ordering RC2 first was to measure through an undistorted lens.
2. **Spine reduction.** Settle which axes are spine before moving principles.
3. **Corpus migration.** Move the 39 software-engineer principles (and the smaller cohorts) down-tier, preserving decision history and `principleAppliesTo`.
4. **Profession-local axes.** Once professions own their content, give them axes to express it.
5. **Weight inference.** Requires 1–4 to be meaningful — inferring weights over a rank-deficient space would learn noise.
6. **Signal ingestion.** Independent epic.

**Migrating before the spine is settled would re-score every moved principle against axes that are about to change.** That is the sequencing risk this spec exists to prevent.

---

## 4. Revisions to prior specs

This spec **amends, and does not supersede**, the following. Each remains the authority for its own scope; the amendment is recorded here and should be linked from the original.

| Spec | Status | Amendment |
|---|---|---|
| `2026-05-17-wwmd-decision-perspective-kernel-design.md` | Implemented | The kernel assumed one authoring tier. §2.1–2.3 add tier-scoped axis ownership. The closed `PRINCIPLE_DIMENSIONS` registry is retained as the **spine**, not as the total space. |
| `2026-05-12-principles-as-wiki-kind-design.md` | Implemented | `principleConsumerArchetype: route-domain-specific` was intended as a routing hint. §1.1 shows it has become the de-facto migration label. Recommend renaming or splitting once migration completes, so the tag means one thing. |
| `2026-06-05-situational-aware-decision-weighting-design.md` | Layer 1 done; **RC2/RC3 done** (BI-E1267C6D); Layer 2 remainder split to BI-8D3E7757 | **Reinforced with new evidence, then partly discharged.** RC2 is not only a situational-weighting blocker — it invalidates structured scoring for 70 of 95 principles, and is the prerequisite for everything here. §1.2 supplies the corpus-wide measurement the original inferred from one decision. `cost_efficiency` remains unused, as predicted. Since implementation: RC3 was inert twice over (the Qdrant payload never carries `principleWeight` either), a sixth root cause (RC6, the merged-list cap) was found and fixed alongside, and §4's "a situational principle must be a commandment to score structurally" prerequisite is now discharged. |
| `2026-06-09-wsid-coworker-professional-corpus-design.md` | **Done** (PR #2016) | Delivered the tier. It did **not** address back-migration of kernel content that predates it, nor profession-local axes. §1.1 and §2.2 extend it. Its provenance invariant is inherited by local axes unchanged. |
| `2026-05-31-continuous-corpus-enrichment-design.md` | Implemented | Enrichment covers org corpus material. §2.4 extends the same confirmation ladder from material authority to dimension weight — reuse, not replacement. |
| `2026-05-24-founder-kernel-evolution-discipline-design.md` | Implemented | Its promotion/retirement contract governs adding spine axes. §2.2 introduces a **second, lighter** path for profession-local axes: they need provenance and a projection, not the full orthogonality argument required of a spine axis. This is an explicit relaxation and should be recorded there. |
| `2026-05-19-persona-voice-layer-wwtd-design.md` | Implemented | Generalised profile kinds. Unaffected; noted because it owns the kind taxonomy this spec extends conceptually but not structurally. |

**No spec is invalidated by this one.** The corpus *content* placement changes; the architecture they describe holds. That is a deliberate outcome of §0's verification step — two of the three problems this spec set out to solve turned out to be already solved, and the spec shrank accordingly.

---

## 5. Acceptance

1. Structured scoring reaches core/contextual principles; a re-run of the §1.2 census shows the authored vectors actually contributing (closes RC2's effect, not just its code path).
2. Spine membership is explicit: every axis is labelled spine or profession-local, with the demotion rationale recorded.
3. Zero principles remain tagged `route-domain-specific` in the kernel; each has moved to a profession or been justified as universal in writing.
4. `software-engineer` corpus depth reflects the migration (from 9 pages toward the ~39 principles' worth of content).
5. A profession declares a local axis end-to-end: typed, sourced, projected, scored within-profession, rolled up across.
6. A weight-inference proposal is produced from real `humanOutcome` history, surfaces for ruling, and mutates nothing until ruled.
7. The BI-B5EA2FB2 ledger degeneracy is re-tested against the rebalanced space and either resolves or is re-diagnosed with the rank confound removed.

---

## 6. Risks

- **Migration loses decision history.** Moved principles must retain their `DecisionInteraction` lineage; the audit tier already distinguishes gate from resolved profile (BI-1BE30A9A), which is the mechanism to preserve.
- **Local axes proliferate into noise.** Mitigated by mandatory projection and the provenance invariant — an axis that cannot cite a source or name what it rolls up into cannot ship.
- **Weight inference learns the operator's fatigue rather than their preference.** Mitigated by the sample floor, the ruling requirement, and never auto-applying.
- **Spine reduction over-corrects** and removes an axis a rare-but-critical decision needs. Mitigated by demotion-not-deletion: the axis survives inside the profession that uses it.
