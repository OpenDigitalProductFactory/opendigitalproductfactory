# Product Objective and Outcome Learning — BI-162FBDCC

**Date:** 2026-07-28
**Epic:** `EP-ED496EB0`
**Umbrella BI:** `BI-5C5FA641`
**Backlog item:** `BI-162FBDCC`
**Branch:** `feat/product-objective-outcome-learning`
**Parent branch:** `feat/evidence-backed-demand-activation`
**Work capsule:** `WC-A889CBAF`

## Goal

Add the minimum canonical objective and outcome-learning contract for an
organization-owned business `Product`. Connect the problem and outcome
hypothesis to an owner, a compatible measure, review dates, contributing
backlog work, and append-only observations. Surface the contract in the
existing product Direction area without turning DPF into a general OKR suite
or moving commercial product ownership into `DigitalProduct`.

## Live and source audit

- Live DPF backlog state was retrieved before planning. `BI-162FBDCC` is the
  Phase 9 child of `EP-ED496EB0`, is triaged `build`, and was claimed
  `in-progress` through governed MCP. External execution is tracked by
  `WC-A889CBAF`.
- Live data currently contains 321 `DigitalProduct` rows and 26 `Principal`
  rows. It contains no business `Product`/`ProductLine` rows because the
  preceding stacked Phase 1 migration is not yet on live `main`; this branch
  therefore must be verified as the Phase 1–9 stack, not against an invented
  runtime product.
- The stacked Prisma schema already owns the commercial hierarchy through
  `ProductLine` and `Product`, separately from `DigitalProduct`.
- No canonical product-objective table or compatible outcome-observation table
  exists. `RouteOutcome`, `DeliberationOutcome`, and discovery observations
  serve unrelated authorities and are not reusable as product outcomes.
- `ProductOperatingContext` already owns the cross-source read boundary and
  currently publishes objectives as explicitly unavailable.
- `/portfolio/product/[id]/direction/outcomes` already exists as a Phase 9
  placeholder under `BusinessProductTabNav`.
- MCP mutations are composed through domain-owned tool packs. Phase 9 will add
  one product-outcomes pack rather than placing new tools in the
  `mcp-tools.ts` compatibility module.
- No open pull request overlaps this product-objective scope as of planning.

## Governed decisions

### Objective ownership

WWMD DecisionInteraction `DI-1FCEE688F5D7` recommended
`business-product-only` with high confidence, a `2.214` composite margin,
strong structured coverage, and no commandment conflict.

Decision:

- every `ProductObjective` belongs to one real business `Product` in one
  organization;
- product-line summaries derive through the canonical Product → ProductLine
  relation;
- Phase 9 does not add organization-wide or product-line objective targets;
- `DigitalProduct` remains an optional delivery/architecture context reached
  through existing explicit operational links, never the objective owner.

### Measure contract

WWMD DecisionInteraction `DI-9547279FA032` recommended
`typed-measure-family` with high confidence, a `1.815` composite margin,
strong structured coverage, and no commandment conflict.

Decision:

- canonical measure kinds are `number`, `percentage`, `currency`, `duration`,
  and `qualitative`;
- quantitative measures use numeric baseline, target, and observation values;
- qualitative measures use narrative baseline/target expectations and
  narrative observations;
- optional unit or currency metadata preserves archetype-specific meaning;
- posture is calculated only when objective and observation values are
  compatible. Missing or incompatible evidence remains explicit.

## Architecture review

**Verdict: fit, with boundary controls.**

- Authority: `ProductObjective` is business product-management state owned by
  Goods and Services for Sale. It is not an EEMD or storefront authority.
- Identity: optional owners and recorders reference canonical `Principal`;
  free-form owner identity is prohibited.
- Organization boundary: the objective carries `organizationId` and uses the
  existing composite `Product(id, organizationId)` key. All reads and writes
  authorize the product inside the current organization.
