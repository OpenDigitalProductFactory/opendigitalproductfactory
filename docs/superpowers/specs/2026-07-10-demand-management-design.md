# Demand Management — turn the raw backlog into a governed value-ranked investment funnel

| Field | Value |
|-------|-------|
| **Epic** | EP-DEMAND-MGMT (new) |
| **Date** | 2026-07-10 |
| **Author** | Claude (Opus 4.8) with founder (Mark Bodman) |
| **Status** | Design (design-first — no production code this pass; operator reacts to direction before build) |
| **Scope decision** | Routed through `principle_decide` (`callingPopulation=external_coding_agent`, ledger **DI-531D84C6EB8F**) → **extend-and-unify** wins, composite 6.764, **margin 2.551** (tieMargin 0.2 → high confidence), no commandment conflict, strong structured coverage. Beat `greenfield-module` and `scoring-only-thin`. |
| **Governing kernel principles** | [`architecture-over-shortcuts`](../founder-kernel/wiki/principles/architecture-over-shortcuts.md), [`single-source-of-truth`](../founder-kernel/wiki/principles/single-source-of-truth.md), [`research-and-use-standards`](../founder-kernel/wiki/principles/research-and-use-standards.md), [`remove-avoidable-failure-opportunities`](../founder-kernel/wiki/principles/remove-avoidable-failure-opportunities.md) |
| **UX-Fit** | Adds a Demand board + scoring inputs + ranking view → binds the UX-Fit gate (§11). Progressive disclosure is the spine: a plain "how valuable / how big" pair up front, the framework internals behind drill-in. |
| **IT4IT value stream** | Strategy-to-Portfolio (S2P) — the demand funnel is the S2P front door that feeds Requirement-to-Deploy (R2D, = Build Studio). Consistent with [2026-05-10 Business Intake & Innovation Radar §1.5](2026-05-10-build-studio-business-intake-innovation-radar-design.md). |

---

## 1. Problem

The operator's framing: *"The backlog is very raw in terms of items that we could invest in. The typical process in many orgs is demand management. Evaluate the major players in the market, and how we do things here, to incorporate the best of the market tools as part of this platform."*

DPF has a solid **work-tracking spine** — unified intake (`ingestBacklogItem`, [backlog-ingest.ts:199](../../../apps/web/lib/operate/backlog-ingest.ts)), a triage verdict (`triage_backlog_item`, [mcp-tools.ts:470](../../../apps/web/lib/mcp-tools.ts)), a promote-to-build gate ([mcp-tools.ts:505](../../../apps/web/lib/mcp-tools.ts)), and a `Portfolio → Epic → BacklogItem` hierarchy ([schema.prisma](../../../packages/db/prisma/schema.prisma)) — plus a governed **decision layer** (WWMD/WWWD/WSID, EP-DECISION-GOV-SURFACE). But it has **no demand-management discipline**. Concretely, a nine-point gap (all verified against code):

1. **No business-value signal at all.** The model carries `effortSize` (t-shirt S/M/L/XL) and `priority Int?` (a bare, hand-entered integer, "lower = higher"). There is **no** `value`, `impact`, `reach`, `confidence`, `costOfDelay`, `RICE`, or `WSJF` field anywhere ([schema.prisma `model BacklogItem`](../../../packages/db/prisma/schema.prisma); grep across `lib`/`prisma`/`specs` returns none). **We size the cost of work and never the value of it.**
2. **Prioritization is a free integer, not a computed rank.** No scale, no derivation, no audit of *why* one item outranks another.
3. **Qualification is binary, not a funnel.** The only pre-build states are `triaging → open(+triageOutcome=build)`. There is no graded screening/shaping stage and no qualification score — one `triageOutcome` verdict collapses ServiceNow's `Draft→Screening→Qualified→Approved` into a single step.
4. **Dedup is origin-marker-only.** `ingestBacklogItem` dedups solely on a body-embedded origin marker ([backlog-ingest.ts:221](../../../apps/web/lib/operate/backlog-ingest.ts)); two humans filing the same idea in their own words get two items. `duplicateOfId` + `occurrenceCount` exist but are set manually.
5. **No investment-outcome bucket above epics.** The hierarchy stops at `Portfolio` (whose only value field is `budgetKUsd`). There is no Theme/Objective/OKR/Initiative model and no Run/Grow/Transform or horizon allocation to prioritize demand *against*.
6. **No structured dependency relation.** Blocks/blocked-by live only as prose in item bodies (flagged as a known gap by the filing skill). Product-level `ProductDependency` edges exist ([2026-06-22 cascade plan](../plans/2026-06-22-portfolio-prioritization-cascade.md)) but item-level demand sequencing has nothing structured to read.
7. **No demand/prioritization surface.** The backlog is a work-queue list at `/ops`. There is no intake-funnel, scoring, value-vs-effort matrix, or portfolio-ranking view.
8. **Prioritization is decoupled from promotion.** Promote eligibility is a binary Definition-of-Ready (`status=open` + `triageOutcome=build` + `effortSize` set, [governed-backlog-tee-up.ts:116](../../../apps/web/lib/governed-backlog-tee-up.ts)); the build queue is drawn by `priority`-int + recency — so the **highest-value work is not systematically pulled first**.
9. **The scoring engine was designed and shelved.** The WSJF×theme composite prioritizer **BI-30EE393B** is referenced in the [2026-06-22 cascade plan](../plans/2026-06-22-portfolio-prioritization-cascade.md) but **never shipped** (zero code references). WSJF exists only as *knowledge* in the profession corpus ([seed-profession-corpus.ts:500](../../../packages/db/src/seed-profession-corpus.ts)).

