# Business Product-Line Setup — `BI-AD7F9D34`

**Date:** 2026-07-28
**Status:** Approved for implementation by the operator's explicit Phase 1 instruction
**Epic:** `EP-ED496EB0`
**Backlog item:** `BI-AD7F9D34`
**Umbrella:** `BI-5C5FA641`
**Work Capsule:** `WC-52D539CD`
**Branch:** `feat/product-line-setup`
**Worktree:** `D:/DPF-worktrees/product-line-setup`
**WWMD decision:** `DI-30325B6759C2`
**Backlog coverage receipt:** `cms4ou53k0or301runx7ybazo`

## Goal

Give a business a durable, organization-scoped ProductLine -> Product hierarchy and
capture its initial product mix during storefront setup. A small business sees one
plain-language question and a suggested primary line. Mixed businesses can confirm
adjacent lines without being exposed to enterprise portfolio machinery.

The implementation must preserve these boundaries:

- `DigitalProduct` and WWMD remain digital-product architecture.
- `products_and_services_sold` remains the stable internal portfolio slug and
  "Goods and Services for Sale" remains its operator label.
- `Organization` is the default provider for a simple business.
- consumers are never created without customer, booking, order, subscription, or
  fulfilment evidence.
- Storefront archetypes, compositions, onboarding, and portfolio projections are
  extended; no parallel setup or taxonomy authority is introduced.
- catalog, pricing, offering versioning, market evidence, lifecycle governance,
  work decomposition, change intake, release, and learning-loop work remain in
  their later backlog items.

## Grounding

Canonical design and parent plan:

- `docs/superpowers/specs/2026-07-27-product-management-operating-loop-design.md`
- `docs/superpowers/plans/2026-07-27-product-management-operating-loop.md`

Live context retrieved through DPF MCP on 2026-07-28:

- `BI-AD7F9D34` is `in-progress`, triaged `build`, effort `large`.
- `EP-ED496EB0` is open with 13 live backlog items; all later phases remain open.
- no active build or overlapping open product-line/setup PR was found.
- the live install has one organization and storefront, one active composition,
  321 `DigitalProduct` rows, no business ProductLine/Product substrate, no
  `ServiceOffering` rows, one customer account, and 12 bookings.
- the `products_and_services_sold` portfolio exists with the correct display name
  and one digital product.
- the global taxonomy contains 160 reference nodes under the sold portfolio; it is
  reference data, not an organization-owned mutable product hierarchy.
- code-graph results were stale (`workspaceDirty=true`, trust 0.66), so repository
  inspection used `rg` and direct source reads as the governed fallback.

Existing substrate to extend:

- `packages/db/prisma/schema.prisma`
- `packages/storefront-templates/src/types.ts`
- `packages/storefront-templates/src/archetypes/`
- `packages/db/src/seed-storefront-archetypes.ts`
- `apps/web/app/(shell)/storefront/setup/page.tsx`
- `apps/web/components/storefront-admin/SetupWizard.tsx`
- `apps/web/app/api/storefront/admin/setup/route.ts`
- `apps/web/lib/actions/service-line-actions.ts`
- `apps/web/lib/onboarding/seed-market-offer.ts`
- `apps/web/lib/onboarding/run-setup-completion-seeds.ts`
- `apps/web/lib/operating-model-pages.ts`

## Architecture review

**Decision:** proceed with a new organization-owned `ProductLine` and `Product`
substrate, bound to the existing storefront composition and onboarding surfaces.

Why the new substrate is justified:

- `DigitalProduct` is intentionally the EEMD/digital-architecture model and cannot
  become the authority for salon services, hotel rooms, meals, or retail goods.
- `StorefrontArchetype` and the taxonomy are global reference definitions, not
  organization-owned mutable business facts.
- `StorefrontArchetypeComposition` expresses channel/template composition but
  cannot represent nested business rollups or products independent of a storefront
  template.
- `ServiceOffering` represents an operational commitment and belongs to the later
  commercial contract, not the business product definition.

Canonical ownership:

| Concern | Authority |
| --- | --- |
| business product-line hierarchy | organization-scoped `ProductLine` / `Product` |
| provider | existing `Organization`; no placeholder provider model |
| setup defaults | checked-in archetype definition, seeded to live `StorefrontArchetype` JSON |
| active channel composition | existing `StorefrontArchetypeComposition` |
| digital architecture | existing `DigitalProduct` |
| sold portfolio projection | existing `products_and_services_sold` portfolio |
| customer/consumer evidence | existing customer, booking, order, subscription, and fulfilment records |

The hierarchy is top-down: a product belongs to one product line; a product line
may have a parent line within the same organization. Stable semantic IDs support
rollups and future effective dating. The application validates organization
isolation and cycles; database constraints enforce same-row facts, uniqueness,
and referential integrity.

### WWMD option decision

Question: where should product-mix defaults live?

1. `seeded_archetype_metadata` — checked-in optional metadata seeded into the live
   archetype record, with custom archetypes using the same persisted shape.