- Work linkage: `ProductObjectiveWork` links canonical `BacklogItem` rows
  without changing their ownership or copying demand/delivery state.
- History: observations are insert-only. A correction creates a new row with
  `supersedesObservationId`; neither UI nor tools expose update/delete.
- Reporting: `ProductOperatingContext` remains the canonical projection
  boundary. Product-line posture is a later derived Phase 10 view, not a second
  outcome ledger.
- Migration: three new tables and inverse relations are additive. No legacy row
  is guessed into a product, objective, owner, baseline, or observation.
- Compatibility: enum strings live in one TypeScript module and are imported by
  both services and MCP schemas. The Prisma columns remain strings to support
  fleet-safe evolution without database enum replacement.

## UX-fit review

**Verdict: fit after replacing the existing placeholder in place.**

- Location: keep Outcomes in the existing product Direction tabs; add no
  global navigation or second PM cockpit.
- First viewport: show reviews due/overdue and changed posture first, then
  active objectives. Counts and charts remain secondary.
- Progressive disclosure: an empty product gets one plain-language “Define
  what should improve” action, not an OKR taxonomy or enterprise hierarchy.
- Form language: ask for the problem, hoped-for change, how it will be noticed,
  starting point, target, and review date. “Objective,” measure details, work
  links, and provenance can be disclosed as the operator proceeds.
- Evidence honesty: missing baseline, no observation, incompatible values, and
  insufficient evidence are named directly. Zero is never substituted for
  missing evidence.
- Corrections: the interface labels correction as a new observation that
  supersedes the selected record and preserves history.
- Accessibility and shell fit: reuse report-kit, shell form primitives,
  tokenized colors, semantic headings, labelled inputs, keyboard-operable
  controls, server actions, and `FormStatus`.

## Backlog coverage

Coverage receipt: `cms5aikvp070d01qwhahhj452` (`atomic`).

The BI is atomic. The schema, services/tools, projection, and Outcomes page
together form the minimum usable learning loop; none is independently useful
or safe to ship without the others.

## Implementation sequence

### 1. Contract tests first

- Add tests for canonical status, measure, source, and contribution values and
  exact MCP enum mirroring.
- Add pure posture tests for quantitative improvement/degradation, direction,
  qualitative evidence, missing baselines, incompatible units, changed
  posture, and overdue review dates.
- Add service/repository tests for unauthorized products, legal lifecycle
  transitions, backlog scope compatibility, append-only observations, and
  superseding corrections.
- Add projection and component/page tests before replacing the placeholder.

### 2. Additive schema and migration

Add:

- `ProductObjective`
- `ProductObjectiveWork`
- `ProductOutcomeObservation`

Use semantic public identifiers in addition to Prisma row identifiers. Add
composite organization/product foreign keys, optional `Principal` ownership
and recorder relations, unique objective/work links, and a single-successor
supersession relation. The SQL migration creates only new tables, indexes, and
foreign keys.

Migration safety:

- no existing table receives a required column;
- no data backfill or heuristic association is performed;
- no existing row is deleted or rewritten;
- all new constraints apply only to empty new tables;
- in-file migration-safety attestations explain why the constraints cannot be
  violated by pre-existing data;
- the combined sandbox gate applies the complete stacked migration chain to
  representative existing data and checks append-only correction behavior.

### 3. Canonical service and query boundary

- Put constants, validation, posture calculation, review-due derivation, and
  view types in `apps/web/lib/product-management/outcomes.ts`.
- Put Prisma reads/writes behind a focused outcomes repository/service.
- Resolve organization scope through the authenticated organization and the
  existing composite Product relation.
- Create/update/review/close/archive objectives through legal transitions.
- Link compatible contributing backlog rows without changing backlog state.
- Append observations and append superseding corrections transactionally.
- Project objective and observation posture into `ProductOperatingContext`.

### 4. Governed MCP tools

