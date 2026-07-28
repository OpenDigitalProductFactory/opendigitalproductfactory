# Product Direction workspace implementation plan

**Backlog item:** `BI-C2C08E30`

**Epic:** `EP-ED496EB0`

**Parent design:** `docs/superpowers/specs/2026-07-27-product-management-operating-loop-design.md`

**Parent plan:** `docs/superpowers/plans/2026-07-27-product-management-operating-loop.md`

**Branch:** `feat/product-direction-workspace`, stacked on Phase 5 commit
`70c1c97c8a20dd08cc9779a90d1727b29e280983`

## Outcome

Extend the existing Products route family with one evidence-backed Direction
experience for business `Product` and `ProductLine` scopes. A professional
product manager gets compact comparative evidence and drill-down; an
owner-operator gets guided language and fewer default-visible details. Both
presentations use the same `ProductOperatingContext` and canonical business
product hierarchy.

This branch does not implement continuous-intelligence execution, demand
scoring, objectives, outcome observations, roadmap derivation, business-level
WWWD advice, or reusable playbooks. Those remain Phases 7-12.

## Live-state and substrate audit

- The live backlog item is `in-progress`, effort `large`, and has no active
  Build Studio build. Work is tracked by external capsule `WC-A546C6E1`.
- The live install currently contains one `Organization`, 321
  `DigitalProduct` rows, and no `ProductLine` or business `Product` rows. The
  fresh-install empty state is therefore a first-class acceptance case.
- `/portfolio` is an optional catch-all backed by the digital-product taxonomy
  and `PlatformGridSection(entityType="digital_product")`.
- `/portfolio/product/[id]`, `ProductHeader`, and `ProductTabNav` currently
  resolve only `DigitalProduct`. Existing deep links must not change.
- Phase 5 provides the bounded, organization-scoped
  `ProductOperatingContext`; it distinguishes business products, enabling
  digital products, commercial/consumption evidence, intelligence, demand,
  decisions, objectives, roadmap inputs, delivery, architecture, and
  schedules. Missing future contracts are represented as unavailable rather
  than fabricated.
- The existing `SectionNav`, report-kit, evidence freshness adapters, shell
  navigation mode, and product route family are fit substrate. No new global
  destination, dashboard authority, role table, or parallel query layer is
  justified.

## Governed architecture decision

WWMD interaction `DI-F482DD9577DC` recommends
`kind-aware-compatible-route` with high confidence (composite `8.585`, margin
`0.326`). Signal quality is usable/strong and there is no commandment conflict.

Implementation consequences:

1. Keep `/portfolio/product/[id]` stable.
2. Resolve business `Product` and `DigitalProduct` independently within the
   authorized organization boundary.
3. Fail closed if neither or both authorities match the identifier.
4. Render separate headers and section-navigation models. Direction is exposed
   only for business `Product`; existing digital-product behavior is unchanged.
5. Never infer a business product from a digital product or from an offering.
6. Use `/portfolio/product-line/[id]/direction` for an explicit product-line
   drill-in linked from the existing `/portfolio` Products home. This is local
   object navigation, not a new global area.

## Architecture review

**Decision:** aligned with guardrails after the route authority is made
explicit.

- `Product` and `ProductLine` remain owned by Goods and Services for Sale.
  `DigitalProduct` remains an enabling architecture/technology record.
- `ProductOperatingContext` remains the one read boundary. Route components do
  not reconstruct joins.
- The organization remains the provider. Consumer labels appear only from
  `ProductSoldParty` or transaction evidence already admitted by the
  projection.
- Product-line comparison uses additive Product Sold sale/revenue evidence
  grouped by canonical business product. It does not claim margin, adoption,
  outcome, or forecast measures that do not exist yet.
- The compatibility resolver is deterministic and injectable, with
  cross-organization, missing, and dual-match tests.
- No schema change is required. Migration disposition is
  **not applicable**; runtime migration-chain verification remains part of the
  combined stack gate because earlier phases add migrations.

## UX-fit review

- **Owning area:** Products.
- **Canonical routes:** `/portfolio`,
  `/portfolio/product/[id]/direction`, and
  `/portfolio/product-line/[id]/direction`.
- **Routes not created:** no second product dashboard, no new global-nav
  destination, no archetype-specific route, and no business-product route
  outside Products.
- **Primary personas:** professional product manager and small-business
  owner-operator.
- **Adaptation source:** the existing user-selected shell navigation mode.
  `operator` selects professional density; `worker` selects guided density.
  This is a presentation preference, not a fabricated organizational role.
- **Navigation layer:** product/product-line local section navigation only.
- **Component convergence:** reuse `SectionNav`, report-kit `Notice`,
  `StatusBadge`, `StatCard`, `EmptyState`, and `CollapsibleList`, plus existing
  evidence freshness semantics.
- **Source truth:** `ProductOperatingContext`.
- **First viewport order:** needs a decision, what changed, current bets, outcome
  posture, then next coworker runs. Counts and source detail are secondary.
- **Empty/failure behavior:** a fresh install explains how product mix is
  created in Storefront setup; partial/stale slices state what is missing and
  where the evidence came from; unauthorized or ambiguous identifiers fail
  closed without leaking existence.
- **AI boundary:** reading and contextual navigation never send a prompt.
  A reusable preview component may expose read scope, proposed writes, sources,
  approval boundary, and schedule effect, but no mutation is wired unless an
  existing governed tool and authorization boundary are verified. Cancel must
  always be available.
- **Verification:** component and route tests; desktop and narrow viewports;
  keyboard-only and 200% zoom; populated, empty, partial, stale, ambiguous, and
  unauthorized fixtures.