**Net:** the platform can *track and build* work, and *govern how it decides*, but it cannot *quantify, rank, or fund* demand. This spec closes that — the missing keystone between raw intake and governed investment.

---

## 2. Design goal

Add a **demand-management discipline** that turns the raw backlog into a **value-ranked, governed investment funnel**, by *extending the existing spine* (kernel decision DI-531D84C6EB8F: extend-and-unify, not a parallel module). A business owner should be able to answer, in one surface:

1. **What is being asked for?** (intake → screened demand, deduplicated)
2. **How valuable is it, and how big?** (pluggable value/effort scoring — RICE / WSJF / weighted — computed from stored inputs, not a hand-set integer)
3. **What should we fund, in what balance?** (investment buckets: Run / Grow / Transform × horizons, against portfolio budgets and capacity)
4. **What gets built next?** (a value-ranked promote gate feeding Build Studio)

…with the **scoring policy authored as WWWD business doctrine** and every ranking call auditable through `principle_decide` → the Decision Review workspace.

### 2.1 Non-goals

- **No parallel `Demand` model.** Rejected by the kernel (greenfield-module lost by margin 2.551). Demand is a *facet* of the existing `BacklogItem` (thin idea) promoted through funnel stages, not a second object to keep in sync.
- **No re-architecture of the decision engine.** `option-scoring.ts decide()` / `principle_decide` / the `DecisionInteraction` ledger are reused as-is. The scoring engine computes value/effort; the *governance* of what counts as value routes through the existing WWWD kernel.
- **No new intake front door.** `ingestBacklogItem` + `BusinessBuildBrief` (shipped) + the designed Innovation Radar remain the intake. This spec adds the *funnel, scoring, and portfolio* layers downstream of intake.
- **Not the operational work-routing queue.** `WorkQueue`/`WorkItem` (`urgency`+`effortClass`, service-desk) is a separate axis and out of scope.
- **Single-org per install** — no multi-tenant constructs.

---

## 3. Research & Benchmarking

Full cited market reference in the research log; condensed adopt/reject here.

