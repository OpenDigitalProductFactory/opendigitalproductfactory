# Demand Management — Implementation Plan

| Field | Value |
|-------|-------|
| **Epic** | EP-DEMAND-MGMT |
| **Spec** | [docs/superpowers/specs/2026-07-10-demand-management-design.md](../specs/2026-07-10-demand-management-design.md) |
| **Date** | 2026-07-10 |
| **Author** | Claude (Opus 4.8) with founder (Mark Bodman) |
| **Scope decision** | `principle_decide` ledger **DI-531D84C6EB8F** — extend-and-unify (margin 2.551, high confidence) |
| **Status** | Plan (design-first; BIs filed as `triaging` — operator triages after reacting to direction) |

## Why

The backlog is raw: DPF sizes the *cost* of work (`effortSize`) but never its *value*, ranks by a hand-set `priority Int`, has a binary triage instead of a funnel, and pulls the build queue by priority+recency rather than value. This plan adds a market-standard demand-management discipline — **pluggable value/effort scoring, a graded demand funnel, investment buckets, semantic dedup, and a value-ranked promote gate** — by *extending* the existing `BacklogItem`/`Epic`/`Portfolio` spine (kernel decision: not a parallel Demand model), with the scoring policy governed as WWWD doctrine. Full market benchmarking and gap analysis in the spec §1/§3.

## Backlog items (this epic)

| BI | Phase | Title | Size |
|----|-------|-------|------|
| BI-0D49B4D8 | 1 | Demand scoring foundation — inputs + `computeDemandScore` (RICE default) + `demandStage` | large |
| BI-A2705E51 | 2 | Demand board at `/ops` — funnel kanban + value×effort matrix | large |
| BI-E5526151 | 3 | Investment buckets & portfolio balance — Run/Grow/Transform + targets + themes | medium |
| BI-5E0995D5 | 4 | Governed scoring policy — WWWD-authored weights + `principle_decide`-audited funding | medium |
| BI-F6B290A8 | 5 | Semantic dedup & merge at ingest — embedding match + merge-with-reach-transfer | medium |

## Slices

### Phase 1 — Scoring foundation (BI-0D49B4D8) · *thin end-to-end vertical, no new UI* — ✅ LANDED

The keystone. Everything downstream depends on a computed, explainable score existing. **Landed** in migration `20260710120000_add_demand_management_scoring` (additive/nullable — fleet-safe), `apps/web/lib/demand/scoring.ts` (pure engine, RICE default), the `score_demand_item` MCP tool, `demandScore`/`demandStage` on `list_backlog_items`, and the value-ranked promote sweep in `governed-backlog-tee-up.ts` (active-epic → manual pin → `demandScore` desc → recency). Unit-tested: 10 scoring + 2 ordering cases. Note: `recommend.ts` retune and `create/update_backlog_item` input passthrough are folded forward into a follow-up (score is settable via `score_demand_item` today).

1. **Schema (additive, fleet-safe).** Add nullable columns to `BacklogItem`: `reach Int?`, `impact Float?`, `confidence Float?`, `businessValue Int?`, `timeCriticality Int?`, `riskOpportunity Int?`, `jobSize Float?`, `demandScore Float?`, `demandScoreFramework String?`, `demandScoreComputedAt DateTime?`, `demandStage String?`. One migration; all nullable → passes the migration-safety guard (no tightening on existing rows). `prisma migrate dev` on a throwaway Postgres, trim to these columns.
2. **Enums.** Add `DEMAND_STAGE_VALUES` (`raw|screened|shaped|ready`) and `DEMAND_SCORE_FRAMEWORKS` (`rice|wsjf|value_effort|weighted`) to `apps/web/lib/explore/backlog.ts`, mirrored in the `mcp-tools.ts` tool schemas in the **same commit** (AGENTS.md §3).
3. **Pure scoring lib.** `apps/web/lib/demand/scoring.ts` — `computeDemandScore(inputs, framework, weights)` implementing RICE (`(reach×impact×confidence)/effort`), WSJF (`(businessValue+timeCriticality+riskOpportunity)/jobSize`), value_effort (rank), weighted. No server imports. Unit test on 4 fixtures (one per framework) + edge cases (missing input → `null`, not a crash).
4. **Derivations.** Seed `reach` from `occurrenceCount` and `jobSize` from `effortSize` (map S=1,M=3,L=8,XL=20) at score time when the explicit field is null.
5. **MCP surface.** New `score_demand_item` (sets inputs, recomputes, writes `demandStage=screened` when the minimum inputs are present); extend `create_backlog_item`/`update_backlog_item` to accept the inputs; extend `list_backlog_items`/`get_backlog_item`/`query_backlog` to return `demandScore`+`demandStage`. Enum mirrors updated.
6. **Ranking-order change.** In `apps/web/lib/governed-backlog-tee-up.ts`, change the *ordering* signal (not the Definition-of-Ready) so the promote sweep and `get_next_recommended_work` draw highest `demandScore`-per-portfolio-envelope first; `priority Int` becomes an explicit manual override that trumps the computed rank. Update `recommend.ts` to replace the flat `priority present +2` term with the normalized `demandScore`.
7. **Tests.** Scoring fixtures; ordering test (higher score promoted first); migration applies on fresh Postgres (CI).

**Acceptance:** every build-eligible item can carry a computed, explainable `demandScore`; the promote sweep orders by it; `priority` still overrides; no UI yet (surfaces via existing `/ops` list sorted by score). Verify on live install per `dpf-verify-on-live-install`.

