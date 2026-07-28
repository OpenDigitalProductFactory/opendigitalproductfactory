# Product Continuous Intelligence — BI-FB049FCD

> **For agentic workers:** execute this plan as one independently reviewable backlog item and one branch. Use `dpf-tdd` for red-green implementation, preserve the combined-stack sandbox gate requested for `EP-ED496EB0`, and use `dpf-pr-with-dco` for final handoff.

**Backlog item:** `BI-FB049FCD`
**Epic:** `EP-ED496EB0`
**Branch:** `refactor/product-continuous-intelligence`
**Parent stack:** `feat/product-direction-workspace` at `6ce9439475`
**Design:** `docs/superpowers/specs/2026-07-27-product-management-operating-loop-design.md`
**Parent plan:** `docs/superpowers/plans/2026-07-27-product-management-operating-loop.md`

## Outcome

Converge the stale guided competitive-analysis path into the existing cited research, proposal, battlecard, reviewed-wiki, scheduler, and Product Direction authorities. Product managers and owner-operators can distinguish organization-wide, product-line, business-product, and digital-architecture evidence; preview and propose research; approve or decline execution; inspect source provenance and changes since the last reviewed run; and schedule or pause a scoped watch without fabricating product teams, consumers, or mappings.

This BI does not implement product-line performance rollups or proactive business-level WWWD advice from Phase 10. It only makes reviewed intelligence available to the existing `ProductOperatingContext` boundary.

## Live-state and substrate audit

Audit date: 2026-07-28.

- Live backlog: `BI-FB049FCD` is the single Phase 7 child under `EP-ED496EB0`; no active Build Studio build or prior implementation evidence existed before this plan. The stale-skill signal is deferred `BI-SIG-5C38EE2A`.
- Live data: `ProductLine`, business `Product`, `ResearchProposal`, `MarketingBattlecard`, and `KnowledgeArticle` have zero rows. Eight `ScheduledAgentTask` rows exist, all platform/operations schedules; none is a product-intelligence watch.
- Current source: `ResearchProposal` and `MarketingBattlecard` already own organization/DigitalProduct scope on this stack. `runMarketResearch` produces cited prose; approval enqueues execution; `enrichOrgCorpus` owns reviewable draft knowledge. `ScheduledAgentTask` owns cadence, execution state, and pause behavior.
- Current gap: no existing typed relation can associate research, battlecards, or schedules with the business `ProductLine`/`Product` hierarchy. Generic `scopeType`/`scopeId` fields found in authority, assurance, and EA models are bounded to those domains and provide no referential integrity here.
- Current query boundary: `ProductOperatingContext` already projects research, battlecards, reviewed knowledge, and an explicitly unavailable scheduled-playbook slice. It must be extended, not replaced.
- Open-PR and `origin/main` sweep: no overlapping research/intelligence branch was open; recent marketing work does not add this scope contract.
- Canonical UI: the existing `/portfolio/product/[id]/direction/intelligence` route, `BusinessProductTabNav`, report-kit, knowledge cards, staleness primitives, and shared preview-before-mutation pattern are the owning surface.

**Substrate verdict:** extend the existing authorities. Do not create a second research engine, knowledge store, scheduler, product hierarchy, or product-intelligence watch authority.

## Governed decision

WWMD interaction `DI-8161DF4D2491` compared:

1. typed extension of the existing models;
2. a new typed schedule-adapter table;
3. metadata/prompt-based polymorphic scope;
4. DigitalProduct-only derived scope.

The kernel recommended **typed extension of the existing models** with high confidence (composite `14.861`, margin `1.451`), strong structured coverage, and no commandment conflict. The strongest contributors were **Ship Real Functionality** and **Research and Use Standards**.

Decision:

- Retain `digitalProductId` for genuine digital-architecture evidence.
- Add nullable business `productLineId` and `businessProductId` relations to `ResearchProposal` and `MarketingBattlecard`.
- Add nullable `organizationId`, `productLineId`, and `businessProductId` relations to `ScheduledAgentTask`.
- Centralize legal scope construction, labels, organization consistency, and mutually exclusive narrower-scope validation in one product-intelligence module.
- Allow all narrower identifiers to be null: this is the honest organization-wide case.
- Never infer a business Product from a DigitalProduct or parse scope from metadata, prompt text, or route text.

The governed evidence activity is `cms56r2xv02av01qw0yxjzwa4`.

## Architecture review

**Alignment summary:** aligned with guardrails after the WWMD decision.