2. `database_only_configuration` — mutable JSON with no checked-in seed authority.
3. `application_registry` — a separate web-app mapping keyed by archetype ID.

Kernel result `DI-30325B6759C2`: option 1, composite `6.208`, margin `2.397`,
confidence `high`. Strongest positive contributors were Never Assume — Verify and
Research and Use Standards. No commandment conflict or weak-coverage flag fired.

## UX-fit review

**UX-Fit-Decision: fits-with-guardrails**

The setup route remains the correct surface because this information determines
the initial market offer and composition before the storefront is created. The
operator sees:

1. the existing archetype choice;
2. one new "What does your business sell?" group after that choice;
3. a preselected primary line in business language;
4. optional adjacent-line suggestions as ordinary checkboxes;
5. an "Add another product line" action for a plain-language custom line.

Guardrails:

- do not expose parent IDs, stable IDs, portfolio slugs, rollup controls,
  provenance, provider/consumer records, or enterprise vocabulary in setup;
- default to one line and keep all adjacent choices optional;
- do not add a separate wizard step or require a product-by-product catalog build;
- use existing form primitives and semantic fieldset/legend controls;
- show a concise summary in the review panel;
- preserve keyboard operation, focus visibility, accessible labels, minimum target
  size, reduced-motion behavior, and responsive stacking;
- validation must identify the exact field and preserve entered values;
- advanced hierarchy editing stays in the existing Products/Portfolio surface in
  later work.

Design-intelligence evidence:

- minimal/direct onboarding is preferred for small tools;
- complex onboarding and clutter are explicit anti-patterns;
- service businesses need a legible service list and booking context, not
  enterprise product-management terminology.

## Backlog coverage

**Decision:** atomic.

All deliverables below map to `BI-AD7F9D34`. The schema without setup is not an
operator outcome; setup without durable models cannot satisfy traceability; seeded
metadata without the live reader creates drift; compatibility and documentation
must land with the write path. Splitting any one of them would produce an
incomplete or competing authority.

| Key | Deliverable | Independently shippable | Dependency |
| --- | --- | --- | --- |
| `business-product-contract` | ProductLine/Product schema and invariants | no | none |
| `archetype-product-mix` | typed, seeded product-mix metadata | no | business-product-contract |
| `setup-capture` | progressive setup input and validated API contract | no | archetype-product-mix |
| `hierarchy-projection` | idempotent product hierarchy writer and compatibility projection | no | business-product-contract, setup-capture |
| `docs-and-evidence` | user, architecture, setup, coworker docs and verification evidence | no | all preceding deliverables |

## Effort and refactoring allocation

The bounded estimate is 30 coarse effort units: 24 feature units and 6 refactoring
units. `6 / 30 = 20%`.

| Work | Feature | Refactor |
| --- | ---: | ---: |
| schema, migration, data-impact contract | 7 | 1 |
| archetype metadata and setup domain model | 5 | 2 |
| setup UI and API | 7 | 1 |
| idempotent projection and compatibility | 3 | 2 |
| docs and evidence | 2 | 0 |
| **Total** | **24** | **6** |

The six refactoring units are reserved for:

1. one canonical typed product-mix parser/normalizer shared by seed, server, and
   tests;
2. one canonical organization product-hierarchy writer with transaction boundary;
3. extracting duplicated storefront composition seeding needed by setup and
   secondary-line activation;
4. a compatibility adapter that keeps legacy market-offer consumers reading the
   sold portfolio without making `DigitalProduct` the business authority;
5. invariant tests for stable portfolio identity, organization isolation, cycle
   prevention, deterministic IDs, and idempotence;
6. removal of product-mix rules duplicated between the client and API.

No general SetupWizard rewrite or later-phase product-area redesign is allowed.

## Migration safety

Use an expand-first additive migration:

- create nullable/additive archetype product-mix metadata;
- create `ProductLine`, `Product`, and only the minimum compatibility relation
  required by the approved design;
- add indexes and uniqueness constraints that new empty tables cannot violate;
- add nullable composition linkage if needed for traceability;
- do not drop, rename, repurpose, or make an existing column non-null;
- do not mutate existing `DigitalProduct`, `ServiceOffering`, taxonomy, or portfolio
  rows in SQL;
- include an explicit `@migration-safety: data-safe` attestation for every
  tightening statement whose target table is new/empty;
- perform deterministic existing-install reconciliation through the idempotent
  application writer using confirmed storefront configuration/composition evidence.

The migration must apply to both a clean database and a representative populated
database. Rollback is application rollback: old code ignores additive tables and
columns. Data is retained; no reverse destructive migration is shipped.

Create a data-impact manifest under `docs/data-impact/` that records ownership,
provenance, lifecycle, migration behavior, and tests for each persistent field.

## TDD implementation sequence

### Task 1 — RED: product hierarchy contract

Create failing tests for:

- stable, organization-scoped line and product IDs;
- one product line owning each product;
- nested line rollups;
- parent and product references cannot cross organizations;
- a line cannot parent itself or create a cycle;
- organization is the provider when no explicit provider evidence exists;
- no consumer, team, unit, subscriber, or entitlement is fabricated;
- `products_and_services_sold` remains the canonical internal slug and label.

