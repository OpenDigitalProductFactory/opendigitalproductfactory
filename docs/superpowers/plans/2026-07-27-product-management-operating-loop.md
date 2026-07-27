# Product Management Operating Loop Implementation Plan

> **For implementation agents:** Execute this plan through the live child BacklogItems under `EP-ED496EB0`. Do not implement the x-large umbrella `BI-5C5FA641` as one branch or one build. Revalidate the plan coverage receipt before starting each child.

**Goal:** Give digital product managers a coherent, product-scoped loop from cited intelligence through demand, investment, roadmap communication, delivery, and measured outcomes.

**Architecture:** Reuse and converge the existing product, research, battlecard, knowledge, demand, decision, scheduling, architecture, and delivery substrates behind a typed `ProductOperatingContext`. Add only optional product associations and the missing objective/outcome contract. Roadmaps and briefs are derived views, not new sources of truth.

**Design:** `docs/superpowers/specs/2026-07-27-product-management-operating-loop-design.md`

**Epic:** `EP-ED496EB0`

**Umbrella:** `BI-5C5FA641`

**Kernel decision:** `DI-8B3E5799CA59`

## Delivery graph

| Order | Deliverable | Backlog item | Depends on |
| --- | --- | --- | --- |
| 1 | Canonical product operating-context projection | `BI-AE062121` | — |
| 2 | Product Direction workspace | `BI-C2C08E30` | `BI-AE062121` |
| 3 | Product-scoped continuous intelligence | `BI-FB049FCD` | `BI-AE062121` |
| 4 | Evidence-backed demand activation | `BI-9E608678` | `BI-AE062121` |
| 5 | Product objective and outcome-learning contract | `BI-162FBDCC` | `BI-AE062121` |
| 6 | Derived audience roadmaps | `BI-8C87657A` | `BI-9E608678`, `BI-162FBDCC` |
| 7 | PM playbooks, portability, guidance, and adoption evidence | `BI-B7621682` | `BI-C2C08E30`, `BI-FB049FCD`, `BI-9E608678`, `BI-162FBDCC`, `BI-8C87657A` |

The first deliverable is the explicit refactoring allocation. Reserve approximately 20% of total implementation capacity for query boundaries, adapters, typed contracts, removal of duplicated joins/rules, and invariant coverage. Do not consume that allocation with visible feature work.

## Phase 1 — Canonical product operating context (`BI-AE062121`)

### Task 1.1: Lock the projection contract with tests

**Files:**

- Create: `apps/web/lib/product-management/product-operating-context.ts`
- Create: `apps/web/lib/product-management/product-operating-context.test.ts`
- Modify: `apps/web/lib/portfolio/digital-product-view-model.ts`

1. Write failing tests for a context containing product posture, evidence freshness, demand readiness, decisions, objectives, roadmap inputs, delivery changes, and scheduled playbooks.
2. Require every projected item to carry its canonical ID, source kind, and `asOf`.
3. Implement a pure typed assembler whose inputs are explicit query results.
4. Refactor overlapping product-view joins into shared adapters without changing existing page behavior.
5. Run targeted Vitest and product-page tests.

### Task 1.2: Add optional product scope to research and battlecards

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

### Task 1.3: Add query and authorization adapters

**Files:**

- Create: `apps/web/lib/product-management/product-operating-context-query.ts`
- Create: `apps/web/lib/product-management/product-operating-context-query.test.ts`
- Modify existing authorization helpers only where needed.

1. Resolve the product and caller authorization once.
2. Fetch each bounded context slice with explicit limits and stable ordering.
3. Keep organization-wide evidence distinguishable from product-specific evidence.
4. Test cross-organization isolation, partial data, stale data, and deleted references.
5. Confirm the existing product overview and knowledge paths remain unchanged.

**Phase gate:** targeted tests, production build, migration validation/apply, and read-model performance evidence.

## Phase 2 — Product Direction workspace (`BI-C2C08E30`)

### Task 2.1: Extend the existing product navigation

**Files:**

- Modify: `apps/web/components/product/ProductTabNav.tsx`
- Modify: `apps/web/components/product/ProductTabNav.test.tsx`
- Create: `apps/web/app/(shell)/portfolio/product/[id]/direction/layout.tsx`
- Create: `apps/web/app/(shell)/portfolio/product/[id]/direction/page.tsx`
- Create colocated route tests.