- Existing authority: ResearchProposal owns propose/approve/execute state, WikiPage/WikiPageSource owns reviewed narrative and citations, MarketingBattlecard owns competitive positioning, ScheduledAgentTask owns cadence, and ProductOperatingContext owns the bounded read projection.
- Business/digital boundary: business `ProductLine`/`Product` scope is explicit and independent of `DigitalProduct`. A record may carry at most one narrower target.
- Organization isolation: composite foreign keys reference `[id, organizationId]`; input validation resolves the target inside the authenticated organization before writing.
- Provider/consumer boundary: Phase 7 describes what the provider sells and learns. It neither creates nor infers consumers, subscribers, teams, entitlements, or business units.
- Traceability: source URL, retrieved-at timestamp, target scope, confidence, proposal ID, and prior-reviewed comparison reference travel with the draft evidence.
- No Phase 10 leakage: comparative rollup and WWWD recommendation generation remain out of scope.

## UX fit review

- **Decision:** `fits-with-guardrails`.
- **Owning area:** Products.
- **Route family:** `/portfolio/product/[id]/direction/intelligence`; no global destination.
- **Primary personas:** owner-operator first, professional product manager through progressive detail.
- **Navigation:** existing Direction section navigation and contextual actions only.
- **Reuse:** report-kit presentation, knowledge/provenance views, status/staleness semantics, and preview-before-mutation controls.
- **Source truth:** the scoped ProductOperatingContext intelligence projection plus the canonical proposal, wiki, battlecard, and scheduled-task records.
- **First-run state:** explain that no watch or reviewed evidence exists, offer one previewable “Propose research” action, and do not render a zero-filled dashboard.
- **AI boundary:** viewing and filtering never sends a prompt. Propose is data-only; web/LLM execution requires explicit approval; publishing remains a separate draft-review action.
- **Progressive disclosure:** guided mode shows the next decision, recent reviewed change, and watch status. Professional mode reveals scope, source, confidence, retrieval time, and comparison detail.
- **Failure states:** distinguish no sources, failed run, stale evidence, unavailable provider, unauthorized access, and partial organization-wide evidence.
- **Evidence:** route/component tests plus desktop, narrow, 200% zoom, keyboard, empty, populated, stale, failed, and unauthorized browser exercises in the combined sandbox.

## Delivery plan

### 1. Test-drive the canonical scope contract

Files:

- Add `apps/web/lib/product-management/product-intelligence-scope.ts`
- Add `apps/web/lib/product-management/product-intelligence-scope.test.ts`
- Modify `packages/db/prisma/schema.prisma`
- Add `packages/db/prisma/migrations/20260728220000_add_business_intelligence_scope/migration.sql`
- Modify schema relation/invariant tests where the repository already verifies ProductLine organization isolation.

Red tests:

1. Accept exactly one of organization, ProductLine, business Product, or DigitalProduct scope.
2. Reject conflicting narrower scopes.
3. Reject ProductLine/Product targets from another organization.
4. Preserve all-null narrower scope as organization-wide.
5. Build stable, explicit query filters and user-facing labels without prompt/metadata parsing.

Implementation:

- Add nullable typed relations and indexes to the three existing models.
- Add composite foreign keys for business hierarchy targets.
- Keep fixed lifecycle states in existing TypeScript unions; do not add DB string enums.
- Make validation reusable by proposal, battlecard, schedule, read-model, and tool/action callers.

Verification:

- Scope-unit tests fail before implementation and pass after it.
- Migration guard recognizes the in-file fleet-safety attestation.
- Prisma validation and migration application run in the combined sandbox.

### 2. Refactor proposal, research, and provenance flow

Files:

- Modify `apps/web/lib/wiki/research-proposal.ts`
- Modify `apps/web/lib/wiki/research-schedule.ts`
- Modify `apps/web/lib/wiki/research-execution.ts`
- Modify `apps/web/lib/wiki/market-research.ts`
- Modify the queue event contract and associated tests where scope crosses the enqueue boundary.

Red tests:

1. Proposal dedup includes canonical scope.
2. Approval propagates exact scope once.
3. Research sources record URL and retrieval time.
4. Draft provenance records scope, confidence, and the prior reviewed evidence reference.
5. Changed-since-last-reviewed output reports an honest first run and a bounded delta on later runs.
6. No-source and inference failure results remain non-fabricated and reviewable.

Implementation:

- Introduce an explicit research source/provenance contract.
- Compare against the latest reviewed matching-scope wiki evidence; never compare against an unreviewed draft as authority.
- Preserve the existing approval gate and draft-review boundary.
- Replace organization-sweep defaults with reusable scoped proposal builders while retaining organization-wide scheduling when no narrower target is supplied.

Verification:

- Proposal, schedule, market-research, execution, and queue tests.
- No execution occurs on preview, propose, or decline.

### 3. Converge battlecards and the competitive-analysis skill

Files:

- Modify `apps/web/lib/marketing/battlecards.ts`
- Modify `apps/web/lib/mcp/packs/marketing-pack.ts`
- Modify `skills/storefront/competitive-analysis.skill.md`
- Modify associated tests and prompt/tool registrations only where verified.

