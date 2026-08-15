# Decision vectors, corpus adequacy, and the science of multi-criteria choice

**Date:** 2026-08-10  
**Audience:** founder + platform stewards  
**Purpose:** Ground DPF’s `principle_decide` math and corpus in established decision science so autonomous AI governance evolves by **precedent**, not invention.  
**Live census:** Postgres kernel principles + DecisionInteraction (2026-08-10).  
**Kernel sequencing consult:** **DI-9F72A9893E65** — recommend `coverage-gates-and-science-pack` (high confidence; composite 9.43 vs densify 8.67 / weight-wire 7.73 / math-upgrade 3.97).

---

## 1. What DPF does today (precise identity)

### 1.1 Math (implemented)

Source of truth: `apps/web/lib/decision/option-scoring.ts`.

| Step | Formula | Family |
|---|---|---|
| Structured alignment | \(\mathrm{align} = \sum_i f_i v_i / \sum_i \|v_i\|\) | Normalized signed **weighted sum** over principle axes |
| Semantic fallback | Cosine(\(e_{\mathrm{option}}, e_{\mathrm{direction}}\)) | Embedding similarity |
| Composite | \(\sum_p w_p \cdot \mathrm{align}_{p}\) | **Weighted Sum Model (WSM / SAW)** |
| Choice | Argmax composite + margin vs runner-up | Advisory ranking |

Where:

- \(v\) = principle’s authored `principleDimensionVector` (sparse signed map on `PRINCIPLE_DIMENSIONS`)
- \(f\) = option `features` (0..1, “how much does this option **exhibit** this axis”)
- \(w_p\) = principle tier weight (commandment 1.0 / core 0.4 / contextual 0.1) ± overrides

Spec positioning (`2026-05-12-principles-as-wiki-kind-design.md` **Appendix B**):

> Uses a simple weighted-sum multi-criteria decision model. **Intentionally less elaborate than AHP, TOPSIS, PROMETHEE, or ELECTRE** — inspectability over theoretical optimality.

### 1.2 What “eigenvectors” means here (and what it does **not**)

| Term in conversation | In DPF today | In classical decision science |
|---|---|---|
| “Principle as vector” | Sparse signed map over named axes | Feature / criterion loading |
| “Eigenvector / weighting” | **Not** an eigendecomposition at runtime | Saaty **AHP** derives criterion **weights** as the **principal eigenvector** of a pairwise comparison matrix |
| “Enough vectors” | Enough **independent axes + non-empty feature overlap** so structured scoring discriminates options | Rank of the criteria space; mutual preferential independence of criteria |

**Clarifying claim:** DPF’s uniqueness is **governance productization** (wiki principles → typed signed vectors → contribution ledger → DecisionInteraction seal → multi-surface MCP). The **math family is not new**: it is classical **compensatory MCDA** (linear additive value), closest to the **weighted sum model**.

If we later adopt true **AHP eigenvectors**, that is a **weight-elicitation** upgrade (pairwise → priority vector + consistency ratio), not a rename of today’s alignment formula.

### 1.3 Corpus shape (live, 2026-08-10)

| Tier | Count | Has vector | Avg keys / principle |
|---|---:|---:|---:|
| commandment | 26 | 26 | 3.85 |
| core | 67 | 67 | 3.70 |
| contextual | 9 | 9 | 3.33 |
| heuristic | 1 | 1 | 3.00 |

Density buckets: **medium 3–5 keys: 97**, dense ≥6: **5**, sparse &lt;3: **1**.

**Axis usage (principles loading each key):**

| Axis | # principles | Note |
|---|---:|---|
| `long_term_maintainability` | 70 | Dominant |
| `governance_compliance` / `evidence_density` | 50 each | Dominant |
| `speed_to_value` / `schema_grounding` / `blast_radius` / `human_cognitive_load` | 36–42 | Heavy |
| Mid / low | 1–6 | Thin |
| **`cost_efficiency`** | **0** | **Registry member never used** |

This re-measures the same structural finding as `2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md` §1.2: **effective rank is far below the declared 20-axis width**. Many decisions light the same top contributors; trade-offs under-discriminate.