1. Add one `Direction` family with Brief, Intelligence, Roadmap, and Outcomes subitems.
2. Preserve current family active-state behavior and responsive SectionNav semantics.
3. Do not add a global navigation destination.
4. Add the action-oriented first viewport in the order defined by the design.
5. Implement explicit loading, empty, partial, stale, failed, and unauthorized states.

### Task 2.2: Build reusable direction components

**Files:**

- Create: `apps/web/components/product/direction/ProductDirectionBrief.tsx`
- Create: `apps/web/components/product/direction/NeedsDecisionList.tsx`
- Create: `apps/web/components/product/direction/EvidenceDeltaList.tsx`
- Create: `apps/web/components/product/direction/CurrentBets.tsx`
- Create: `apps/web/components/product/direction/OutcomePosture.tsx`
- Create matching tests and stories/examples where the repo convention requires them.

1. Reuse report-kit, knowledge, filter, staleness, and status primitives.
2. Keep one primary action and use progressive disclosure for source detail.
3. Show facts, calculations, and AI inferences with distinct labels.
4. Verify keyboard flow, focus, contrast, 200% zoom, and narrow viewport behavior.

### Task 2.3: Add preview-before-mutation interactions

1. Build a shared preview panel for product-context coworker actions.
2. Show read scope, proposed writes, sources, approval boundary, and schedule effect.
3. Route mutations to existing governed tools.
4. Add authorization and cancellation tests.

**Phase gate:** targeted tests, production build, and browser verification across desktop/narrow/empty/stale/unauthorized states.

## Phase 3 — Continuous intelligence (`BI-FB049FCD`)

### Task 3.1: Refactor the legacy competitive-analysis path

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

### Task 3.2: Add Intelligence page and scheduling controls

**Files:**

- Create: `apps/web/app/(shell)/portfolio/product/[id]/direction/intelligence/page.tsx`
- Create: `apps/web/components/product/direction/ProductIntelligence.tsx`
- Modify existing scheduled-agent-task actions/components where reusable.

1. Separate pending proposals, reviewed findings, competitive cards, and stale evidence.
2. Support propose, preview, approve, decline, schedule, pause, and rerun.
3. Make organization-wide vs product-scoped evidence obvious.
4. Add useful first-run and no-source empty states.

**Phase gate:** research/battlecard/schedule tests, build, and approval/publish boundary UX verification.

## Phase 4 — Demand activation (`BI-9E608678`)

### Task 4.1: Define and test activation rules

**Files:**

- Modify: `apps/web/lib/backlog.ts`
- Modify: `apps/web/lib/actions/backlog.ts`
- Modify: `apps/web/components/ops/DemandBoard.tsx`
- Add targeted tests.

1. Define the closed transition rules for intake, evidence readiness, scoring readiness, funding, and delivery.
2. Require score explanations to expose value inputs, estimate provenance, confidence, and missing fields.
3. Keep “unclassified” explicit until a deterministic migration rule is proven.
4. Add guards so new product demand cannot silently bypass classification after activation.

### Task 4.2: Remediate legacy demand fleet-safely

**Files:**

- Create a fleet-safe migration only if a deterministic backfill is proven.
- Otherwise create a governed classification job and leave database values untouched until reviewed.
- Add an invariant detector/test for new null-stage product demand.

1. Analyze live categories before writing any backfill.
2. Quarantine ambiguity into the unclassified queue rather than inventing scores.
3. Keep the operation idempotent and auditable.
4. Capture before/after counts and rollback/recovery behavior.

### Task 4.3: Integrate product evidence and funding decisions

1. Link demand to reviewed product knowledge and objective candidates.
2. Reuse the existing funding approval decision tool.
3. Surface funding rationale and decision history in the product context.
4. Add activation/funnel telemetry that measures completeness, not raw clicks.

**Phase gate:** targeted tests, build, migration/job evidence, and end-to-end demand-to-funding UX verification.

## Phase 5 — Objectives and outcome learning (`BI-162FBDCC`)

### Task 5.1: Add canonical enums and models

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

### Task 5.2: Implement objective/outcome services and tools

1. Create, update, review, close, and archive objectives with legal transitions.
2. Link contributing backlog work without changing backlog ownership.
3. Append observations; corrections supersede prior observations.
4. Calculate posture against baseline/target only for compatible typed measures.
5. Test qualitative measures, overdue reviews, missing baselines, and unauthorized products.