Red tests:

1. Battlecard create/list filters by canonical business or digital scope.
2. Conflicting/cross-organization scope fails closed.
3. Matrix rows surface freshness and reviewed source provenance without duplicating research.
4. The skill begins with existing reviewed evidence and asks for missing context only when evidence is absent.

Implementation:

- Reuse the shared scope module.
- Keep battlecards as competitive-positioning artifacts; citations remain linked to reviewed wiki research rather than copied into a parallel source store.
- Route the skill through propose/preview/approval and reviewed evidence instead of user-supplied-only chat.

Verification:

- Battlecard, MCP pack, skill-manifest, and prompt/tool contract tests.

### 4. Extend scheduling without creating a parallel scheduler

Files:

- Modify `apps/web/lib/operate/scheduled-jobs/agent-task-core.ts`
- Modify `apps/web/lib/actions/agent-task-scheduler.ts`
- Modify existing scheduled-task MCP pack/actions/components where reused.
- Add product-intelligence schedule helpers and colocated tests.

Red tests:

1. A product watch stores typed organization/product scope.
2. Listing filters by authorized scope.
3. Pause/rerun remains ownership-checked.
4. A scheduled watch only creates a pending proposal; it never directly invokes web/LLM execution.
5. Generic existing tasks remain unchanged and organization scope is never inferred.

Implementation:

- Extend the canonical scheduler input/view with optional typed scope.
- Add a deterministic product-intelligence execution branch that proposes research at cadence.
- Reuse canonical cron allocation, next-run calculation, pause, TaskRun, and ScheduledJob projection behavior.

Verification:

- Scheduler core, dispatcher, MCP pack, and product-watch tests.

### 5. Extend ProductOperatingContext and build the Intelligence route

Files:

- Modify `apps/web/lib/product-management/product-operating-context.ts`
- Modify `apps/web/lib/product-management/product-operating-context-query.ts`
- Add `apps/web/lib/product-management/product-intelligence-view.ts`
- Replace `apps/web/app/(shell)/portfolio/product/[id]/direction/intelligence/page.tsx`
- Add `apps/web/components/product/intelligence/ProductIntelligence.tsx`
- Add server actions only behind the existing authenticated Product route boundary.
- Add colocated route/component/read-model tests and loading state if needed.

Red tests:

1. Business-product evidence sorts ahead of ProductLine, organization-wide, and DigitalProduct-enabling context while preserving every scope label.
2. Product-line evidence is included for products in that line without being mislabeled product-specific.
3. Scheduled watches now populate the canonical scheduled-playbook slice.
4. The route renders pending decisions, reviewed changes, battlecards, and watch state from the read model.
5. Empty/stale/failed/unauthorized states are honest.
6. Preview/cancel causes no mutation; approve/schedule/pause/rerun uses the governed actions.

Implementation:

- Keep one server-derived view model for guided/professional density.
- Use existing theme tokens, report-kit, status/staleness semantics, shared loading primitives, and semantic disclosure.
- Keep one primary action. Put source and confidence detail behind progressive disclosure.

Verification:

- Read-model, route, component, theme-token, route-manifest, and accessibility contract tests.
- Combined-sandbox browser exercises from the UX review.

### 6. Documentation, stale-signal resolution, and evidence

Files:

- Update the relevant `docs/user-guide/products/` guidance.
- Update product-management architecture documentation and the data-model/AI-coworker explanation.
- Update setup guidance only if the Intelligence page changes setup-visible behavior; otherwise record why setup remains unchanged.
- Update the competitive-analysis skill documentation in place.
- Update this plan with exact evidence.

Actions:

1. Explain organization-wide versus ProductLine/Product versus DigitalProduct evidence in plain language.
2. Explain propose → approve → draft review → publish and watch pause/rerun behavior.
3. Once the refactored skill has executable evidence, resolve or link deferred `BI-SIG-5C38EE2A` through governed backlog tooling.
4. Record source, test, build, migration, and UX evidence against `BI-FB049FCD`.

## Migration safety

The migration is expand-first and fleet-safe:

- Every new column is nullable.
- Existing ResearchProposal and MarketingBattlecard rows remain organization-wide; existing ScheduledAgentTask rows remain unscoped.
- No ProductLine, Product, DigitalProduct, team, consumer, or schedule scope is inferred or backfilled.
- Composite foreign keys ensure a business target belongs to the same organization.
- `ON DELETE RESTRICT` preserves intelligence traceability rather than silently broadening scoped evidence.
- A check constraint enforces at most one narrower target. Existing rows are provably safe because all new columns begin null; include an explicit `@migration-safety: data-safe` attestation.
- No committed migration is edited.
- Rollback is application-level: stop writing/reading the new nullable fields while retaining them for forward compatibility. The forward-only migration is not reversed destructively.