| Vendor / pattern | What they do well | **Adopt** | Reject / anti-pattern |
|---|---|---|---|
| **ServiceNow SPM — Demand Mgmt** | Explicit demand lifecycle `Draft→Submitted→Screening→Qualified→Approved→Completed`; question-driven scoring computed *on* the Screening→Qualified transition; score `((10−Risk)+Size+Value)/3`; two governance planes (demand qualification vs portfolio investment approval). | The **explicit funnel states with a score computed on transition**, and the **two-plane governance** (qualify ≠ fund). | Heavyweight parallel Demand object (we keep demand a facet of the backlog item). |
| **Aha!** | Idea portal + voting; weighted **value scorecard** (population/need/strategy/effort/confidence); promote-idea-to-feature with a **persisted link** and a score threshold. | **Threshold-based promotion with a traceable link** (we already have `activeBuildId`/`originatingBacklogItem`); weighted scorecard. | Public voting portal (not in scope for a single-org internal factory). |
| **Productboard** | Insight/evidence attached to features; **Customer Importance Score** (nice-to-have 1 / important 2 / critical 3); score out of 100 from user-defined Drivers. | **Evidence-weighted value** — reuse `occurrenceCount`/`lastSeenAt` and `BusinessBuildBrief.sourceEvidence` as reach/confidence inputs. | — |
| **Jira Product Discovery / Align** | Impact–Effort **Matrix (2×2)** view; **custom formula fields** (impact+insights+confidence positive, effort negative); **RICE** built in; **WSJF** at the Align/SAFe tier. | The **value-vs-effort matrix** as a first-class view and **pluggable formula fields**. | Four separate view products; we ship one board with matrix + list. |
| **Planview / Clarity PPM** | **Capacity vs demand balancing** (supply/demand per period); kill/hold/advance; ROI + strategic-fit scoring. | **Effort summed against a budget/capacity envelope per portfolio** (we already have `Portfolio.budgetKUsd` + the partial cascade). | Full resource-management suite (defer capacity to a later phase). |
| **Airfocus / ProductPlan / Roadmunk** | Pluggable **RICE/WSJF/MoSCoW/ICE/weighted** engines; store the *inputs*, compute any formula. | **The store-inputs-compute-score architecture** — the central engineering decision (§5.2). | Framework zoo exposed raw to laymen (we seed 2 presets, hide the math). |
| **Cooper Stage-Gate** | Alternating stages + **Go/Kill/Hold/Recycle** gates with predefined criteria; deliberately high early kill rates. | **Gate semantics** mapped onto our funnel transitions (already latent in `triageOutcome`). | Five heavy formal stages (we use a lean 4-stage funnel). |
| **McKinsey 3 Horizons / Run-Grow-Transform** | Investment **buckets with target allocation** (e.g. 70/20/10) so near-term work can't consume the whole budget. | **Investment buckets + target allocation** on the portfolio layer. | — |
| **Opportunity Scoring (ODI) / Kano** | Upstream unmet-need discovery; feature-satisfaction classification. | Available as *optional* scoring presets; not the default. | Mandating survey instruments for internal factory work. |

**Standard formulas seeded (paraphrased/attributed, per `research-and-use-standards`):**
- **RICE** = `(Reach × Impact × Confidence) / Effort` — Impact on the fixed 3/2/1/0.5/0.25 scale; Confidence as % (1.0/0.8/0.5); Effort in person-months.
- **WSJF** = `CostOfDelay / JobSize`, `CoD = BusinessValue + TimeCriticality + Risk/OpportunityEnablement` (relative Fibonacci).
- **Value-vs-Effort** = the 2×2 rendering (Quick Wins / Big Bets / Fill-ins / Time Sinks).
- **Weighted** = `Σ(weightᵢ × scoreᵢ)` — the generic case the org configures via WWWD.

**Gap none of the vendors cover, which DPF uniquely closes:** binding the value-scored demand funnel to a **governed decision kernel** (the scoring *policy* — what counts as value, how reach weighs against effort — is authored as WWWD org doctrine and each ranking call is auditable), and feeding a **recursive AI build factory** (Build Studio) rather than a human dev team.

---

## 4. The demand funnel (lifecycle)

A lean four-stage funnel, additive on the existing status/triage spine. Reuses Cooper's Go/Kill/Hold/Recycle gate semantics; maps onto ServiceNow's `Draft→Screening→Qualified→Approved`.

```
 intake        SCREEN            SHAPE               RANK & FUND         promote
 ───────▶  raw ──────▶ screened ──────▶ shaped ──────────▶ ready ─────────▶ (Build Studio)
           │  (dedup,   │ (value+effort  │ (business-cased,  │ (value-ranked,
           │  triage)   │  inputs set,   │  bucket+theme     │  investment-
           │            │  score computed)│  assigned)       │  approved)
           └── kill/defer/duplicate/merge at every gate ──────────┘
```