Then add the additive Prisma models, relations, migration, and data-impact
manifest. Keep enum-like values canonical and typed in one shared module.

### Task 2 — RED: product-mix metadata

Add failing package tests for:

- absent metadata normalizes to one primary line derived from the archetype name
  and item templates;
- explicit primary and adjacent suggestions preserve stable keys;
- duplicate keys and blank labels are rejected;
- custom archetypes use the same shape;
- salon suggests services plus optional retail goods;
- restaurant suggests dining plus optional private events;
- a hotel custom-archetype fixture supports rooms plus conferences/events;
- no suggestion is interpreted as a consumer or team.

Extend `ArchetypeDefinition` with an optional typed `productMix`, seed it to a new
`StorefrontArchetype.productMix` JSON field, and add curated metadata only where
the acceptance fixtures require it. Do not add a new hotel archetype in this BI.

### Task 3 — RED: canonical hierarchy writer

Add failing tests around a pure plan builder and transactional repository boundary:

- confirmed lines are upserted idempotently by organization + stable key;
- rename updates the business label without changing identity;
- removal retires or disconnects an unconfirmed line without deleting unrelated
  business data;
- products are created from confirmed line defaults without duplicates;
- primary and adjacent composition provenance is preserved;
- replay produces zero additional rows;
- existing organizations can be reconciled only from confirmed config,
  composition, and storefront-item evidence;
- ambiguous legacy items remain untouched.

Implement the writer under `apps/web/lib/products/`. Bind it to existing
StorefrontArchetypeComposition provenance and call it from setup completion. Keep
legacy market-offer behavior behind a compatibility adapter; do not expand the
Phase 2 offering contract.

### Task 4 — RED: setup request and UI

Add failing API/domain tests before component code:

- request validation requires at least one valid line;
- the primary suggestion is selected by default;
- adjacent suggestions are optional;
- custom labels are trimmed, deduplicated, length-limited, and encoded safely;
- unknown suggestion keys and archetype mismatches are rejected;
- setup creates config, composition, product hierarchy, and existing derived
  context atomically or compensates without partial authority;
- replay/recovery is idempotent.

Add failing component tests for semantic labels, keyboard behavior, summary copy,
mobile stacking, validation recovery, and the four acceptance fixtures. Modify the
existing SetupWizard rather than creating a parallel setup route.

### Task 5 — GREEN/refactor: projections and documentation

Route setup completion, operating-model pages, and legacy market-offer readers
through the canonical product hierarchy/query boundary. Update:

- `docs/user-guide/storefront/setup-and-launch.md`
- `docs/user-guide/products/index.md`
- `docs/user-guide/products/business-model-roles.md`
- `docs/user-guide/portfolios/index.md`
- `docs/architecture/ai-coworker-development-principles.md`
- the parent product-management architecture history if implementation details
  resolve a child shape not already recorded there.

Document simple-business defaults, mixed goods/services examples, provider and
consumer evidence rules, the DigitalProduct boundary, and how AI coworkers query
the canonical hierarchy without inventing organizational structure.

## Verification

The topic worktree is `source-only`; missing `node_modules` is a harness state, not
product evidence. Cheap checks may run only if the worktree becomes compile-ready.
Runtime-bound evidence must use the leased `local-integration-ci` sandbox.

Required gates:

1. targeted Vitest suites for DB seed/types, hierarchy invariants, setup API/domain,
   onboarding projection, and SetupWizard;
2. `pnpm --filter web build` with zero errors;
3. migration apply against clean and populated representative states;
4. setup UX exercised for:
   - simple one-line business;
   - salon services plus retail goods;
   - hotel rooms plus conferences/events using a custom-archetype fixture;
   - restaurant dining plus private events;
5. accessibility checks at narrow and wide viewport, keyboard-only traversal,
   visible focus, validation recovery, and no horizontal overflow;
6. live data assertions that the organization is provider, product hierarchy is
   idempotent, and no placeholder consumers or enterprise structures exist;
7. documentation impact check and data-impact guard;
8. local merged-code CI against current `origin/main`.

Evidence must include branch/SHA, lease ID, sandbox freshness, resolved dependency
versions, migration result, fixture screenshots or structured UX observations, and
row-count/invariant queries.

## Delivery

Before publishing:

- re-fetch `origin/main`;
- re-sweep live backlog, active builds, open PRs, and changed source surfaces;
- replay only this branch's commits if freshness requires it;
- run local merged-code verification through the governed sandbox;
- record implementation evidence on `BI-AD7F9D34`;
- commit with `git commit -s`;
- push `feat/product-line-setup`;
- open a regular ready-for-review PR;
- run `pnpm pr:health <number>` and resolve every check/review thread;
- enqueue with `gh pr merge <number> --squash --auto`;
- mark `BI-AD7F9D34` done only after the Phase 1 implementation and evidence are
  genuinely complete.

Stop rather than broadening the branch if a requirement belongs to any later epic
item or if a governed decision exposes a new authority boundary.
