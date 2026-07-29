# Derived Product Roadmaps — `BI-8C87657A`

**Date:** 2026-07-28
**Epic:** `EP-ED496EB0`
**Work Capsule:** `WC-2879A84A`
**Branch:** `feat/derived-product-roadmaps`
**Parent plan:** `docs/superpowers/plans/2026-07-27-product-management-operating-loop.md` Phase 11
**Plan coverage receipt:** `cms5cpwwj09qf01qwkcz5opsf` (`atomic`)

## Outcome

Give an owner-operator or product manager one current, explainable roadmap
projection for a business Product. The default view is Now / Next / Later;
timeline, outcome, and dependency views are alternate readings of the same
projection. Canonical demand, objective, architecture, and delivery records
remain the only editing authorities.

This phase does not add a `Roadmap` or `RoadmapItem` model, does not attach a
business objective to `DigitalProduct`, and does not infer dates, consumers,
teams, organizational units, funding, or objective relationships.

## Verified substrate

- `BacklogItem` owns demand stage, score, investment bucket, evidence,
  funding-decision activity, business Product scope, and active build.
- `ProductObjective` and its contribution relation own outcome intent and the
  explicit link from funded work to an objective.
- `ProductDependency`, `ChangeRequest` / `ChangeItem`, `ProductVersion`, and EA
  elements remain digital-product architecture and delivery evidence. They may
  constrain or qualify a business Product roadmap only through an existing
  commercial Product-to-DigitalProduct association.
- Decision interactions and backlog activities already provide review/audit
  evidence. A roadmap-specific approval ledger would duplicate authority.
- The existing `/portfolio/product/[id]/direction/roadmap` route is a Phase 11
  placeholder under the role-adaptive Product Direction workspace.
- The live database currently contains 3,846 backlog rows and no classified
  `demandStage` values. The Phase 9 objective tables are not deployed on the
  live install yet. Legacy rows must therefore remain visibly unclassified,
  never silently promoted into roadmap lanes.
- The full operating-context query fetches 100 demand rows, but its partial
  reason currently says 250. This is a duplicated-boundary defect to correct.

## Governed architecture decision

WWMD interaction `DI-ACEF99F8057F` compared:

1. a pure, fail-closed projection over canonical sources;
2. persisted `Roadmap` / `RoadmapItem` planning authority; and
3. an editable Knowledge snapshot synchronized with source records.

WWMD selected option 1 with high confidence (composite `9.505`, margin
`6.706`, no commandment conflict). Every view and export will therefore be
created from one immutable projection. Incomplete evidence is represented by a
readiness queue or explicit unavailable state.

## UX-fit decision

- Use semantic headings, lists, links, and buttons; no drag-and-drop board.
- Default to three scannable columns on wide screens and one ordered flow on
  narrow screens.
- State lane, confidence, blockers, and evidence in text; color is secondary.
- Owner-operators initially see the current bets and the next evidence action.
  Dense provenance, alternate views, and architecture detail are progressively
  disclosed.
- Timeline entries appear only where a canonical date exists. Undated work
  remains in sequence views and is never placed on a fabricated calendar.
- Empty, sparse, blocked, partial, and unclassified states explain why data is
  absent and link to the canonical control that can resolve it.
- Filters are URL query parameters in this phase. No new preference authority
  is justified for a single roadmap view.

## Delivery plan

### 1. Define the projection with failing tests

Create:

- `apps/web/lib/product-management/product-roadmap.ts`
- `apps/web/lib/product-management/product-roadmap.test.ts`

Test and implement:

- committed eligibility requires an approved/funded (`ready`) demand item and
  an explicit contribution to an active objective;
- in-progress delivery maps to Now; funded, unblocked work maps to Next; lower
  confidence or dependency-constrained work maps to Later;
- missing classification, funding, objective linkage, evidence, or dates is
  explicit and never synthesized;
- contradictory, partially funded, missing, and cyclic dependency inputs fail
  closed with human-readable reasons;
- ordering is deterministic and changes are explained from canonical evidence;
- timeline, outcome, and dependency views share item identifiers with the
  default projection;
- portable snapshots include schema version, filters, source IDs, `asOf`, and
  confidence and are explicitly non-importable.

### 2. Extend the canonical query boundary

Extend the existing operating-context contract rather than create a parallel
roadmap query:

- retain work type, investment bucket, effort, active-build delivery state,
  funding-decision evidence, and the last evidence change on demand items;
- retain planned change dates and shipped-version evidence only when linked
  through an existing enabling DigitalProduct;
- retain dependency endpoint identifiers so cycles and blockers can be
  detected rather than inferred from display names;
- correct the demand query limit/partial-reason mismatch;
- preserve explicit partial/unavailable reasons at every source boundary.

No schema migration is planned. If implementation reveals a missing canonical
association, Phase 11 will expose the limitation rather than add a speculative
foreign key.

### 3. Replace the placeholder with one responsive projection