- **raw** — item just ingested (today's `status=triaging`). Semantic dedup runs here (§6).
- **screened** — passed triage (`triageOutcome=build`) **and** carries the minimum scoring inputs (value + effort). A `demandScore` is computed on this transition (ServiceNow's "compute on Screening→Qualified" pattern).
- **shaped** — has a business case (theme/objective link, investment bucket, optional business-value quantification) sufficient for a funding decision.
- **ready** — value-ranked within its portfolio envelope and investment-approved; eligible for the promote gate, drawn **highest-value-per-effort first** (§7).
- Kill / defer / duplicate / merge are available at every gate (high early kill rate is the point).

**Modeling decision (recommended, operator open-question Q1):** represent the funnel as an **additive `demandStage` facet** (`raw | screened | shaped | ready`) on `BacklogItem`, *orthogonal* to `status` (which continues to govern work-claims and lifecycle). Rejected alternative: overloading the `status` enum, which already gates claims and would conflate "where in the funnel" with "is work in flight." `demandStage` is `null` for non-demand items (chores, bugs auto-fast-tracked) so the funnel does not tax operational work.

---

## 5. Scoring engine (the keystone)

### 5.1 Store inputs, compute score (pluggable)

Per the market's clearest lesson (Airfocus/JPD/Aha!/Productboard all converge here): **persist the scoring *inputs* as first-class fields; compute the score with a pluggable formula.** This lets the org pick RICE, WSJF, value-vs-effort, or a weighted blend *without a schema change*, and makes every score explainable and re-computable.

Additive fields on `BacklogItem` (all nullable; `null` = "not yet scored"):

| Field | Type | Feeds | Default source |
|---|---|---|---|
| `reach` | `Int?` | RICE Reach | **seeded from `occurrenceCount`** (existing recurrence signal) |
| `impact` | `Float?` | RICE Impact / value | operator (3/2/1/0.5/0.25 scale) |
| `confidence` | `Float?` | RICE Confidence | operator (1.0/0.8/0.5) or derived from `BusinessBuildBrief.confidence` |
| `businessValue` | `Int?` | WSJF CoD term | operator (relative) |
| `timeCriticality` | `Int?` | WSJF CoD term | operator (relative) |
| `riskOpportunity` | `Int?` | WSJF CoD term | operator (relative) |
| `jobSize` | `Float?` | WSJF denominator | **derived from `effortSize`** via a t-shirt→points map (S=1,M=3,L=8,XL=20) |
| `demandScore` | `Float?` | computed output | engine (see §5.2) |
| `demandScoreFramework` | `String?` | which formula produced it | engine (`rice \| wsjf \| value_effort \| weighted`) |
| `demandScoreComputedAt` | `DateTime?` | freshness/staleness | engine |

`effortSize` (t-shirt) is retained as the human-facing size; `jobSize` is its numeric projection for WSJF. `reach` seeds from `occurrenceCount` so recurring demand automatically ranks higher — a signal we already collect and currently waste.

### 5.2 The compute function + framework config

A pure function `computeDemandScore(inputs, framework, weights)` in `apps/web/lib/demand/scoring.ts` (no server imports; unit-tested against the four seeded fixtures). The **active framework + weights** are an org-level config authored as **WWWD doctrine** (§8), defaulting to a seeded preset. The engine:
1. computes the score for the active framework,
2. writes `demandScore` + `demandScoreFramework` + `demandScoreComputedAt` on the Screen→Shape transition (and on any input edit),
3. is idempotent and explainable — the score view shows the formula and each input's contribution.

**Default framework (recommended, operator open-question Q2): RICE.** Rationale: RICE's inputs map onto fields we already have or can derive with the least new operator burden (Reach ← `occurrenceCount`, Effort ← `effortSize→jobSize`, only Impact+Confidence are net-new), and RICE is the product-discovery standard. **WSJF is seeded as the alternate preset** for orgs that prefer Cost-of-Delay sequencing (Jira Align/SAFe shops) — it needs the three CoD inputs. The org flips the default via the WWWD stance editor; no code change.

### 5.3 Value-vs-Effort matrix (the view, not a formula)

The Demand board (§9) renders scored items on a **value (or `demandScore`) × effort 2×2** — Quick Wins / Big Bets / Fill-ins / Time Sinks — the JPD/ProductPlan pattern. Pure presentation over the stored inputs; no extra persistence.

---

## 6. Semantic deduplication & merge

Extend `ingestBacklogItem` with a **semantic dedup pass** (in addition to today's origin-marker check): at ingest, embed the title+body and compare against open, non-terminal items in the same portfolio; on a high-similarity hit, surface **"merge or link"** before writing (Aha!/Productboard/JPD pattern). Merge re-parents `occurrenceCount`, evidence, and requesters onto the survivor (concentrating signal → higher reach → higher score) and sets `duplicateOfId` with a redirect. Suppressing the check writes a `ToolExecution` audit row. Reuses the existing `duplicateOfId`/`duplicates[]` relation and the embedding infra already in the repo (qdrant). This directly raises scoring quality: fragmented duplicates currently understate true reach.

---

## 7. Ranking gate between triage and promote

Today `promote_to_build_studio` draws build-eligible items by `priority`-int + recency ([governed-backlog-tee-up.ts:125](../../../apps/web/lib/governed-backlog-tee-up.ts)). Change the **ordering signal** (not the Definition-of-Ready) so the auto-sweep and `get_next_recommended_work` draw **highest `demandScore`-per-portfolio-envelope first**, with the existing dependency cascade ([2026-06-22 plan](../plans/2026-06-22-portfolio-prioritization-cascade.md)) still able to *floor* (not override) the rank of dependencies of sold offerings. `priority Int?` is retained as an explicit **manual override** (operator pin) that trumps the computed rank, logged as a WWWD decision. The readiness scorer `recommend.ts` keeps its spec/plan-presence weighting but its `priority present +2` flat term is replaced by the normalized `demandScore`.

**Two governance planes** (ServiceNow pattern): the Screen gate (`triageOutcome=build`) is *demand qualification*; the Ready gate (investment-approved, within budget envelope) is *portfolio investment approval* — a distinct, WWWD-governed step so "worth doing" and "fund it now" are not conflated.

---

## 8. Investment buckets & portfolio balance

Add an **investment-bucket** dimension so demand is prioritized *against a strategic balance*, not just a flat list:

- `investmentBucket` (`run | grow | transform`) on `BacklogItem`/`Epic` (Run-Grow-Transform / McKinsey 3-Horizons; default derived from `workType` — `bug|chore|refactor`→run, `feature`→grow, else operator).
- **Target allocation per portfolio** (e.g. 70/20/10) stored alongside `Portfolio.budgetKUsd`; the Demand board shows *actual vs target* bucket mix and flags when near-term work is starving Transform.
- **Theme/objective linkage:** rather than a heavy new OKR model (deferred — YAGNI), reuse the org-overlay `WikiPage` `stance` corpus (already the WWWD substrate) as lightweight **strategic themes**; a demand item carries an optional `themePageId`. Portfolio views roll demand up by theme to check strategic coverage. A first-class OKR/Objective model is an explicit open question (Q3) for a later phase if the lightweight link proves insufficient.

Effort (`jobSize`) summed per bucket against `budgetKUsd` gives a first, coarse **capacity-vs-demand** read (Planview pattern) without a full resource-management build — that heavier capacity modeling is deferred.

---

## 9. UI surface — the Demand board

A single **Demand** view under `/ops` (progressive disclosure; binds the UX-Fit gate §11), *not* a new top-level nav module (kernel: minimize surface). Three tabs over the same funnel data:

- **Funnel** — kanban columns `raw → screened → shaped → ready`, cards show `demandScore`, effort, bucket chip; drag advances stages (gate rules enforced server-side).
- **Matrix** — the value×effort 2×2 (§5.3) with quadrant labels.
- **Portfolio balance** — per-portfolio budget envelope, actual-vs-target bucket mix, and the value-ranked "next to promote" list.

Layman-first: a card's front shows **"how valuable" + "how big"**; the RICE/WSJF inputs and formula live behind a "Why this score" drill-in. No raw framework tokens on the front (the #2004 raw-token anti-pattern). Uses `var(--dpf-*)` tokens only. The existing `/ops` list stays as the flat fallback.

---

## 10. Data model summary

**Additive only — no new core model** (kernel: extend-and-unify; data-model stewardship). On `BacklogItem`: the ten §5.1 scoring fields + `demandStage` + `investmentBucket` + `themePageId`. On `Epic`: `investmentBucket` (+ inherit theme). On `Portfolio`: `bucketTargets Json?` (allocation %). New enums (as TS string-unions per AGENTS.md §3, mirrored in `mcp-tools.ts`): `DEMAND_STAGE_VALUES`, `INVESTMENT_BUCKET_VALUES`, `DEMAND_SCORE_FRAMEWORKS`. One migration, all columns nullable/defaulted → **fleet-safe** (AGENTS.md migration rule: no tightening constraint on existing rows). The scoring policy config is a WWWD `WikiPage` overlay row, not a new table.

---

## 11. Governance & UX-Fit integration

- **Scoring policy = WWWD doctrine.** Which framework is active, the weights, what "high value" means, and the bucket targets are authored through the existing `/wiki/stance` WWWD editor (EP-DECISION-GOV-SURFACE Phase 3), not hardcoded. This is exactly the "how *your business* decides — funding, priorities" scope.
- **Each ranking/funding call is auditable.** Investment-approval (Screen→Ready) and manual `priority` overrides route through `principle_decide` and land in the `DecisionInteraction` ledger, surfacing in the Decision Review workspace as gap/conflict/staleness findings (e.g. "escalations rising on Transform funding while budget skews Run"). Demand scoring gives that workspace its first *value* inputs.
- **UX-Fit gate.** The Demand board + scoring inputs + matrix are new surface → `dpf-ux-fit-review` before build, progressive disclosure enforced.

---

## 12. Phasing

Each phase is independently shippable behind the UX-Fit gate; the operator can stop after any phase. Phase 1 is the smallest end-to-end vertical (satisfies the kernel's `scoring-only-thin` value without adopting it as the ceiling).

- **Phase 0** ✅ — this spec + epic + BIs + research log. No code.
- **Phase 1 — Scoring foundation (thin vertical).** Additive scoring-input fields (§5.1) + `computeDemandScore` (§5.2, RICE default) + `demandStage` facet; seed `reach` from `occurrenceCount`, `jobSize` from `effortSize`; MCP tools `score_demand_item` / extend `query_backlog` to return `demandScore`; the ranking-order change in the promote sweep (§7). Unit tests on 4 fixtures. **No new UI yet** — surfaces via existing `/ops` list sorted by score.
- **Phase 2 — Demand board.** The `/ops` Demand view (§9): funnel kanban + value×effort matrix. UX-Fit gated.
- **Phase 3 — Investment buckets & portfolio balance.** `investmentBucket`, `Portfolio.bucketTargets`, actual-vs-target view, theme linkage via WWWD stance pages (§8).
- **Phase 4 — Governed scoring policy.** Framework/weights/bucket-targets authored via `/wiki/stance` (WWWD); investment-approval + manual-override routed through `principle_decide`; findings wired into the Decision Review workspace (§11).
- **Phase 5 — Semantic dedup & merge at ingest** (§6). Sequenced last because it depends on scoring being live (merge concentrates reach → score) and is the highest-risk change to the intake hot path.
- **Later / deferred (own BIs, not this epic):** full capacity-vs-demand resource modeling; first-class OKR/Objective model (if theme-link proves insufficient); completing the **Innovation Radar** intake (`InnovationProposal` model, designed 2026-05-10, never shipped) as the market-signal demand source; Kano/Opportunity-scoring presets.

---

## 13. Success criteria

1. Every build-eligible item carries a **computed, explainable `demandScore`** (not a hand-set integer); the promote sweep draws highest-value-per-effort first — verifiable by ledger + ordering test.
2. A non-technical operator can see, in one surface, *what's asked, how valuable, how big, and what to fund next* — without encountering "RICE", "WSJF", or a raw token on the front.
3. The active scoring framework, weights, and bucket targets are **editable as WWWD doctrine** (portal, not code) and every funding call is auditable in the Decision Review workspace.
4. Duplicate demand is **merged with reach transferred**, so the funnel concentrates signal instead of fragmenting it.
5. Portfolio views show **actual-vs-target** investment-bucket balance, so near-term work cannot silently starve Transform.
6. No parallel Demand object; all of the above is additive on `BacklogItem`/`Epic`/`Portfolio` (single source of truth).

---

## 14. Open questions for the operator

1. **Funnel granularity.** Confirm the 4-stage `demandStage` facet (`raw/screened/shaped/ready`) vs. a leaner 3-stage or a heavier ServiceNow-style 6-stage. (Recommend 4.)
2. **Default scoring framework.** RICE (maps to existing fields, least input burden) vs. WSJF (Cost-of-Delay sequencing) as the *seeded default*. Both ship as presets; this is only the default. (Recommend RICE.)
3. **Strategic themes.** Lightweight WWWD-stance-page themes now, or a first-class OKR/Objective model? (Recommend lightweight now, model later only if needed.)
4. **Bucket taxonomy.** Run/Grow/Transform vs. McKinsey Horizon 1/2/3 as the label set (same concept, different words). (Recommend Run/Grow/Transform — plainer for a business owner.)
5. **Phase-1 stop point.** Is the invisible scoring foundation (score + reordered promote, no new UI) enough to react to before committing to the Demand board?
