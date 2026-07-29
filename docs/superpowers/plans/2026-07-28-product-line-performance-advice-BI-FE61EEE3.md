# Product-line Performance and Proactive Advice — BI-FE61EEE3

**Date:** 2026-07-28
**Epic:** `EP-ED496EB0`
**Umbrella BI:** `BI-5C5FA641`
**Backlog item:** `BI-FE61EEE3`
**Branch:** `feat/product-line-performance-advice`
**Parent branch:** `feat/product-objective-outcome-learning`
**Work capsule:** `WC-31DEAA0A`

## Goal

Turn the existing organization → ProductLine → Product operating projection
into an evidence-honest performance view and bounded recommendation surface.
Compare only measures supported by current records, show missing and stale
evidence explicitly, attribute packages without double counting, and route any
real business choice through the organization's WWWD stance at action time.

This phase does not add an analytics warehouse, a persisted advice ledger, a
second product hierarchy, or autonomous commercial mutations.

## Live and source audit

- Live DPF backlog state was retrieved before planning. `BI-FE61EEE3` is the
  Phase 10 child of `EP-ED496EB0`, is triaged `build`, and has a governed
  external Work Capsule `WC-31DEAA0A`.
- Live tables currently contain no Product/ProductLine operating rows and no
  finance, order, or booking facts. The live schema has Product and ProductLine
  but not the later stacked Product Sold or Phase 9 objective tables, so runtime
  proof must use the complete stacked branch and explicit fixtures.
- The stacked source already owns business hierarchy and scope in
  `ProductOperatingContext`. It projects Product Sold, demand, objectives,
  outcomes, catalog items, freshness, and source identifiers.
- `product-line-direction-view.ts` and `ProductLineComparison.tsx` already
  provide a narrow sales/revenue comparison. They are the extension point;
  Phase 10 will not create a second portfolio dashboard.
- `commercial-performance.ts` already enforces non-additive package component
  allocation, but the current summary does not yet reconcile cancelled and
  refunded sales or explicit time windows.
- Finance, CRM conversion, repeat-purchase identity, inventory/stock,
  utilization/capacity, shared-cost margin, and cannibalization do not have a
  verified business-Product attribution adapter in this projection. Those
  measures must report unavailable rather than being inferred from adjacent
  records.
- Existing `evaluate_org_business_decision` is the governed WWWD boundary and
  existing DecisionInteraction records are the decision/correction trail. No
  new advice persistence authority is justified.

## Governed architecture decision

WWMD DecisionInteraction `DI-7D5119BAD3F3` compared:

1. derived typed recommendation candidates with WWWD consultation at action
   time;
2. a new persisted ProductAdvice ledger; and
3. a WWWD model call on every page read.

The kernel selected `derived-candidates-wwwd-on-action` with high confidence,
a `9.592` composite score, a `3.387` margin, strong structured coverage, and no
commandment conflict.

Decision:

- performance metrics and candidate actions are pure projections over
  `ProductOperatingContext`;
- every candidate cites typed measures, source IDs, time window, `asOf`,
  confidence, and blind spots;
- the contextual coworker can use `evaluate_org_business_decision` when the
  operator chooses to investigate or act;
- the decision ledger captures the actual WWWD consultation, corrections, and
  disposition; later ProductObjective observations capture outcomes;
- generated advice prose is not stored as a second authority and no model call
  occurs merely because a page rendered.

## Architecture review

**Verdict: fit, with adapter and attribution controls.**

- Extend `ProductOperatingContext` with the minimum source attribution needed
  for per-product demand and objective rollups; do not add summary tables.
- Add a pure `product-performance.ts` projection with closed measure,
  availability, trend, issue, action, evidence, and audience contracts.
- Preserve bottom-up line aggregation and nested-line cycle protection.
- Count each root Product Sold record once. Package allocations remain
  non-additive attribution. Cancelled and fully refunded records are excluded
  from recognized revenue and reported separately.
- Never normalize mixed currencies without a canonical conversion source.
- Keep unavailable margin, conversion, repeat purchase, attach rate,
  capacity/utilization, stock, quality, and cannibalization visible in the
  measure contract until a verified adapter exists.
- Keep sourced facts, deterministic calculations, and recommendation
  interpretation distinguishable.
- Reuse route context and the WWWD tool pack; do not create a Phase 10 mutation
  API.

## UX-fit review

**Verdict: fit by deepening the existing product-line Direction page.**

- Lead with a concise “What deserves attention?” recommendation list, then a
  readable comparison table. Do not introduce a chart whose missing values,
  mixed units, or accessibility burden obscure the evidence.
- Owner-operator mode uses plain actions such as “check demand” and “fix
  package attribution.” Professional mode discloses period comparison,
  metric availability, confidence, source counts, and blind spots.
- Every status uses text in addition to color. Semantic headings and a table
  preserve keyboard and screen-reader access.
- Sparse-data businesses see one honest next step to improve evidence, not an
  empty enterprise analytics dashboard.
- Drill links stay within Products and lead to the existing product Direction
  routes. Advanced measure details are progressively disclosed.
- Design-intelligence review reinforced semantic headings, text labels beyond
  color, and an accessible table over radar/treemap visualizations for this
  sparse heterogeneous comparison.

## Implementation sequence