### 1.4 Runtime signal quality (kernel-consult, 30d)

| Metric | Value |
|---|---:|
| kernel-consult rows | 277 |
| `signalUsable=true` | 212 |
| `insufficientSignal=true` | 32 |
| Avg options with features | 2.92 of 3.11 |

So: corpus vectors exist, but **agent feature maps remain thin**, and **rank concentration** still compresses “why” into a few axes. That is exactly the failure mode that makes autonomous AI *look* opinionated but *feel* repetitive.

---

## 2. Prevailing science & standards (what we should not re-invent)

### 2.1 Multi-Criteria Decision Analysis (MCDA / MCDM)

Standard structure (UK Government Analysis Function *Introductory Guide to MCDA*, 2024; 1000minds / common MCDA practice):

1. Structure problem → objectives → **criteria**  
2. Score options on criteria (performance matrix)  
3. **Weight** criteria (how much swing from worst→best matters)  
4. Aggregate → rank  
5. **Sensitivity analysis** (do weight changes flip the winner?)

Core linear model:

\[
V = \sum_i v_i(w_i) \quad \text{or} \quad V = \sum_i w_i \cdot s_i
\]

This is **Multi-Attribute Value Theory (MAVT)** under mutual preferential independence: trade-offs between two criteria must not secretly depend on a third.

**DPF map:** principles ≈ criteria bundles; axes ≈ elementary criteria; option features ≈ performance scores; tier weight ≈ criterion weight; contribution ledger ≈ stacked value chart.

### 2.2 Analytic Hierarchy Process (Saaty) — the actual eigenvector method

Thomas Saaty’s AHP (1970s–):

1. Hierarchy of goal / criteria / alternatives  
2. **Pairwise comparison matrices** (1–9 scale)  
3. Priority vector = **principal right eigenvector** (or geometric mean approximation)  
4. **Consistency Ratio (CR)** — Saaty’s classic threshold **CR ≤ 0.10** before accepting judgments  
5. Aggregate bottom-up by additive synthesis  

Critiques (Bana e Costa et al.; consistency literature): eigenvector priority can violate order preservation under some inconsistent matrices; geometric mean is a common alternative; CR is a heuristic, not a law of nature.

**DPF relevance:**

- We already have an open BI for this path: **BI-DF87F8D2** (pairwise preference elicitation for cold-start weights).  
- That is the scientifically correct place for **eigenvectors** — deriving **weights**, not replacing alignment.  
- Do **not** claim today’s WSM “is AHP.” That would be false precision.

### 2.3 Other aggregators (when WSM is “too weak”)

| Method | Idea | When literature prefers it |
|---|---|---|
| **TOPSIS** | Distance to ideal / anti-ideal | Compensatory ranking with geometry |
| **PROMETHEE / ELECTRE** | Outranking, partial compensation | When bad criteria must not fully trade off |
| **Entropy-TOPSIS** | Data-driven criterion weights | Objective weights from performance matrix |
| **AHP + TOPSIS hybrid** | Eigenvector weights + TOPSIS rank | Common engineering practice |

DPF Appendix B already chose WSM for **inspectability** — correct for an audit ledger. Upgrade only if golden decisions show WSM cannot separate options that humans consistently separate.

### 2.4 Weight elicitation quality

UK GAF MCDA guide is explicit:

- **Simple “name importance” weighting is invalid.**  
- Prefer **swing weighting**: compare the *swing from worst to best* on each criterion.  
- Always run **sensitivity** on weights.

DPF’s tier defaults (1.0 / 0.4 / 0.1) are **authored priors**, not swing-elicited. That is acceptable as cold start; it is **not** scientifically sufficient as the only long-run weight source. Hence:

- **BI-D88DFEEA / BI-367853E2** weight inference (shipped engine)  
- **BI-47CF0AA5** wire fluid weight layer (open)  
- **BI-DF87F8D2** pairwise cold start (open)  
- **BI-E1427A3E** stance-derived vectors (open)

### 2.5 “How many criteria is enough?”

There is **no universal n** for autonomous scoring. Relevant bounds:

| Bound | Source | Implication for DPF |
|---|---|---|
| Human pairwise load ~7±2 | Miller (1956) absolute judgment / short-term capacity (often misused for UI lists) | Pairwise elicitation sessions should keep clusters small; not a limit on spine axes for machines |
| Rank deficiency | Linear algebra / the platform’s own §1.2 | If most principles load the same 5–6 axes, more principles **do not** add information |
| Mutual preferential independence | MAVT | Axes that always co-move should be merged or made hierarchical |
| Profession-local expansion | Spec 2026-07-23 §2.2 | **Add vectors where criteria live** (WSID), project to spine for cross-craft |

**“Enough vectors” = enough independent, scored dimensions with non-zero option features and non-concentrated principle loadings**, not “max out the registry.”

### 2.6 Principle-based autonomous AI (adjacent, not MCDA)

Anthropic **Constitutional AI** (Bai et al., 2022): explicit written principles + AI critique/revision + RLAIF preference model.  
**Collective Constitutional AI**: constitutions as public preference aggregation.

**DPF advantage vs CAI:**

- Principles are **typed, weighted, vectorized, and ledgered** — not only prose prompts.  
- Human overrides land in `DecisionInteraction` with options and (when instrumented) scored features — **revealed preference with reasons**.  
- Autonomy can be **gated** by confidence / commandment conflict / coverage floors (HITL at phase boundaries).

That is the core value proposition: **autonomous agents that can show the MCDA ledger**, not only a fluent justification.

---

## 3. Prior platform work (do not rebuild)

Epic **EP-DECISION-TIER-REBALANCE** already owns the structural program:

| Deliverable | Status |
|---|---|
| Core/contextual reach structured scoring (RC2) | **done** BI-E1267C6D |
| Spine vs profession-local axes | **done** BI-AA7D80FE |
| Profession-local axes + projection | **done** BI-106C2585 |
| Specialist doctrine migration | **done** BI-5FE47130 |
| Weight-inference engine + gate instrumentation | **done** BI-D88DFEEA, BI-367853E2, BI-6DCF772F |
| Consumer-context attenuation | **done** BI-5BB1A364 |
| Wire weight proposals into live composite | **open** BI-47CF0AA5 |
| Pairwise cold-start weights | **open** BI-DF87F8D2 |
| Stance-derived dimension vectors | **open** BI-E1427A3E |
| Job-specific vector inventory | **open** BI-25CCF1A4 |
| Golden-decisions live arm | **open** BI-4C0F9E21 |

Spec authority: `docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md`.

---

## 4. Gaps that remain (science-driven)

### Gap A — Operational MCDA quality gates (next, kernel-recommended)

Today we have `insufficientSignal`, semantic fallback ratio, commandment conflict, tie margin. We **lack**:

1. **Feature coverage floor** — e.g. require ≥k spine axes scored on every option (or escalate).  
2. **Principle–feature overlap floor** — structured rows with high `missingDimensions` fraction should not look “confident.”  
3. **Weight sensitivity report** — perturb \(w_p\) or axis magnitudes ±ε; if argmax flips, confidence → low (UK GAF “review the output”).  
4. **Public identity doc** — one page stating “WSM + signed sparse vectors; AHP reserved for weight elicitation.”

### Gap B — Corpus densification / deconcentration (second)

1. **Min vector key policy** (commandment ≥4–5 non-zero keys unless justified).  
2. **Author principles that load underused axes** (`cost_efficiency`, `data_privacy`, `customer_consent_state`, …) with real doctrine, not filler.  
3. **Reduce over-loading** of `long_term_maintainability` / `governance_compliance` where a more specific axis is true.  
4. Profession-local expansion continues via BI-25CCF1A4 / existing projection rules.

### Gap C — Close the learning loop (third)

Wire ruled weight proposals into composite only after:

- Coverage gates + golden-decision live arm prove the space is not still rank-deficient.  
- Sample floors and human ruling (already designed).

Learning noise on a concentrated corpus is **worse** than authored priors (spec §3 step 5).

### Gap D — Do **not** prioritize math replacement first

Kernel scored **upgrade-scoring-math-first** lowest. Literature agrees: change aggregator only after measurement shows WSM cannot recover human-consistent rankings.

