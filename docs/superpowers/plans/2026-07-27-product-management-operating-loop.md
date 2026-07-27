# Product Management Operating Loop Implementation Plan

> **For implementation agents:** Execute this plan through the live child BacklogItems under `EP-ED496EB0`. Do not implement the x-large umbrella `BI-5C5FA641` as one branch or one build. Revalidate the plan coverage receipt before starting each child.

**Goal:** Give professional product managers and small-business owner-operators one coherent loop for managing product lines, products, commercial packaging, customer consumption, intelligence, investment, roadmaps, and outcomes without exposing unnecessary architectural complexity.

**Architecture:** Establish a business ProductLine/Product hierarchy without broadening EEMD, then separate the producer lifecycle from Offering → CatalogItem → optional reusable SKU/configuration → channel → quote/order → Product Sold consumption traceability. Reuse and converge existing storefront, quote/order, research, battlecard, knowledge, demand, decision, scheduling, architecture, and delivery substrate behind an organization/product-line/product `ProductOperatingContext`. Necessary model complexity must ship with derived defaults, guided creation, contextual navigation, and progressive disclosure.

**Design:** `docs/superpowers/specs/2026-07-27-product-management-operating-loop-design.md`

**Epic:** `EP-ED496EB0`

**Umbrella:** `BI-5C5FA641`

**Kernel decisions:** `DI-8B3E5799CA59` (projected operating loop) and `DI-26D56D03E6BD` (complete model with progressive exposure, refined as a complexity/usability tradeoff)

## Delivery graph

| Order | Deliverable | Backlog item | Depends on |
| --- | --- | --- | --- |
| 1 | Business product-line hierarchy and mixed-line setup | `BI-AD7F9D34` | — |
| 2 | Product, Offering, CatalogItem, and channel-projection contract | `BI-6C5C648B` | `BI-AD7F9D34` |
| 3 | Catalog Builder, packaging, reusable configurations, and one-off sale snapshots | `BI-83C7D9EE` | `BI-6C5C648B` |
| 4 | Product Sold and consumer/subscriber traceability | `BI-574638B7` | `BI-83C7D9EE` |
| 5 | Organization/product-line/product operating-context projection | `BI-AE062121` | `BI-AD7F9D34`, `BI-6C5C648B` |
| 6 | Role-adaptive Product Direction workspace | `BI-C2C08E30` | `BI-AE062121` |
| 7 | Product and product-line continuous intelligence | `BI-FB049FCD` | `BI-AE062121` |
| 8 | Evidence-backed demand activation | `BI-9E608678` | `BI-AE062121` |
| 9 | Product objective and outcome-learning contract | `BI-162FBDCC` | `BI-AE062121` |
| 10 | Product-line performance rollups and proactive WWWD advice | `BI-FE61EEE3` | `BI-AD7F9D34`, `BI-AE062121` |
| 11 | Derived product and product-line roadmaps | `BI-8C87657A` | `BI-9E608678`, `BI-162FBDCC`, `BI-AD7F9D34` |
| 12 | PM/owner playbooks, portability, guidance, and adoption evidence | `BI-B7621682` | `BI-C2C08E30`, `BI-FB049FCD`, `BI-9E608678`, `BI-162FBDCC`, `BI-FE61EEE3`, `BI-8C87657A` |

Across the delivery graph, reserve approximately 20% of total implementation capacity for query boundaries, compatibility adapters, typed contracts, removal of duplicated joins/rules, navigation convergence, and invariant coverage. Track that allocation explicitly in child plans; do not consume it with visible feature work.

## Phase 1 — Product-line hierarchy and mixed-line setup (`BI-AD7F9D34`)

### Task 1.1: Verify and define the business-product contract

1. Re-run the Prisma, route, action, archetype-composition, taxonomy, and live-data audit.
2. Prove the boundary between EEMD `DigitalProduct`, business ProductLine/Product, and enabling manufacturing/delivery capabilities.
3. Define hierarchy, lifecycle, ownership, and rollup invariants with failing contract tests before schema changes.
4. Use canonical string-enum registries and exact MCP mirrors for any fixed values.

### Task 1.2: Add fleet-safe product-line substrate