### Task 5.3: Add Outcomes page

**Files:**

- Create: `apps/web/app/(shell)/portfolio/product/[id]/direction/outcomes/page.tsx`
- Create: `apps/web/components/product/direction/ProductOutcomes.tsx`
- Add associated tests.

1. Lead with due reviews and changed outcome posture.
2. Show contributing funded/delivered work and supporting observations.
3. Guide creation of a first outcome without requiring an OKR vocabulary.
4. Provide clear review, close, and “insufficient evidence” paths.

**Phase gate:** enum/schema guards, targeted tests, build, migration apply, and objective-to-observation UX verification.

## Phase 6 — Derived roadmaps (`BI-8C87657A`)

### Task 6.1: Implement the projection contract

**Files:**

- Create: `apps/web/lib/product-management/product-roadmap.ts`
- Create: `apps/web/lib/product-management/product-roadmap.test.ts`

1. Derive candidates from funded demand linked to objectives.
2. Combine release/change dates, dependency state, and architecture constraints.
3. Compute sequence and timing confidence without inventing dates.
4. Explain inclusion, movement, blockers, and evidence changes.
5. Test contradictory, missing, cyclic dependency, and partially funded cases.

### Task 6.2: Add roadmap views

**Files:**

- Create: `apps/web/app/(shell)/portfolio/product/[id]/direction/roadmap/page.tsx`
- Create: `apps/web/components/product/direction/ProductRoadmap.tsx`
- Create view components/tests using existing report-kit patterns.

1. Implement Now/Next/Later as the default.
2. Add timeline, outcome, and dependency views only over the same projection.
3. Route edits back to canonical funding, dependency, objective, or delivery controls.
4. Preserve filters in existing user preferences if substrate verification confirms fit.
5. Verify dense, sparse, blocked, and undated roadmaps responsively.

### Task 6.3: Add review and portable snapshots

1. Record stakeholder review through the existing decision/audit substrate.
2. Export a timestamped snapshot with filters, source IDs, `asOf`, and confidence.
3. Optionally retain a reviewed narrative snapshot as product-linked knowledge.
4. Test that exports do not become importable planning authorities.

**Phase gate:** projection tests, build, multi-view UX verification, review audit, and export inspection.

## Phase 7 — Playbooks, portability, and adoption (`BI-B7621682`)

### Task 7.1: Package reusable PM workflows

**Files:**

- Create or update skills under the verified product-management skill category.
- Modify prompt templates under `prompts/<verified-category>/`.
- Extend existing `ScheduledAgentTask` registration/actions rather than adding a scheduler.
- Add skill/prompt seed and contract tests.

1. Package weekly intelligence, demand triage, investment preparation, roadmap refresh, and outcome review recipes.
2. Declare inputs, tools, output contract, proposed writes, approvals, schedule, and failure behavior.
3. Scope each run to one product and persist only canonical outputs.
4. Trigger regeneration when relevant canonical records change, with deduplication and rate limits.

### Task 7.2: Add scheduling and run visibility

1. Preview first run and every changed permission/write scope.
2. Support schedule, pause, resume, rerun, and inspect.
3. Show partial success without presenting stale output as current.
4. Record run provenance and correction/override outcomes.

### Task 7.3: Complete guidance, export, and telemetry

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
10. record UX and migration disposition in completion evidence.

## Plan-to-backlog coverage

This plan is deliberately decomposed. The governed receipt must map every independently shippable phase to the live child item shown in the Delivery graph. Copy the receipt ID and validation result below after calling `record_plan_backlog_coverage`, then revalidate it before implementation:

- **Coverage receipt:** `cms3d0fbp03mb01p585znk4zf`
- **Validation:** decomposed; all 7 independently shippable deliverables resolve to live, build-triaged BacklogItems

## Completion criteria for the epic

The epic may close only when:

- all seven child items are done with proportional verification evidence;
- a manager can move through evidence → demand → funding → objective → roadmap → delivery → observation for one product;
- the live roadmap contains no manually synchronized duplicate authority;
- research and AI mutations preserve approval, source, freshness, and audit contracts;
- existing organization-wide research, battlecards, backlog, and product routes remain compatible;
- success/guardrail telemetry is queryable;
- user and coworker guidance is current.
