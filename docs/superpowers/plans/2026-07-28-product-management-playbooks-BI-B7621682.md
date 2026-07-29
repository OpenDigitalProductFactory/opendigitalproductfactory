# Product-management playbooks and adoption evidence — `BI-B7621682`

**Date:** 2026-07-28
**Epic:** `EP-ED496EB0`
**Work Capsule:** `WC-0E2A21B0`
**Branch:** `feat/product-management-playbooks`
**Parent plan:** `docs/superpowers/plans/2026-07-27-product-management-operating-loop.md` Phase 12
**Plan coverage receipt:** `cms5dy37n0b6h01qw38ynkec5` (`atomic`)

## Outcome

Package the existing business-product operating loop as reusable,
organization-, ProductLine-, and Product-scoped coworker playbooks. Both an
owner-operator and a professional product manager can preview the exact
evidence, tools, proposed writes, approval boundary, cadence, and failure
behavior before scheduling; inspect freshness and provenance after a run; and
pause, resume, or rerun the existing scheduled task.

Canonical ProductLine/Product, demand, objective, outcome, intelligence,
commercial, delivery, and decision records remain the authorities. A playbook
may prepare a derived brief, recommendation, or roadmap refresh, but does not
create a second planning authority. Portable snapshots are timestamped,
source-linked, and explicitly non-importable.

This phase does not add a scheduler, playbook/run table, Product team, business
unit, subscriber, entitlement, consumer, or coworker. It does not move business
Product ownership into WWMD or `DigitalProduct`.

## Live and source substrate audit

- Live backlog confirms `BI-B7621682` is `in-progress`, `large`, `skill`,
  `triageOutcome=build`, common scope, and linked to open epic `EP-ED496EB0`.
- The stacked source has an expand-first `ScheduledAgentTask` model with
  optional organization, ProductLine, Product, typed `taskKind`, and JSON
  `taskConfig`; `TaskRun`, the agent scheduler, proactivity/approval checks, and
  schedule/pause/resume/rerun operations already own execution and audit.
- The current live install still exposes the older 19-column
  `ScheduledAgentTask` shape without product scope, `taskKind`, or `taskConfig`.
  Phase 12 must therefore depend on the existing additive migration and add no
  tightening migration.
- `ProductOperatingContext` already projects scheduled playbooks and preserves
  source IDs, `asOf`, freshness, and partial/unavailable reasons.
- Product and ProductLine Direction routes already own the role-adaptive
  operating UX. The generic calendar scheduler is an operations surface, not
  the primary product workflow.
- Seeded `SkillDefinition` supports open string categories. The source and live
  install have a `portfolio` category but no business `product-management`
  category. A new category is classification within the existing skill
  authority, not a new skill substrate.
- Existing specialist prompts describe roadmap assembly, demand
  prioritization, and investment analysis, but are digital-product
  value-stream roles with partly aspirational grants. They are evidence to
  compose from, not authorities to repurpose for business Product management.
- Existing active Portfolio Analyst/COO coworkers are sufficient. The phase
  assigns recipes to an existing coworker and does not fabricate a product
  team or new agent.
- Existing roadmap snapshots, decision interactions, backlog activities,
  objective reviews, `TaskRun`, and skill-usage evidence can support adoption
  projections. Metrics that lack canonical evidence must report unavailable,
  never manufacture movement or acceptance.

## Governed architecture decision

WWMD interaction `DI-8C52F77BECD4` compared:

1. a typed extension of existing skills, prompts, `ScheduledAgentTask`,
   `TaskRun`, Product Operating Context, and Product Direction;
2. untyped prompt-only tasks in the generic scheduler; and
3. new ProductPlaybook/Schedule/Run tables and engine.

WWMD selected option 1 with high confidence (composite `5.179`, margin `4.247`,
strong structured coverage, no commandment conflict). Phase 12 will add one
closed `product-management-playbook` task kind and a versioned JSON config,
extract its execution/preflight behavior from the central scheduler, and add
no database model or migration.

## Architecture review

- The recipe catalog is pure metadata and the single source for labels,
  supported scopes, canonical inputs, allowed tools, derived output type,
  proposed writes, approvals, cadence guidance, failure behavior, and
  regeneration sources.
- `ScheduledAgentTask` remains scheduling authority; `TaskRun` remains run
  authority; existing decision/activity records remain correction and approval
  evidence.
- A typed config stores only recipe identity, schema version, permissions
  digest, refresh rate limit, and last successful input fingerprint. It does
  not persist derived Product state.
