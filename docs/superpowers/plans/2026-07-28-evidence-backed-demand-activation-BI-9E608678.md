# Evidence-backed demand activation — BI-9E608678

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

**Backlog item:** `BI-9E608678`
**Epic:** `EP-ED496EB0`
**Parent branch:** `refactor/product-continuous-intelligence` at `f824d55b9b1f2710305e177c38c3815aa6088552`
**Topic branch:** `feat/evidence-backed-demand-activation`
**Work capsule:** `WC-2C13C78C`

## Outcome

Activate the existing `BacklogItem` demand substrate as a truthful product-management workflow:

1. product demand is explicitly classified rather than treating null as `raw`;
2. evidence, value inputs, confidence, and effort provenance are visible before scoring;
3. transitions are closed and explainable;
4. the existing organization-governed funding decision remains the only door into `ready`;
5. the Product Direction projection shows rationale and history without becoming a second demand authority.

This child does not add product objectives, roadmap records, product-line analytics, or playbooks. Those remain Phases 9–12.

## Backlog coverage

- **Receipt:** `cms58kaxb04jm01qwj6hq382c`
- **Decision:** atomic
- **Parent BI:** `BI-9E608678`
- **Mapped child BIs:** none

The Phase 8 outcome is one governed demand lifecycle over the existing `BacklogItem` authority. The additive scope/evidence schema has no safe standalone user outcome; classification without scoring/funding controls leaves ambiguous rows misrepresented; UI without guarded write doors recreates bypasses; and telemetry/docs must describe the same transition contract. These are internal sequencing slices of one reviewable BI, while Phases 9–12 remain separately filed and excluded.

| Deliverable | Depends on | Independently shippable |
| --- | --- | --- |
| Closed demand classification, readiness, transition, and explanation contract | — | No |
| Additive product scope and normalized reviewed-evidence links | activation contract | No |
| Explicit unclassified queue, new-write invariant, and fleet-safe audit | activation contract, scope and evidence | No |
| Canonical classify, evidence, score, and funding actions with append-only history | activation contract, scope and evidence | No |
| Progressive Delivery Flow and Product Direction projections | fleet classification, governed actions | No |
| Activation telemetry, documentation, fixtures, and verification evidence | operator experience | No |

## Grounding and live-state audit

### Existing authorities to extend

- `BacklogItem` already owns demand stage, value inputs, score, framework, investment bucket, estimate provenance, status, and delivery claims.
- `apps/web/lib/demand/scoring.ts` already computes RICE, WSJF, value/effort, and weighted scores from persisted scalar inputs.
- `apps/web/lib/mcp/packs/demand-scoring-pack.ts` already owns scoring, effort estimation, policy, and `approve_demand_for_funding`.
- `BacklogItemActivity` already owns the append-only entity timeline.
- `WikiPage` plus `WikiPageSource → RawSource` owns reviewed research and source provenance.
- `/ops/demand` and `DemandBoard` are the canonical cross-product investment/delivery flow.
- `ProductOperatingContext` is the canonical organization/product-line/product projection; Product Direction consumes that projection.
- Phase 7's product-intelligence scope validator is the nearest scope contract and will be generalized behind a compatibility adapter rather than copied.

### Live fleet evidence captured 2026-07-28

- 3,842 total `BacklogItem` rows.
- 3,842 rows have `demandStage = null`.
- 3,842 rows have `demandScore = null`.
- 1,350 rows are linked to a `DigitalProduct`; all remain unclassified.
- Product-linked distribution includes 1,301 deferred bugs, 26 done bugs, 21 open bugs, one deferred untyped item, and one open tool item.

No deterministic rule can infer historical funnel intent or score inputs from those categories. This branch therefore performs **no legacy stage or score backfill**. Null remains an explicit unclassified state and receives a governed review path.

## Architecture decision

**Question:** How should direct reviewed-evidence links and score provenance be persisted without creating a second idea/demand authority?

WWMD interaction `DI-DCE0871EAB68` compared:

1. a normalized demand-evidence child plus activity snapshots;
2. activity JSON as both current link and history;
3. JSON fields on `BacklogItem`.

**Decision:** normalized demand-evidence link, high confidence, composite 11.112 and margin 4.559.

`BacklogItem` remains the current-state authority. The normalized child carries queryable evidence references and review/provenance metadata. `BacklogItemActivity` carries immutable classification, scoring, and funding snapshots. The UI computes the current score explanation from canonical scalar fields and evidence links instead of persisting a duplicate explanation.