1. Add ProductLine/Product relations expand-first; preserve current portfolio and storefront behavior.
2. Rename the canonical user-facing portfolio label to **Goods and Services for Sale** while preserving the stable `products_and_services_sold` slug and imported source terminology.
3. Backfill only deterministic existing product relationships. Leave ambiguous records explicitly unclassified.
4. Add cycle prevention, organization isolation, stable ordering, and rollup tests.
5. Add compatibility adapters so current digital products can participate without changing EEMD semantics.

### Task 1.3: Capture “what the business sells” during setup

1. Extend setup to select a primary line and common adjacent lines in business language.
2. Derive archetype composition, starter hierarchy, and default one-to-one commercial records behind the UI.
3. Provide guided creation and contextual explanation when a mixed business needs additional lines.
4. Verify hotel+events, restaurant+events, salon+goods, vehicle+finance/insurance, construction+configured-home fixtures.

**Phase gate:** schema and invariant tests, production build, migration apply, and setup UX verification across simple and mixed-line archetypes.

## Phase 2 — Product and catalog contract (`BI-6C5C648B`)

### Task 2.1: Lock the producer/consumer boundaries

1. Define tested contracts for Product, commercial Offering, canonical CatalogItem, and channel projection.
2. Audit `ServiceOffering`, `StorefrontItem`, `QuoteLineItem`, actions, and integrations before selecting names or relations.
3. Prove why every new distinction has a separate lifecycle, ownership, traceability, reuse, or control need.
4. Record the compatibility and deprecation sequence; do not one-step rename or repurpose live models.

### Task 2.2: Implement expand-first compatibility

1. Add the canonical commercial records and nullable compatibility links.
2. Treat `StorefrontItem` as a channel projection while preserving existing routes and APIs.
3. Auto-provision/collapse one-to-one Product → Offering → CatalogItem cases.
4. Add dual-read/write observability and invariant guards before switching authority.

### Task 2.3: Ship the complexity-compensation UX

1. Present the common case as one “what you sell” workflow.
2. Reveal offerings/catalog items only when channels, terms, prices, or availability diverge.
3. Add guided creation, sensible defaults, breadcrumbs, related-record navigation, and advanced audit drill-down.
4. Run a portal-navigation audit before adding any route or navigation layer.

**Phase gate:** compatibility/invariant tests, build, representative-data migration, and simple/divergent case UX verification.

## Phase 3 — Catalog Builder and configuration (`BI-83C7D9EE`)

### Task 3.1: Define packaging and configuration contracts

1. Model bundles, promotions, price-list entries, validity, channel presentation, and quote-required rules as consumption packaging.
2. Distinguish reusable standard configurations/SKUs from immutable sale-specific quote/order snapshots.
3. Keep bundles linked to component products/catalog items without rewriting product hierarchy.
4. Define explicit promotion of a successful one-off configuration into a reusable catalog configuration.

### Task 3.2: Extend Catalog Builder

1. Reuse the internal Storefront management home and existing quoting/order services.
2. Support fixed price-list purchases, configurable products, off-the-lot selection, seasonal packages, and negotiated quotes.
3. Show quote workflow only when commercial rules require it.
4. Prevent automatic SKU/catalog proliferation from one-off configured sales.

### Task 3.3: Guard financial attribution

1. Define component versus package attribution and anti-double-counting rules.
2. Add tests for car+loan+insurance, full dinner versus à la carte, and haircut+shave promotions.
3. Preserve historical package/configuration snapshots after catalog changes.

**Phase gate:** packaging/configuration tests, build, migration apply, and end-to-end catalog→purchase UX verification.

## Phase 4 — Product Sold traceability (`BI-574638B7`)

### Task 4.1: Verify adjacent substrate and define the extension

1. Audit SalesOrder, Quote, Subscription, account/contact, installed-product, and consumer/subscriber concepts.
2. Document current CSDM boundaries and label Product Sold as a proposed DPF/CSDM extension.
3. Define identity, lifecycle, fulfillment, configuration snapshot, ownership, and consuming-party rules.

### Task 4.2: Add purchase-to-consumption traceability

1. Link fulfilled customer instances to Product, Offering, CatalogItem, selected reusable configuration or sale snapshot, order, and account/consumer/subscriber.
2. Keep price-list purchases valid without a Quote.
3. Preserve audit history when catalog definitions, ownership, or status later change.
4. Add organization isolation, authorization, and duplicate-fulfillment guards.