Create a `product-outcomes` tool pack with exact imported enum values for:

- create/update/review/close/archive objective;
- link contributing backlog work;
- record an observation;
- correct an observation by supersession.

Reuse the current authorization and tool-pack registry. Do not add a parallel
API authority.

### 5. Outcomes UX

- Replace the route placeholder with a server-loaded `ProductOutcomes` view.
- Add focused server-action forms for the first objective, review, observation,
  correction, and lifecycle actions.
- Lead with due reviews and changed posture.
- Show contribution links and observation provenance.
- Explain insufficient evidence and incompatible measures without fabricated
  status.
- Feed the same objective posture into the Direction brief.

### 6. Documentation and evidence

Update:

- operator guidance for product outcomes;
- architecture documentation for business Product objective ownership,
  append-only learning, and the `ProductOperatingContext` query boundary;
- setup/progressive-disclosure guidance where the first objective is described;
- AI-coworker guidance for governed outcome tools and evidence honesty;
- the parent implementation history.

Record the WWMD decisions, source verification, migration/test/build/UX
results, and unresolved issues against `BI-162FBDCC` and `WC-A889CBAF`.

## Refactoring allocation

Approximately 20% of Phase 9 capacity is reserved for:

- replacing the `NamedStatusContextItem` objective placeholder with a typed
  objective projection;
- centralizing enum validation and compatible-measure/posture rules;
- keeping Prisma operations behind one canonical outcomes repository;
- adding the domain MCP tool pack rather than expanding the compatibility
  mega-module;
- extracting shared objective form/view helpers instead of duplicating rules
  between tools, actions, and components;
- invariant tests for organization boundaries, append-only corrections, enum
  mirroring, and missing-evidence behavior.

## Verification

Source-local checkpoint:

- TypeScript syntax checks for every changed/new source file;
- enum/schema and focused source tests when dependencies are available;
- migration safety guard;
- staged secret scan and diff whitespace checks.

One combined leased-sandbox gate after Phases 9–12:

- sandbox freshness convergence with branch/SHA and resolved dependency
  evidence;
- targeted unit and integration tests for all affected phases;
- `pnpm --filter web build`;
- complete stacked migration application against representative existing data;
- setup and objective/outcome UX across the four required business scenarios;
- authorization, qualitative measures, overdue reviews, missing baselines,
  contribution links, and append-only correction verification.

This source-only worktree has no `node_modules`; an unrun local test or build is
not reported as passing or failing. Runtime evidence comes from the governed
combined sandbox lease.

## Source checkpoint — 2026-07-28

Implemented the additive objective, contributing-work, and append-only
observation substrate; the canonical service/query boundary; governed MCP
tools; the in-place Outcomes experience; Direction review signals; and the
affected operator, setup, architecture, and AI-coworker documentation.

Source-local evidence:

- all 21 changed or new TypeScript/TSX files passed TypeScript parser and
  transpilation syntax diagnostics;
- `git diff --check` passed;
- the migration safety guard reported no unattested tightening migration;
- the data-impact manifest passed the canonical `validateManifest` contract;
- repository boundary tests now cover organization-scoped Product ownership,
  canonical review cadence, same-product work links, legal lifecycle,
  finite/ranged observations, and single-successor append-only corrections;
- Prisma validation, targeted Vitest, production build, migration application,
  and browser UX remain deliberately unrun in this `source-only` worktree and
  are assigned to the one combined leased-sandbox gate after Phase 12.

## Explicit exclusions

- Phase 10 product-line performance rollups and proactive advice;
- Phase 11 roadmap derivation;
- Phase 12 coworker recipes and operating-loop packaging;
- organization-wide or direct product-line objectives;
- a general strategy-document or OKR suite;
- inferred owners, teams, consumers, baseline values, targets, observations,
  or backlog links;
- changes to commercial Product, ProductLine, Product Offering, Product Sold,
  or `DigitalProduct` ownership.