Backlog coverage receipt: `cms5bubxl08dv01qwr6jv8c3l` (`atomic`).

### 1. Contract tests first

- Add failing tests for explicit current/baseline periods, availability,
  freshness, confidence, trend, and evidence references.
- Cover recognized revenue, cancelled/refunded reconciliation, unique root
  sales, package allocation, mixed currencies, and missing adapters.
- Cover nested product-line rollups without product or revenue duplication.
- Cover demand opportunity, attribution gap, overdue outcome review, stale
  evidence, and no-recommendation states.
- Cover owner-operator and professional language from one projection.
- Add salon goods/services, hotel rooms/events, and restaurant dining/events
  fixtures.

### 2. Canonical projection and compatibility refactor

- Extend source items only where product attribution was lost during context
  projection.
- Extract a pure performance projection from the current narrow
  `product-line-direction-view.ts` calculation.
- Retain compatibility fields while moving cancellation/refund, period,
  availability, currency, and package rules to one module.
- Remove duplicated line/product summation rules and keep the hierarchy walker
  as the one rollup boundary.

### 3. Product-line Direction experience

- Replace the sales-only cards with the role-adaptive recommendation and
  comparison view.
- Show recorded revenue, sales, demand and outcomes when available.
- Show unavailable measures and why they are unavailable.
- Include explicit source window, freshness, confidence, blind spots, and
  drill-through.
- Add a contextual coworker prompt for WWWD review; consequential changes stay
  previewed and governed.

### 4. Documentation and evidence

- Update operator Products guidance, architecture/query-boundary guidance, and
  AI-coworker guidance.
- Record source verification on the BI and Work Capsule.
- Leave the BI and capsule open until the combined Phase 9–12 sandbox gate
  verifies tests, build, stacked migrations, and browser scenarios.

## Migration safety

No Prisma model or migration is planned. Phase 10 is a read-model and UX
extension over canonical Product, ProductLine, Product Sold, demand, objective,
and decision authorities. If implementation reveals a missing attribution
field, stop and run substrate verification plus WWMD before adding schema.

## Refactoring allocation

Approximately 20% of Phase 10 capacity is reserved for:

- one canonical metric/period/availability contract;
- one hierarchy rollup path instead of separate card and advice summations;
- a compatibility adapter for existing `commercialPerformance` fields;
- cancellation/refund and package-attribution invariant tests;
- extracting Phase 10 additions away from already-baselined route/grant
  modules where possible;
- reducing inherited module-size findings during the combined pre-PR pass.

## Verification

Source checkpoint:

- TypeScript syntax checks for all changed/new source;
- focused pure projection and component tests when dependencies are available;
- module-size, source-policy, whitespace, and staged-secret guards.

Combined leased-sandbox gate after Phase 12:

- freshness convergence and stacked Prisma validation/migration apply;
- Phase 9–12 targeted tests and `pnpm --filter web build`;
- browser verification for sparse, stale, bundle-heavy, owner-operator, and
  professional views;
- salon services plus retail goods;
- hotel rooms plus conferences/events;
- restaurant dining plus private events;
- proof that unavailable margin/capacity/conversion data is not fabricated;
- proof that WWWD consultation is action-time and no page-load mutation occurs.

## Source checkpoint — 2026-07-28

Implemented:

- explicit current/baseline performance periods;
- recognized Product Sold reconciliation with cancelled/refunded exclusion,
  unique root-sale counting, mixed-currency withholding, and non-additive
  package allocation;
- bottom-up Product and nested ProductLine rollups with cited measure
  availability, freshness, confidence, and blind spots;
- attributed demand and objective/outcome measures;
- bounded opportunity, attribution, overdue-review, and stale-evidence
  recommendation candidates;
- one role-adaptive, accessible DataTable-based Direction experience;
- a dedicated product-line coworker context that consults WWWD only on
  operator request;
- removal of the superseded sales-only comparison component and duplicated
  comparison mapper;
- affected operator, architecture, and AI-coworker documentation.

Source-local evidence:

- all changed/new TypeScript and TSX files passed parser/transpilation syntax
  diagnostics and the changed-file semantic diagnostic pass;
- the pure projection was executed directly against a nested-line fixture and
  produced the expected `1000` current recognized revenue, `500` baseline,
  refund/cancellation reconciliation, and attribution-gap recommendation;
- `git diff --check`, Reporting Composition Guard, and MCP Tool Pack Guard
  passed;
- the new Phase 10 modules are under the module-size ceiling. The repository
  module-size guard still reports inherited stacked Phase 1–9 files plus small
  registry extensions; those remain assigned to the combined refactoring pass
  before PR creation;
- the source-only worktree has no `node_modules`, so targeted Vitest,
  production build, and browser verification are deliberately unrun and
  assigned to the one combined leased-sandbox gate after Phase 12;
- migration apply is not applicable to Phase 10 because it adds no schema or
  migration. The combined gate still applies the inherited stacked migrations.

## Explicit exclusions

- persisted ProductAdvice or analytics summary tables;
- currency conversion without a canonical rate;
- inferred shared cost, margin, capacity, stock, customer identity, repeat
  purchase, quality, or cannibalization;
- automatic marketing, capacity, catalog, pricing, or funding changes;
- Phase 11 roadmap derivation;
- Phase 12 playbook packaging and scheduled triggers.