## TDD implementation sequence

### 1. Refactor the route and authorization boundary

- Add a pure/injectable product-route authority resolver and red tests for
  business-only, digital-only, missing, cross-organization, and dual-match
  identifiers.
- Add one authenticated current-organization wrapper around
  `loadProductOperatingContext`; keep authorization at that boundary.
- Refactor the existing product layout to render the existing digital header
  and nav unchanged or the new business header and nav. Add layout/route tests.
- For a business product at `/portfolio/product/[id]`, redirect to
  `/direction`; digital-product overview behavior remains unchanged.

### 2. Extend the canonical projection for honest comparison

- Add deterministic per-business-product commercial summaries derived from the
  already-loaded Product Sold rows.
- Add red tests for multiple products, mixed currency, bundles/component
  allocation, missing sales, and stable ordering.
- Keep the existing aggregate summary unchanged and remove any duplicate
  calculation from UI components.

### 3. Build the Product Direction presentation

- Add a business-product `SectionNav` with Direction / Brief now and reserved
  Intelligence, Roadmap, and Outcomes destinations that render honest
  phase-aware unavailable states until their owning phases land.
- Create and test `ProductDirectionBrief`, `NeedsDecisionList`,
  `EvidenceDeltaList`, `CurrentBets`, and `OutcomePosture`.
- Facts, deterministic calculations, unavailable data, and future AI inference
  must be visibly distinct.
- Keep exactly one marked primary action. Put provenance and professional
  source detail behind progressive disclosure in guided mode.
- Add a reusable preview-before-mutation panel with cancel behavior. Wire only
  contextual navigation in this phase unless an existing governed mutation
  tool is proven to fit.

### 4. Add product-line hierarchy and workspace

- Extend `/portfolio` with a business-product-line section above the existing
  digital-product substrate. Preserve the stable portfolio slug
  `products_and_services_sold`.
- Render the canonical hierarchy, direct/descendant product counts, honest
  additive sales/revenue summaries, and product drill-ins.
- Add `/portfolio/product-line/[id]/direction` over the same direction
  projection/components, leading with comparable product rows.
- Use an action-oriented setup empty state instead of zero-filled metrics.

### 5. Documentation and invariants

- Update the Product Management user guide, setup guide, architecture route/data
  boundary documentation, and AI-coworker guidance affected by Direction.
- Add route-authority, source-provenance, hierarchy, theme-token,
  accessibility-structure, and no-inferred-consumer invariants.
- Record source and combined-runtime evidence against `BI-C2C08E30`.

## Explicit refactoring allocation

Approximately 20% of this slice is reserved for:

- the route-authority compatibility resolver;
- the authenticated operating-context loader;
- the per-product commercial projection;
- shared business-product header/navigation models;
- removal of presentation-level joins and duplicated status/freshness rules;
- invariant tests covering ambiguity, organization isolation, and provenance.

These are delivery work, not optional cleanup.

## Verification strategy

Source-local worktree checks:

1. Red/green targeted Vitest suites where dependencies are available.
2. Strict TypeScript compilation of pure/injectable modules.
3. Route/component render tests, token scan, documentation checks, schema and
   migration-safety guards.
4. DCO commit and pushed branch checkpoint.

Combined shared-sandbox gate after Phases 6-12 are stacked:

1. sandbox freshness preflight and lease evidence;
2. affected unit tests and full production build;
3. full migration deployment against existing data;
4. desktop/narrow/200%-zoom/keyboard UX for simple, salon+retail,
   hotel+events, and restaurant+private-events fixtures;
5. empty, partial, stale, ambiguous, and unauthorized cases;
6. ready-for-review PR, `pnpm pr:health`, and merge queue.

## Backlog coverage

Governed receipt: `cms54w8hf019201qw57ucob1r` (`atomic`).

This child plan is atomic to `BI-C2C08E30`: the route boundary, shared
projection, product and product-line presentations, preview boundary, tests,
and documentation are not independently valuable releases because each is
required to make the same workspace truthful and navigable.

Dependency mapping:

1. `route-boundary`
2. `direction-projection` → `route-boundary`
3. `product-direction` → `route-boundary`, `direction-projection`
4. `product-line-direction` → `direction-projection`
5. `preview-boundary` → `product-direction`
6. `evidence-docs` → `product-direction`, `product-line-direction`,
   `preview-boundary`

## Source checkpoint evidence

Recorded before the stacked runtime gate:

- backlog coverage receipt `cms54w8hf019201qw57ucob1r` revalidated
  `ok: true`;
- strict TypeScript compilation passed for the operating-context query,
  route-authority, product-direction, and product-line projection boundaries;
- syntax transpilation passed for all 48 changed TypeScript/TSX files;
- a functional query smoke proved the `commercial-summary` profile reads
  `ProductSold` once while refusing offering, intelligence, demand, delivery,
  and architecture delegates;
- route-manifest and route-audience checks passed with 591 canonical routes
  and 344 page routes;
- documentation index, links, impact, and reference-integrity checks passed;
- `git diff --check` and stewardship-scope checks passed;
- targeted Vitest startup is unrun in this source-only worktree because its
  module graph cannot resolve `vitest/config`, `@vitejs/plugin-react`, or
  `dotenv`. This is classified as a worktree harness limitation. The tests,
  production build, migration apply, and browser/accessibility cases remain
  mandatory in the combined leased sandbox;
- the cross-stack style and route-error guards found inherited Phase 3 catalog
  violations. They are owned by `BI-83C7D9EE` and must be repaired in that
  lower branch before the stack is offered for review.