## Architecture review

- **Decision:** fits with guardrails.
- **Authority:** `BacklogItem`; no `Idea`, `Demand`, strategy-document, or roadmap authority is added.
- **Scope:** add nullable organization/product-line/business-product references to `BacklogItem` while preserving the existing `digitalProductId` contract. Generalize the Phase 7 scope validator and keep its old import as a compatibility adapter.
- **Evidence:** add one additive child relation for demand evidence. A reviewed `WikiPage` reference is relational; other evidence kinds use a closed source-kind contract plus stable source reference and an evidence snapshot. The child never owns the source fact.
- **History:** use `BacklogItemActivity` for append-only transition/score/funding snapshots; do not query it as the current score authority.
- **Funding:** reuse `approve_demand_for_funding`; make it require shaped/readiness-complete demand and record rationale plus the decision interaction.
- **Fleet safety:** expand-only nullable columns/table/indexes; no historical update and no tightening constraint. Add application invariants now; consider a later contract migration only after fleet convergence evidence.
- **Boundary:** business `Product`/`ProductLine` scope is distinct from `DigitalProduct`. At most one narrow target is selected. No provider team, consumer, subscriber, or entitlement is inferred.
- **Reporting:** Product Direction and Delivery Flow query the same canonical demand read model.
- **Telemetry:** derive classification/score/evidence/funding completeness from current records and activities; do not count clicks.

## UX-fit review

- **Decision:** fits with guardrails.
- **Owning areas:** Delivery for the canonical cross-product flow; Products for a scoped projection and contextual handoff.
- **Canonical routes:** `/ops/demand` and `/portfolio/product/[id]/direction`; no new global nav and no duplicate product-demand route.
- **Primary personas:** owner-operator first, professional product manager through progressive detail.
- **Navigation:** existing Delivery section navigation plus contextual links from Product Direction.
- **Reuse:** retain `DemandBoard`, report-kit status/empty-state primitives, Product Direction sections, and existing estimate controls. New UI is domain composition, not another visual language.
- **Source truth:** demand read model backed by `BacklogItem`, normalized evidence links, and `BacklogItemActivity`.
- **First viewport:** an explicit “Needs classification” queue, then evidence/readiness and funded bets. Null is never labeled `raw`.
- **Progressive disclosure:** cards show one next action and plain-language readiness; “Why this score?” reveals inputs, confidence, missing fields, evidence, estimate provenance, and calculation.
- **Empty/failure states:** distinguish no demand, unclassified demand, missing evidence, unscorable inputs, unresolved estimate divergence, funding declined/deferred, and unavailable product evidence.
- **AI boundary:** informational controls do not prompt. Coworker-prepared scores remain proposals; score writes and funding decisions expose context and require the existing explicit action/decision boundary.
- **Accessibility evidence:** keyboard operation, focus, narrow width, 200% zoom, theme tokens, and non-color status labels in the combined sandbox.

## Demand activation contract

`null` is **unclassified**, not an alias for `raw`.

| From | To | Required evidence |
| --- | --- | --- |
| unclassified | raw | explicit classification, or deterministic creation of a newly scoped product-demand item |
| raw | screened | a stated problem/outcome plus at least one active evidence link |
| screened | shaped | computable score, visible confidence, resolved effective effort provenance, and investment bucket |
| shaped | ready | existing organization-governed funding decision allows the investment |
| ready | delivery | existing backlog claim/status/build lifecycle; demand stage does not replace delivery status |

Backward movement is allowed only to the preceding non-funded stage with a recorded rationale. A funded item does not silently move backward; it requires a new governed funding/reconsideration activity. Terminal backlog statuses do not manufacture demand stages.

## Implementation sequence

### 1. Red: contract and projection tests

Add tests first for:

- null remains `unclassified` in funnel and flow projections;
- the transition table rejects skipping evidence, score readiness, or funding;
- explanations list framework inputs, effective effort source, confidence, missing fields, evidence count, and provisional state;
- one business-product scope does not fabricate or require a digital product;
- newly created scoped product demand gets an explicit `raw` intake stage;
- legacy rows remain null;
- funding refuses unclassified/raw/screened/incomplete items and records the allowed decision history;
- activation telemetry measures classified, evidence-linked, explainably scored, and funded-decision completeness.

Because the worktree is source-only, observe red/green in the combined leased sandbox if dependencies are unavailable locally. Never report an unexecuted test as red or green.

### 2. Expand the schema

Modify `packages/db/prisma/schema.prisma` and add one expand-only migration:

- nullable `organizationId`, `productLineId`, and `businessProductId` on `BacklogItem`;
- organization-consistent composite relations to `ProductLine` and `Product`;
- normalized `DemandEvidenceLink` child with stable semantic id, source kind/reference, optional reviewed `WikiPage`, summary, confidence, review timestamp, active/superseded status, provenance, and actor/timestamps;
- indexes and uniqueness needed for idempotent linking;
- no backfill, `NOT NULL`, validation, delete, or guessed relation.

Migration SQL must carry an explicit expand-first safety attestation and apply to any existing fleet state.

### 3. Refactor the canonical scope and transition boundaries

Generalize Phase 7's scope normalization/validation/query builders into a product-management scope module. Keep `product-intelligence-scope.ts` as a compatibility adapter so the Phase 7 branch contract remains stable.

Add pure modules for:

- demand classification and transition evaluation;
- score explanation/readiness;
- evidence-link validation and projection;
- activation telemetry.

This is the primary refactoring allocation and removes duplicated null-as-raw, ad-hoc readiness, and scope rules.

### 4. Governed writes and history

Extend the existing backlog actions and demand-scoring pack:

- classify a demand item;
- attach/deactivate reviewed evidence idempotently;
- score only through the shared readiness/explanation engine;
- persist a score snapshot activity containing exact inputs and estimate provenance;
- reuse funding approval, require `shaped`, preserve organization WWWD evaluation, and record rationale/interaction details;
- make all creation doors apply the same explicit stage rule for newly scoped product demand.

Do not invent scores, evidence, objectives, products, customers, or organizational structures.

### 5. Canonical reads and progressive UI

Update the demand read model and `DemandBoard` to:

- keep unclassified separate from `raw`;
- show classification/readiness before charts;
- explain calculation and missing fields;
- show evidence count/source review posture and effort provenance;
- offer only the valid next transition;
- filter by organization/product-line/business-product/digital-product scope without creating a second board.

Extend `ProductOperatingContext` demand items with scope, evidence/readiness, explanation, and relevant decision activities. Product Direction renders the scoped summary and links to the canonical filtered Delivery Flow.

### 6. Documentation and evidence

Update:

- product-management user guidance;
- Delivery Flow/demand guidance;
- architecture explanation of BacklogItem authority, scope, evidence, and history;
- setup/AI-coworker guidance where new demand creation behavior changes;
- this implementation history and PR body.

Record live before/after counts, source evidence, test/build/migration/UX evidence, and unresolved compatibility notes against `BI-9E608678`.

## Refactoring allocation

At least 20% of implementation capacity is reserved for:

- extracting the shared organization/product-line/business-product/digital-product scope contract;
- replacing null-as-raw duplication across funnel and flow;
- centralizing readiness/transition and score-explanation logic;
- compatibility adapters for Phase 7 imports and existing digital-product backlog callers;
- invariant tests covering every creation and funding door;
- removing duplicated score/readiness copy from UI and MCP handlers.

Feature work pauses if this allocation is consumed by new surface area without the boundary cleanup.

## Migration safety and recovery

- Expand-only nullable schema; historical rows remain untouched.
- The new child table starts empty and links only after explicit actions.
- Existing `/ops/demand` remains available through compatibility reads.
- Rollback is code rollback plus leaving unused nullable columns/table in place; no down migration or destructive cleanup.
- The combined sandbox records pre-migration counts, migration application, post-migration counts, and verifies all 3,842 legacy rows retain their prior null stage/score.
- Any later database constraint or backfill is a separate fleet-convergence decision.

## Verification

### Source-local

- changed-file parse and `git diff --check`;
- targeted pure-unit tests when dependencies are available;
- migration and schema guards.

### One combined leased sandbox for Phases 2–12

- sandbox freshness preflight;
- affected Vitest suites;
- production `web` build;
- all stacked migrations against existing data;
- Phase 8 end-to-end: classify → link reviewed evidence → score → explain → set bucket → fund/defer → inspect history;
- legacy unclassified queue and newly created product demand;
- owner-operator and professional-density projections;
- keyboard, narrow viewport, 200% zoom, empty/partial/failure/unauthorized states;
- regression across the simple one-line, salon + retail, hotel + events, and restaurant + private-events fixtures.

This BI remains `in-progress` until that combined evidence is recorded. It may be committed and pushed as a source checkpoint before the scarce sandbox run, but no test/build/migration/UX pass may be claimed from the source-only worktree.