Create:

- `apps/web/components/product/direction/ProductRoadmap.tsx`
- focused component tests

Update:

- `apps/web/app/(shell)/portfolio/product/[id]/direction/roadmap/page.tsx`

Provide:

- Now / Next / Later default;
- timeline, outcome, and dependency views over the same projection;
- URL-preserved view/audience filters;
- canonical action links for demand classification/funding, objective linkage,
  architecture/dependency, and delivery evidence;
- a timestamped JSON snapshot download;
- a stakeholder-review coworker action routed through the existing
  organization decision/audit tool.

### 4. Reserve approximately 20% for convergence and refactoring

- Extract the Product route coworker context from the oversized central route
  registry and add a roadmap-specific review action there.
- Extract typed roadmap source adapters from the oversized operating-context
  query instead of growing another monolith.
- Centralize roadmap confidence, lane, and source-link rules in the pure
  projection; UI and export code may not duplicate them.
- Add invariant tests preventing a persisted roadmap authority, importable
  snapshots, invented dates, or business-objective ownership by
  `DigitalProduct`.
- Remove the Phase 11 placeholder and any superseded roadmap-specific mapping.

### 5. Documentation and governed evidence

Update the Product Management user guide, architecture explanation, setup/AI
coworker guidance, route map, and parent implementation history where Phase 11
changes behavior. Record source, test, export, review, and UX evidence against
`BI-8C87657A`.

## Verification

Source-local before push:

- focused roadmap projection and component tests;
- affected operating-context and route-context tests;
- TypeScript/source contract checks;
- module-size, migration-safety, composition, and secret guards.

One combined leased `local-integration-ci` pass after Phase 12:

- Phase 9–12 targeted and affected-package unit tests;
- production web build;
- all stacked migrations against a non-empty database;
- dense, sparse, blocked, undated, and unclassified roadmap UX;
- owner-operator and professional-PM disclosure;
- alternate-view identity consistency;
- stakeholder review audit and exported snapshot inspection;
- regression of the simple, salon mixed goods/services, hotel
  rooms/events, and restaurant dining/private-events scenarios.

Runtime gates remain unproven until that combined lease executes.

## Implementation review checkpoint

### Architecture review

**Source review verdict:** pass, with runtime verification pending.

- The implementation adds no schema or migration and introduces no roadmap
  write authority.
- `ProductOperatingContext` remains the canonical query boundary. One extracted
  adapter feeds the pure projection, all views, and the export.
- Active builds and their shipped versions retain their real backlog relation.
  Change windows and `DigitalProduct` dependencies remain unallocated
  coordination evidence because the schema does not link them to one business
  demand item.
- Product and ProductLine use the same projection. Scope changes disclosure and
  rollup, not the model or reporting boundary.
- The provider remains the organization. The roadmap does not create or infer
  consumers, teams, business units, subscribers, or entitlements.
- The Product route coworker context moved out of the central route registry,
  shrinking that duplicated authority and adding the existing WWWD tool for
  stakeholder review.
- The existing oversized operating-context query and inherited demand/tool
  modules remain a combined-stack refactoring gate. They must be split before
  the PR stack is opened; the module-size guard is intentionally not waived or
  re-baselined.

### UX-fit review

**Source review verdict:** pass, with browser verification pending.

- Now / Next / Later uses semantic sections and lists, becomes a single reading
  order on narrow screens, and does not use drag-and-drop.
- Confidence and blockers are always expressed in text, not color alone.
- Simple/worker navigation defaults to the owner-operator audience and hides
  dense source posture. Full navigation defaults to the product-manager
  audience; stakeholder disclosure remains an explicit choice.
- Missing, partial, blocked, unclassified, and undated states name the absent
  evidence and link to the canonical control.
- Timeline dates render only from a shipped version, active-build delivery
  evidence, or a real planned change window. Unallocated change dates are
  labelled rather than attached to a bet.
- Alternate-view and audience filters are URL-addressable. No premature
  preference record was added.
- The review action uses the shared coworker affordance with a confirmation
  summary. Snapshot export names its provenance boundary and is non-importable.

### Source verification recorded so far

- Pure projection TypeScript strict compile: pass.
- Changed-file TS/TSX syntax scan: pass (`16` files, zero syntax failures).
- Direct pure-contract execution: pass for funded/objective eligibility,
  Now/Next sequence, cyclic dependencies, unclassified fail-closed behavior,
  provenance, and non-importable export.
- Reporting composition guard: pass.
- Documentation reference integrity guard: pass.
- MCP tool-pack guard: pass.
- Migration requirement: not applicable; no schema or migration changed.
- Module-size guard: pending combined refactor. It still reports inherited
  stacked modules plus `product-operating-context-query.ts`; the extracted
  Product route context shrank the central route registry.
- Vitest, production build, browser UX, and migration-chain application:
  deferred to the single governed Phase 9–12 sandbox lease.