## Refactoring allocation

Approximately 20% of implementation capacity is reserved for:

- one shared scope value/validation/query module instead of repeated `OR` clauses;
- compatibility adapters that preserve organization/DigitalProduct callers;
- extraction of reusable proposal and watch builders from route/server-action code;
- ProductOperatingContext query-boundary cleanup and stable ordering;
- invariant tests for organization isolation, scope exclusivity, approval boundaries, and no prompt parsing;
- removal of stale guided-only competitive-analysis rules and duplicated scope labels.

Refactoring must not broaden into Phase 8 demand activation or Phase 10 advice generation.

## Implementation checkpoint

Source checkpoint: 2026-07-28. Runtime verification remains deliberately
deferred to the combined stack gate below; this section does not claim those
gates passed.

- Added the expand-only
  `20260728220000_add_business_intelligence_scope` migration and Prisma
  relations for explicit ProductLine/Product research, battlecard, and
  ScheduledAgentTask scope.
- Added one canonical scope/query/validation module, a closed scheduled-task
  discriminator, and a structured watch-config contract. Generic scheduled
  tasks remain compatible and unscoped.
- Extended proposal dedup/approval propagation, organization-scoped decisions,
  cited source retrieval timestamps, explicit provider/no-result outcomes,
  reviewed-baseline comparison, and draft provenance.
- Converged the read boundary on reviewed
  `RawSource → WikiPageSource → WikiPage` evidence while retaining
  `KnowledgeArticle` as a legacy DigitalProduct compatibility source.
- Added the product Intelligence route, pure view model, preview-before-write
  proposal/schedule controls, approval/decline actions, pause/resume/rerun
  controls, honest first-run/no-source/provider-failure/stale states, and
  guided/professional evidence density.
- Added `propose_product_research` to the existing marketing tool pack, grant
  registry, coworker service catalog, prompt roster, and refactored
  competitive-analysis skill. The tool writes a proposal only.
- Updated product user guidance, setup guidance, business-catalog architecture,
  and AI-coworker doctrine. No new setup fields or setup-time research were
  added; the setup change is documentation-only.
- Source-only evidence so far: `git diff --check` passed; Node 24 parsed every
  changed `.ts` file with type stripping; esbuild parsed every changed `.tsx`
  file. Vitest, Prisma validation/migration application, production build, and
  browser UX are **unrun**, not passed, because this worktree is classified
  `source-only` and the requested shared-sandbox run is reserved for the
  completed Phase 7–12 stack.

## Combined-stack completion gate

Source-local checks run on this branch where the source-only worktree supports them. Runtime-bound gates are intentionally batched with Phases 8–12 in the governed `local-integration-ci` sandbox:

1. affected unit tests;
2. `pnpm --filter web build`;
3. migration chain application against realistic existing rows;
4. Product Intelligence approval, decline, publish boundary, schedule, pause, rerun, first-run, no-source, stale, failed, unauthorized, desktop/narrow, 200% zoom, and keyboard UX;
5. regression exercises for the four setup/product-mix scenarios from the epic;
6. documentation/reference/theme/route/guard checks.

No PR opens until the integrated stack passes these gates.

## Risks

- **Scope ambiguity:** fail closed; do not infer from DigitalProduct, route, prompt, or metadata.
- **Cross-organization leakage:** composite foreign keys, authenticated resolution, and negative tests.
- **Duplicate autonomous work:** reuse scheduler claim/idempotency and proposal dedup.
- **Repeated reports:** compare only with the last reviewed matching-scope evidence and show a first-run state.
- **Unreviewed AI authority:** approval gates execution; reviewed wiki status gates authoritative comparison and Product Direction prominence.
- **UI overload:** owner-first first viewport, one primary action, progressive disclosure, and no global navigation.
- **Stack migration conflict:** keep this migration additive and after Phase 5’s DigitalProduct scope migration.

## Backlog coverage

Coverage receipt: `cms56tjgr02f401qwuxhcozzu` (`atomic`, recorded against `BI-FB049FCD`).

Deliverable graph:

- `scope-contract`
- `research-provenance` → `scope-contract`
- `competitive-convergence` → `scope-contract`, `research-provenance`
- `scheduled-watch` → `scope-contract`, `research-provenance`
- `intelligence-experience` → all preceding deliverables

The proposal/research refactor, scheduler extension, battlecard convergence, ProductOperatingContext projection, and Intelligence route are one atomic behavior boundary: none is independently useful without the shared scope, approval, evidence, and read-model contract. Splitting them would temporarily create either unrendered scope, UI controls without governed execution, or execution without reviewable product context.