---

## 5. Program plan (sequenced)

| Phase | Work | Precedent | BIs | Status (2026-08-10) |
|---|---|---|---|---|
| **0** | Research + identity (this doc) | MAVT / MCDA / AHP / CAI | (this memo) | **done** (main via #4178) |
| **1** | Coverage + sensitivity gates; science pack in decision ledger + skills | UK GAF MCDA; Appendix B | **BI-1D23EC26** | **in PR #4180** (merge queue) |
| **2** | Corpus densify + underused axes + lint floors | Spec 2026-07-23 §1.2; rank theory | **BI-6006E35D** | **tranche 1–2 shipping** (t1 in #4180; t2 branch) |
| **3** | Wire fluid weight layer + pairwise cold start | Saaty AHP CR; swing weighting | BI-47CF0AA5, BI-DF87F8D2 | open (gated on densify + golden live) |
| **4** | Stance-derived + JSI inventory | Revealed preference / CAI | BI-E1427A3E, BI-25CCF1A4 | open |
| **5** | Golden-decisions live regression + optional TOPSIS pilot if still under-discriminating | Empirical MCDA | BI-4C0F9E21 + future | open |
| **obs** | Decision log adoption metrics + silent-surface hygiene | process spine | **BI-6A686EBB** | open (process skills landed #4178) |

### 5.1 Densify tranche 2 re-census (source files, 2026-08-10)

| Metric | Baseline (§1.3) | After t1+t2 |
|---|---:|---:|
| Avg keys / principle (docs corpus) | ~3.7 | **~4.5** |
| `cost_efficiency` principles | **0** | **7** |
| `data_privacy` / `customer_consent_state` | 1 each | **4 / 5** |
| Commandment sparse (&lt;4 keys) | most at 3 | **0** (lint floor raised to 4) |
| Top-5 axes share of key-mass | dominant | **~61%** (still concentrated — t3 rebalance) |

**Remaining densify (BI-6006E35D, not this tranche):** rebalance over-loaded `long_term_maintainability` / `governance_compliance` mass; further thin-axis doctrine; live Postgres re-census after seed/sync; top-5 share target to be set after golden live arm.

---

## 6. Acceptance metrics (falsifiable)

1. **Effective rank:** top-5 axes load &lt; X% of principle-key mass (re-census query).  
2. **Feature coverage:** median option features ≥ k spine axes on external-agent consults.  
3. **Sensitivity:** % of decisions whose winner flips under ±10% weight noise (target: low for high-confidence claims).  
4. **Human agreement:** when operator overrides, axes of separation are recorded (weight-inference ready).  
5. **Autonomy gate:** high-confidence auto-proceed only if coverage floors + no commandment conflict + sensitivity stable.

---

## 7. References (selected)

1. Saaty, T. L. — Analytic Hierarchy Process; principal eigenvector priorities; CR ≤ 0.1 (classic threshold).  
2. UK Government Analysis Function — *An Introductory Guide to Multi-Criteria Decision Analysis (MCDA)* (swing weighting; sensitivity; linear additive value).  
3. Multi-Attribute Value Theory / weighted sum (SAW/WSM) — standard compensatory MCDA.  
4. Bana e Costa et al. — critiques of eigenvalue priority interpretation under inconsistency.  
5. Bai et al. / Anthropic — Constitutional AI (2022); Collective Constitutional AI.  
6. Miller, G. A. (1956) — capacity limits; use carefully (elicitation clusters, not spine size).  
7. DPF internal: principles-as-wiki-kind Appendix B; decision-tier-rebalance & vector epistemology (2026-07-23); option-scoring.ts.

---

## 8. Operator takeaway

- **You are not guessing if you stay in MCDA.** DPF already sits on a century of multi-criteria theory; the product work is governance, evidence, and learning loops.  
- **“More vectors” is right — but as rank and coverage, not as “add AHP tomorrow.”**  
- **Eigenvectors belong in weight elicitation (AHP/pairwise), not as a rebrand of alignment.**  
- **Autonomy is earned** when coverage floors + sensitivity + commandment gates are hard, and weight learning is ruled-not-silent.