- Canonical-change refresh updates the existing task's next run only when the
  changed source is relevant, the scope matches, the fingerprint is stale, and
  the rate limit permits it. Partial or failed runs do not advance the last
  successful fingerprint.
- Organization is the provider at simple-business scale. ProductLine and
  Product scope narrow evidence; they do not invent organizational providers
  or consumers.
- `DigitalProduct` contributes architecture/delivery evidence only through the
  existing business Product association. WWMD remains the platform decision
  kernel, not a product-management record store.
- Product-management skills use a new category under the existing seed/parser
  authority and compose existing tools. No parallel prompt or skill loader is
  introduced.

## UX-fit review

- Governed cognitive-load decision `DI-4474CE5B14AC` selected contextual,
  progressive disclosure with preview and explicit confirmation (composite
  `9.287`, margin `2.655`, strong structured coverage, no commandment
  conflict) over an always-expanded enterprise form or redirecting owners to
  the generic scheduler.
- Product Direction is the primary surface. Scheduling is contextual to the
  organization, ProductLine, or Product already being viewed.
- The first viewport shows recommended work, why it matters, and freshness.
  Recipe internals, source lists, tool grants, writes, approval policy, and
  failure behavior are progressively disclosed.
- Owner-operator language uses tasks such as “review what changed” and
  “prepare next decisions”; professional-PM detail is available without
  changing the canonical model.
- Scheduling is two-step: preview the first run and permissions digest, then
  confirm. A changed digest requires another preview.
- Status is textual as well as visual. Partial, stale, paused, failed,
  unchanged, and unavailable states cannot masquerade as current success.
- Pause, resume, rerun, inspect provenance, and export are keyboard-accessible
  native controls. No drag-and-drop, hidden hover-only action, or color-only
  state is introduced.
- No global schedule is seeded. Every recurring cadence is explicit opt-in;
  the catalog may recommend a cadence but cannot activate it.
- Status display composes report-kit `StatusBadge`; controls use semantic
  HTML, 44px minimum targets, theme tokens, textual failure/recovery states,
  and an audited **Inspect last run** link.

## Implementation checkpoint

- Commercial Product Sold changes are collected inside the owning transaction
  and refresh playbooks only after commit.
- The operating-context query is split into public query, support, and
  projection modules while preserving one public boundary.
- Demand-scoring administration and backlog definitions are extracted from
  oversized MCP packs; quote acceptance and Product Sold commercial
  persistence are separated from broad action/core modules.
- DemandBoard typography now uses the generated scale and its repeated button
  primitive is extracted.
- Product-management tool grants and focused tests have canonical domain
  modules.
- The changed-file and cross-phase source matrix passes with 38 test files and
  391 tests. The focused operating-context extraction rerun passes 11 tests.
- Strict TypeScript passes with zero diagnostics using the repository compiler
  and an 8 GiB Node heap; the default 4 GiB process exhausted its heap before
  reporting a product diagnostic.
- Git diff, module-size, style-drift, MCP tool-pack, reporting-composition, and
  documentation-reference guards pass without baseline growth. The
  operating-context query was brought below the 800-line ceiling by moving
  enabling-digital-product collection into its existing support boundary.
- Production build, stacked migration application, and browser UX remain
  pending the single combined governed sandbox lease.

## Delivery plan

### 1. Lock the playbook contracts with failing tests

Create pure contracts under `apps/web/lib/product-management/` for:

- weekly product intelligence;
- ProductLine performance review;
- demand triage;
- investment preparation;
- roadmap refresh;
- commercial-opportunity review;
- outcome review; and
- stakeholder/owner brief.

Tests require unique IDs, explicit supported scope, inputs, tools, derived
output, proposed writes, approvals, cadence, failure behavior, relevant
canonical-change sources, role-adaptive guidance, deterministic permission
digests, fail-closed config parsing, snapshot provenance, and
`importable=false`.

### 2. Extend the existing scheduled-task boundary

- Add `product-management-playbook` to the closed task-kind registry.
- Validate versioned config and explicit organization scope in
  `scheduleAgentTaskFor`.
- Extend the MCP tool pack with product scope, task kind/config, pause/resume,
  rerun, and scoped list operations through the same core.
- Extract playbook preflight, fingerprint, unchanged-skip, success-finalization,
  and canonical-change refresh behavior into focused modules rather than grow
  `agent-task-scheduler.ts`.
- Persist the input fingerprint only after a fully successful run. Keep stale
  inputs eligible after partial or failed execution.
- Add ownership, scope, deduplication, rate-limit, backward-compatibility, and
  audit tests.