### Phase 2 — Demand board (BI-A2705E51) · *UX-Fit gated* — ✅ LANDED

**Landed:** `/ops/demand` route + `DemandBoard` client (Funnel kanban `raw/screened/shaped/ready` + Value×Effort matrix with median-split quadrants), pure `lib/demand/board.ts` (grouping, matrix, value/size bands) unit-tested (5), server loader `demand-data.ts`, "Demand" tab added to the Delivery nav group, route-manifest regenerated. Progressive disclosure: card front shows value band + effort with a "Why this score?" drill-in. `var(--dpf-*)` tokens only; existing `/ops` list retained.

`dpf-ux-fit-review` first. A `/ops` Demand view (progressive disclosure): **Funnel** kanban (`raw→screened→shaped→ready`, drag advances, gate rules server-enforced), **Matrix** (value×effort 2×2 with quadrant labels), card front = "how valuable" + "how big" with a "Why this score" drill-in showing the formula + per-input contribution. `var(--dpf-*)` tokens only; existing `/ops` list retained as flat fallback. Playwright e2e.

**Acceptance:** a non-technical operator sees what's asked, how valuable, how big, and what to fund next in one surface, with no raw framework token on the front.

### Phase 3 — Investment buckets & portfolio balance (BI-E5526151)

`investmentBucket String?` (`run|grow|transform`, default derived from `workType`: bug/chore/refactor→run, feature→grow) on `BacklogItem`/`Epic`; `Portfolio.bucketTargets Json?` (allocation %). Portfolio-balance tab: actual-vs-target bucket mix, flag when near-term work starves Transform; coarse `jobSize`-summed-vs-`budgetKUsd` capacity read. Lightweight themes via org-overlay WWWD `stance` `WikiPage` (`themePageId`), rolled up per portfolio. Depends on Phase 1.

**Acceptance:** portfolio views show actual-vs-target investment balance; demand rolls up by theme.

### Phase 4 — Governed scoring policy (BI-5E0995D5)

Move the active framework, weights, and bucket targets out of code into an org-overlay WWWD `stance` authored via `/wiki/stance`. Route investment-approval (`screened→ready`) and manual `priority` overrides through `principle_decide` → `DecisionInteraction` ledger. Wire demand gap/conflict/staleness findings into the Decision Review workspace (EP-DECISION-GOV-SURFACE §4.3). Depends on Phases 1 + 3.

**Acceptance:** scoring policy editable as WWWD doctrine (portal, not code); every funding call auditable in Decision Review.

### Phase 5 — Semantic dedup & merge at ingest (BI-F6B290A8) · *sequenced last*

Extend `ingestBacklogItem` with an embedding-based semantic dedup pass (qdrant) over open items in the same portfolio; "merge or link" before write; merge re-parents `occurrenceCount`/evidence/requesters onto the survivor (concentrates reach → higher score) and sets `duplicateOfId` + redirect; suppression writes a `ToolExecution` audit row. Reuses the existing `duplicateOfId`/`duplicates[]` relation. Last because it depends on scoring being live and is the highest-risk change to the intake hot path.

**Acceptance:** near-duplicate demand is merged with reach transferred; suppression is audited.

## Build order

`1 (foundation, enabler) → 2 (board) ∥ 3 (buckets)` — 2 and 3 both depend only on 1 and can run in parallel — `→ 4 (governance, needs 1+3) → 5 (dedup, needs 1)`.

## Substrate decisions (verified)

- **No parallel Demand model** — kernel-decided (DI-531D84C6EB8F); demand is a facet of `BacklogItem`.
- **`demandStage` is an additive facet**, orthogonal to `status` (which continues to gate work-claims). Rejected: overloading `status`.
- **Store inputs, compute score** — pluggable framework without schema churn (spec §5.1).
- **Reuse, don't rebuild:** `occurrenceCount`→reach, `effortSize`→jobSize, `duplicateOfId`/`duplicates[]`, `Portfolio.budgetKUsd`, the product-dependency cascade ([2026-06-22 plan](2026-06-22-portfolio-prioritization-cascade.md)), the WWWD stance corpus, `principle_decide`/`DecisionInteraction`.
- **Completes the shelved WSJF engine** BI-30EE393B (designed, never built) as a seeded preset — not a green-field reinvention.

## Deferred (own BIs, not this epic)

Full capacity-vs-demand resource modeling; first-class OKR/Objective model (only if the lightweight theme-link proves insufficient — open question Q3); completing the **Innovation Radar** intake (`InnovationProposal` model, designed [2026-05-10](../specs/2026-05-10-build-studio-business-intake-innovation-radar-design.md), never shipped) as the market-signal demand source; Kano / Opportunity-scoring presets.

## Open questions for the operator (from spec §14)

1. Funnel granularity: 4-stage `raw/screened/shaped/ready` (recommended) vs leaner/heavier.
2. Default scoring framework: **RICE** (recommended, maps to existing fields) vs WSJF as the *seeded default* — both ship as presets.
3. Strategic themes: lightweight WWWD-stance-page themes now (recommended) vs a first-class OKR model.
4. Bucket taxonomy label: **Run/Grow/Transform** (recommended) vs Horizon 1/2/3.
5. Phase-1 stop point: is the invisible scoring foundation (score + reordered promote, no UI) enough to react to before committing the Demand board?