### Task 4.3: Add contextual consumption views

1. Provide authorized trace/drill-down from product and order contexts.
2. Keep operational details progressively disclosed and use business-language labels.
3. Verify fixed service, subscription, physical good, configurable good, and bundle cases.

**Phase gate:** lifecycle/trace tests, production build, migration apply, and purchase-to-customer-instance UX verification.

## Phase 5 — Canonical product operating context (`BI-AE062121`)

### Task 5.1: Lock the projection contract with tests

**Files:**

- Create: `apps/web/lib/product-management/product-operating-context.ts`
- Create: `apps/web/lib/product-management/product-operating-context.test.ts`
- Modify: `apps/web/lib/portfolio/digital-product-view-model.ts`

1. Write failing tests for organization, product-line, and product contexts containing product posture, commercial/consumption posture, evidence freshness, demand readiness, decisions, objectives, roadmap inputs, delivery changes, and scheduled playbooks.
2. Require every projected item to carry its canonical ID, source kind, and `asOf`.
3. Implement a pure typed assembler whose inputs are explicit query results.
4. Refactor overlapping product-view joins into shared adapters without changing existing page behavior.
5. Run targeted Vitest and product-page tests.

### Task 5.2: Add optional product scope to research and battlecards

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_product_scope_to_research_and_battlecards/migration.sql`
- Modify: `apps/web/lib/wiki/research-schedule.ts`
- Modify: `apps/web/lib/wiki/research-execution.ts`
- Modify: `apps/web/lib/marketing/battlecards.ts`
- Modify: `apps/web/lib/mcp/packs/marketing-pack.ts`
- Add or modify colocated tests.

1. Add nullable `digitalProductId` foreign keys and indexes to `ResearchProposal` and `MarketingBattlecard`.
2. Add inverse relations on `DigitalProduct`.
3. Preserve all existing rows as organization-wide; do not infer product scope.
4. Propagate proposal scope to the resulting product-linked knowledge article.
5. Extend existing tool inputs/outputs rather than creating duplicate PM tools.
6. Add migration safety attestation for additive nullable changes and verify clean application.

### Task 5.3: Add query and authorization adapters

**Files:**

- Create: `apps/web/lib/product-management/product-operating-context-query.ts`
- Create: `apps/web/lib/product-management/product-operating-context-query.test.ts`
- Modify existing authorization helpers only where needed.

1. Resolve the organization, requested product-line/product scope, and caller authorization once.
2. Fetch each bounded context slice with explicit limits and stable ordering.
3. Keep organization-wide evidence distinguishable from product-specific evidence.
4. Test cross-organization isolation, partial data, stale data, and deleted references.
5. Confirm the existing product overview and knowledge paths remain unchanged.
6. Verify product-line rollups distinguish direct product measures from bundle/package attribution.

**Phase gate:** targeted tests, production build, migration validation/apply, and read-model performance evidence.

## Phase 6 — Product Direction workspace (`BI-C2C08E30`)

### Task 6.1: Extend the existing product navigation

**Files:**

- Modify: `apps/web/components/product/ProductTabNav.tsx`
- Modify: `apps/web/components/product/ProductTabNav.test.tsx`
- Create: `apps/web/app/(shell)/portfolio/product/[id]/direction/layout.tsx`
- Create: `apps/web/app/(shell)/portfolio/product/[id]/direction/page.tsx`
- Create colocated route tests.

1. Add one `Direction` family with Brief, Intelligence, Roadmap, and Outcomes subitems.
2. Preserve current family active-state behavior and responsive SectionNav semantics.
3. Do not add a global navigation destination.
4. Adapt vocabulary and information density for owner-operators and professional product managers without forking the underlying model.
5. Add the action-oriented first viewport in the order defined by the design.
6. Implement explicit loading, empty, partial, stale, failed, and unauthorized states.

### Task 6.2: Build reusable direction components

**Files:**

- Create: `apps/web/components/product/direction/ProductDirectionBrief.tsx`
- Create: `apps/web/components/product/direction/NeedsDecisionList.tsx`
- Create: `apps/web/components/product/direction/EvidenceDeltaList.tsx`
- Create: `apps/web/components/product/direction/CurrentBets.tsx`
- Create: `apps/web/components/product/direction/OutcomePosture.tsx`
- Create matching tests and stories/examples where the repo convention requires them.

1. Reuse report-kit, knowledge, filter, staleness, and status primitives.
2. Keep one primary action and use progressive disclosure for source detail.
3. Provide guided creation and contextual navigation whenever the user crosses product, catalog, consumption, or outcome layers.
4. Show facts, calculations, and AI inferences with distinct labels.
5. Verify keyboard flow, focus, contrast, 200% zoom, and narrow viewport behavior.

### Task 6.3: Add preview-before-mutation interactions

1. Build a shared preview panel for product-context coworker actions.
2. Show read scope, proposed writes, sources, approval boundary, and schedule effect.
3. Route mutations to existing governed tools.
4. Add authorization and cancellation tests.

**Phase gate:** targeted tests, production build, and browser verification across desktop/narrow/empty/stale/unauthorized states.

## Phase 7 — Continuous intelligence (`BI-FB049FCD`)

### Task 7.1: Refactor the legacy competitive-analysis path

**Files:**

- Modify: `skills/storefront/competitive-analysis.skill.md`
- Modify: `apps/web/lib/wiki/market-research.ts`
- Modify: `apps/web/lib/wiki/research-schedule.ts`
- Modify: `apps/web/lib/wiki/research-execution.ts`
- Modify: `apps/web/lib/marketing/battlecards.ts`
- Modify associated tests and prompt/tool registration where verified.

1. Replace guided, user-supplied-only analysis with a product-scoped workflow over existing cited research and battlecards.
2. Preserve the approval gate before web/LLM execution and draft review before publication.
3. Produce “changed since last reviewed run” output, not full repeated reports.
4. Record source URLs, retrieval time, scope, and confidence.
5. Update or resolve the stale competitive-signal backlog item if its acceptance criteria are fulfilled.

### Task 7.2: Add Intelligence page and scheduling controls

**Files:**

- Create: `apps/web/app/(shell)/portfolio/product/[id]/direction/intelligence/page.tsx`
- Create: `apps/web/components/product/direction/ProductIntelligence.tsx`
- Modify existing scheduled-agent-task actions/components where reusable.

1. Separate pending proposals, reviewed findings, competitive cards, and stale evidence.
2. Support propose, preview, approve, decline, schedule, pause, and rerun.
3. Make organization-wide vs product-scoped evidence obvious.
4. Add useful first-run and no-source empty states.

**Phase gate:** research/battlecard/schedule tests, build, and approval/publish boundary UX verification.

## Phase 8 — Demand activation (`BI-9E608678`)

### Task 8.1: Define and test activation rules

**Files:**

- Modify: `apps/web/lib/backlog.ts`
- Modify: `apps/web/lib/actions/backlog.ts`
- Modify: `apps/web/components/ops/DemandBoard.tsx`
- Add targeted tests.

1. Define the closed transition rules for intake, evidence readiness, scoring readiness, funding, and delivery.
2. Require score explanations to expose value inputs, estimate provenance, confidence, and missing fields.
3. Keep “unclassified” explicit until a deterministic migration rule is proven.
4. Add guards so new product demand cannot silently bypass classification after activation.

### Task 8.2: Remediate legacy demand fleet-safely

**Files:**

- Create a fleet-safe migration only if a deterministic backfill is proven.
- Otherwise create a governed classification job and leave database values untouched until reviewed.
- Add an invariant detector/test for new null-stage product demand.

1. Analyze live categories before writing any backfill.
2. Quarantine ambiguity into the unclassified queue rather than inventing scores.
3. Keep the operation idempotent and auditable.
4. Capture before/after counts and rollback/recovery behavior.

### Task 8.3: Integrate product evidence and funding decisions

1. Link demand to reviewed product knowledge and objective candidates.
2. Reuse the existing funding approval decision tool.
3. Surface funding rationale and decision history in the product context.
4. Add activation/funnel telemetry that measures completeness, not raw clicks.

**Phase gate:** targeted tests, build, migration/job evidence, and end-to-end demand-to-funding UX verification.

## Phase 9 — Objectives and outcome learning (`BI-162FBDCC`)

### Task 9.1: Add canonical enums and models

**Files:**

- Create: `apps/web/lib/product-management/outcomes.ts`
- Create: `apps/web/lib/product-management/outcomes.test.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_product_objectives/migration.sql`
- Modify MCP schema/pack files selected by code-graph verification.

1. Define canonical statuses, measure kinds, source kinds, and contribution kinds.
2. Mirror enum values exactly in MCP inputs.
3. Add `ProductObjective`, `ProductObjectiveWork`, and append-only `ProductOutcomeObservation`.
4. Add organization/product authorization through the product relation.
5. Validate the schema before migration and apply the additive migration against representative data.

### Task 9.2: Implement objective/outcome services and tools

1. Create, update, review, close, and archive objectives with legal transitions.
2. Link contributing backlog work without changing backlog ownership.
3. Append observations; corrections supersede prior observations.
4. Calculate posture against baseline/target only for compatible typed measures.
5. Test qualitative measures, overdue reviews, missing baselines, and unauthorized products.

### Task 9.3: Add Outcomes page

**Files:**

- Create: `apps/web/app/(shell)/portfolio/product/[id]/direction/outcomes/page.tsx`
- Create: `apps/web/components/product/direction/ProductOutcomes.tsx`
- Add associated tests.

1. Lead with due reviews and changed outcome posture.
2. Show contributing funded/delivered work and supporting observations.
3. Guide creation of a first outcome without requiring an OKR vocabulary.
4. Provide clear review, close, and “insufficient evidence” paths.

**Phase gate:** enum/schema guards, targeted tests, build, migration apply, and objective-to-observation UX verification.

## Phase 10 — Product-line rollups and proactive WWWD advice (`BI-FE61EEE3`)

### Task 10.1: Define the bounded performance projection

1. Inventory available finance, CRM, storefront, booking, demand, delivery/capacity, and outcome measures by archetype.
2. Define measure availability, freshness, confidence, currency/unit normalization, and attribution contracts.
3. Aggregate bottom-up from products to product lines without creating a second analytics ledger.
4. Add reconciliation tests for bundles, returns/cancellations, shared costs, missing measures, and cross-line products.

### Task 10.2: Add comparative insight and opportunity detection

1. Compare product and product-line performance over explicit periods and baselines.
2. Detect evidence-backed shifts such as goods outgrowing services, event demand emerging, or delivery capacity constraining a strong line.
3. Separate sourced facts, calculations, and AI inferences.
4. Require every recommendation to cite its measures, `asOf`, confidence, and known blind spots.

### Task 10.3: Deliver role-adaptive WWWD advice

1. Present the same underlying insight in owner-operator and professional-PM vocabulary/density.
2. Provide a contextual next action—investigate, market, adjust capacity, test an offering, or defer—not an autonomous business mutation.
3. Let users drill from line-level advice to products, measures, packages, and source records.
4. Capture correction, dismissal, decision, and later outcome evidence so advice quality can be evaluated.

**Phase gate:** projection/reconciliation tests, build, and browser verification for multi-line, sparse-data, stale, bundle-heavy, owner-operator, and professional-PM fixtures.

## Phase 11 — Derived roadmaps (`BI-8C87657A`)

### Task 11.1: Implement the projection contract

**Files:**

- Create: `apps/web/lib/product-management/product-roadmap.ts`
- Create: `apps/web/lib/product-management/product-roadmap.test.ts`

1. Derive candidates from funded demand linked to objectives.
2. Combine release/change dates, dependency state, and architecture constraints.
3. Compute sequence and timing confidence without inventing dates.
4. Explain inclusion, movement, blockers, and evidence changes.
5. Test contradictory, missing, cyclic dependency, and partially funded cases.

### Task 11.2: Add roadmap views

**Files:**

- Create: `apps/web/app/(shell)/portfolio/product/[id]/direction/roadmap/page.tsx`
- Create: `apps/web/components/product/direction/ProductRoadmap.tsx`
- Create view components/tests using existing report-kit patterns.

1. Implement Now/Next/Later as the default.
2. Add timeline, outcome, and dependency views only over the same projection.
3. Route edits back to canonical funding, dependency, objective, or delivery controls.
4. Preserve filters in existing user preferences if substrate verification confirms fit.
5. Verify dense, sparse, blocked, and undated roadmaps responsively.

### Task 11.3: Add review and portable snapshots

1. Record stakeholder review through the existing decision/audit substrate.
2. Export a timestamped snapshot with filters, source IDs, `asOf`, and confidence.
3. Optionally retain a reviewed narrative snapshot as product-linked knowledge.
4. Test that exports do not become importable planning authorities.

**Phase gate:** projection tests, build, multi-view UX verification, review audit, and export inspection.

## Phase 12 — Playbooks, portability, and adoption (`BI-B7621682`)

### Task 12.1: Package reusable PM workflows

**Files:**

- Create or update skills under the verified product-management skill category.
- Modify prompt templates under `prompts/<verified-category>/`.
- Extend existing `ScheduledAgentTask` registration/actions rather than adding a scheduler.
- Add skill/prompt seed and contract tests.

1. Package product/product-line intelligence, demand triage, investment preparation, roadmap refresh, commercial-opportunity review, and outcome review recipes.
2. Declare inputs, tools, output contract, proposed writes, approvals, schedule, and failure behavior.
3. Scope each run explicitly to an organization, product line, or product and persist only canonical outputs.
4. Trigger regeneration when relevant canonical records change, with deduplication and rate limits.

### Task 12.2: Add scheduling and run visibility

1. Preview first run and every changed permission/write scope.
2. Support schedule, pause, resume, rerun, and inspect.
3. Show partial success without presenting stale output as current.
4. Record run provenance and correction/override outcomes.

### Task 12.3: Complete guidance, export, and telemetry

**Files:**

- Modify relevant pages under `docs/user-guide/`.
- Modify in-app help selected by route ownership.
- Add telemetry/query tests in the owning analytics modules.

1. Document the product-manager loop in task language.
2. Explain evidence, score, roadmap confidence, approval, and outcome review.
3. Add portable brief export using the same provenance contract as roadmap exports.
4. Instrument the success and guardrail measures in the design.
5. Review defaults after a pilot; do not enable automatic schedules globally without evidence.

**Phase gate:** skill/prompt/schedule tests, build, complete recurring-workflow UX verification, export inspection, and documentation review.

## Cross-cutting verification contract

Every child branch must:

1. use a dedicated worktree and current `origin/main`;
2. re-run substrate verification before adding a model, enum, route, tool, or scheduler;
3. write the failing behavior/contract test first for code changes;
4. run targeted Vitest for affected files;
5. run `pnpm --filter web build`;
6. use the shared local-CI convergence sandbox for runtime-bound gates;
7. exercise UI/agent/workflow changes in the browser, including narrow and non-happy states;
8. validate and apply migrations against representative existing data;
9. update the user guide, architecture history, prompts, and external-agent guidance when affected;
10. prove that every added architectural distinction earns its complexity and that the compensating defaults, guidance, navigation, and disclosure behavior work;
11. record UX and migration disposition in completion evidence.

## Plan-to-backlog coverage

This plan is deliberately decomposed. The governed receipt must map every independently shippable phase to the live child item shown in the Delivery graph. Copy the receipt ID and validation result below after calling `record_plan_backlog_coverage`, then revalidate it before implementation:

- **Coverage receipt:** `cms3q768w0kcy01p5n2828io1`
- **Validation:** decomposed; all 12 independently shippable deliverables resolve to live, build-triaged BacklogItems with governed dependency mappings

## Completion criteria for the epic

The epic may close only when:

- all twelve child items are done with proportional verification evidence;
- an owner-operator can define a mixed-line business without encountering unnecessary catalog architecture;
- a professional product manager can drill from product-line performance through products, commercial packaging, consumption, evidence, demand, investment, roadmap, delivery, and outcomes;
- simple one-to-one products remain simple to create and navigate, while complex configurable/bundled/quoted cases retain complete traceability and guided workflows;
- one-off configurations do not create uncontrolled reusable SKUs, and bundle attribution does not double count product-line performance;
- a manager can move through evidence → demand → funding → objective → roadmap → delivery → observation for one product;
- the live roadmap contains no manually synchronized duplicate authority;
- research and AI mutations preserve approval, source, freshness, and audit contracts;
- existing organization-wide research, battlecards, backlog, product routes, storefront items, quotes, and orders remain compatible through their migration windows;
- success/guardrail telemetry is queryable;
- user and coworker guidance is current.