### 3. Package skills and prompt composition

- Create the verified `skills/product-management/` category using the existing
  skill frontmatter/parser and assign to an existing coworker.
- Provide one skill per reusable workflow, composing shared operating-context,
  evidence, decision, and canonical-action tools.
- Add a product-management prompt template that consumes the declarative
  recipe and operating context, cites evidence, proposes governed writes, and
  reports unavailable evidence honestly.
- Add seed-parity and contract tests. Do not copy specialist role prompts or
  promise aspirational tools.

### 4. Add Product Direction controls and portable briefs

- Add a responsive playbook catalog/status component to Product and
  ProductLine Direction.
- Preview exact scope, evidence sources, tools, writes, approvals, cadence, and
  failure behavior before schedule confirmation.
- Reuse existing pause/resume/rerun actions and expose the last run, freshness,
  partial/error reason, and provenance.
- Export a stakeholder/owner brief from the same operating context and
  provenance contract as the live view. Exports remain derived and
  non-importable.
- Cover simple, mixed-line, sparse, partial, failed, paused, changed-permission,
  and professional-detail states with component and route tests.

### 5. Instrument adoption without fabricating evidence

Create a pure adoption projection over canonical evidence:

- playbook freshness from scheduled task and successful run timestamps;
- decision latency only where a demand activity supplies both proposal and
  governed-decision timestamps;
- outcome-review cadence from `ProductObjective` review evidence;
- recommendation acceptance/correction only where a decision/activity link
  exists; and
- ProductLine movement only where comparable canonical rollups exist.

Each measure carries source IDs, `asOf`, completeness, and an unavailable
reason. No inferred success metric is written back as authority.

### 6. Reserve approximately 20% for convergence and refactoring

Allocate at least one work unit in five to:

- split the oversized `product-operating-context-query.ts` into scope/query
  adapters while preserving one public query boundary;
- split the oversized demand-scoring MCP pack into definition/handler modules;
- extract playbook execution from the already-large scheduler;
- centralize recipe, permission, fingerprint, provenance, and freshness rules
  so UI, MCP, skills, and execution do not duplicate them;
- remove stacked DemandBoard style drift and keep responsive styles in the
  owning stylesheet;
- add compatibility/invariant tests for old generic tasks, additive migration
  order, no new planning authority, no importable snapshots, and no fabricated
  provider/consumer/team records; and
- run module-size and composition guards without adding or growing a baseline.

## Migration safety

No Phase 12 schema migration is planned. The typed playbook state fits the
existing nullable JSON `taskConfig` added by the earlier expand migration.
Older generic task rows remain valid because `taskKind` is nullable and config
parsing occurs only for the new discriminator. No column becomes non-null, no
constraint is tightened, and no backfill is required.

The combined migration gate must apply the full stacked expand-first chain to a
non-empty database that begins with the older live 19-column task shape. It
must verify that pre-existing generic tasks survive with null scope/kind/config
and that the new kind can be created afterward.

## Documentation and governed evidence

Update:

- Product Management user guidance;
- setup guidance for optional recurring PM work;
- architecture/contributor documentation for the recipe/scheduler boundary;
- AI-coworker guidance for preview, approval, evidence, partial results, and
  corrections; and
- parent implementation history where Phase 12 behavior is recorded.

Record the WWMD interaction, plan coverage receipt, source contracts, tests,
documentation, exported snapshot, UX evidence, migration result, production
build, and final PR/CI evidence against `BI-B7621682` and `WC-0E2A21B0`.

## Verification

Source-local before push:

- pure playbook/config/fingerprint/adoption tests;
- schedule-core, MCP-pack, scheduler, operating-context, route, seed-parity,
  and component tests where dependencies are available;
- strict TypeScript/source-contract checks;
- module-size, style, migration-safety, composition, documentation-reference,
  and secret guards.

One combined leased `local-integration-ci` pass after Phase 12:

- sandbox freshness convergence and resolved dependency evidence;
- Phase 8–12 targeted and affected-package unit tests;
- production web build;
- full stacked migration apply against non-empty pre-expand data;
- setup and Product Direction UX for a simple one-line business, salon
  services plus retail goods, hotel rooms plus events, and restaurant dining
  plus private events;
- owner-operator and professional-PM disclosure;
- schedule/preview/confirm/pause/resume/rerun/partial/unchanged/failure flows;
- canonical-change deduplication/rate limiting;
- provenance and non-importable export inspection; and
- adoption metrics with both available and explicitly unavailable evidence.

Runtime gates remain unproven until that single combined lease executes.
