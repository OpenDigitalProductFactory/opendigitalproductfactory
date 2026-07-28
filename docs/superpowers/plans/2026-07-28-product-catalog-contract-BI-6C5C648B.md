# Product and Catalog Contract — BI-6C5C648B

**Epic:** `EP-ED496EB0`
**Backlog item:** `BI-6C5C648B`
**Work Capsule:** `WC-3FBFBBB8`
**Branch:** `feat/product-catalog-contract`
**Design:** `docs/superpowers/specs/2026-07-27-product-management-operating-loop-design.md`
**Parent plan:** `docs/superpowers/plans/2026-07-27-product-management-operating-loop.md`
**Architecture decision:** `DI-26D56D03E6BD` (`complete-progressive`)
**Delivery-shape decision:** `DI-8099038F7236`

## Outcome

Establish a complete but progressively disclosed commercial chain:

`ProductLine → Product → ProductOffering → CatalogItem → optional reusable ProductConfiguration/SKU → channel projection`

`Product` remains the organization-owned business product. `DigitalProduct` remains the digital-architecture product. `ProductOffering` owns the commercial promise; `ServiceOffering` continues to own digital operational commitments. `CatalogItem` is the canonical selectable/requestable commercial object, while `StorefrontItem` remains a storefront channel projection.

The common owner-operated case appears as one “what you sell” workflow. Provider identity remains canonical and defaults to the organization. Consumers are not created or inferred until customer, booking, quote, order, subscription, or fulfillment evidence exists.

## Existing substrate audit

- `ProductLine` and `Product` are the Phase 1 business authority. They intentionally have no fabricated link to `DigitalProduct`.
- `ServiceOffering` requires `DigitalProduct` and owns availability, MTTR, RTO/RPO, support hours, CLA/OLA, and consumer metadata. It is an operational-commitment model, not the new commercial authority.
- `/portfolio/product/[id]/offerings` is a `DigitalProduct` detail tab and currently renders `ServiceOffering` records directly.
- `StorefrontItem` owns duplicated name, description, price, CTA, booking configuration, and presentation fields. It has no structural trace to `Product`, an offering, or a canonical catalog definition.
- Storefront item create/update APIs write `StorefrontItem` directly. Composition seeding also creates storefront items directly.
- `QuoteLineItem.productId` points to `DigitalProduct`; ad-hoc quote lines are allowed and the one live quote line has no digital-product link.
- The live canonical install currently contains 321 `DigitalProduct` rows, zero `ServiceOffering` rows, 11 `StorefrontItem` rows, and one unlinked `QuoteLineItem`. Its database has not yet advanced through the newly merged Phase 1 migrations, so representative Phase 2 migration evidence must run against the governed convergence sandbox rather than treating this runtime skew as product state.

## Architecture review

**Decision:** aligned with important guardrails.

1. Add `ProductOffering`, not a renamed or repurposed `ServiceOffering`. The two have distinct ownership and lifecycle semantics. A nullable trace to `ServiceOffering` is allowed only when a real digital operational commitment realizes a commercial offering.
2. Add `CatalogItem` as the commercial source of truth. `StorefrontItem.catalogItemId` is an additive nullable projection link; compatibility reads and writes remain until later contract work proves a safe cutover.
3. Add the minimum Phase 2 configuration contract: reusable `ProductConfiguration` records and optional `CatalogSku` identifiers. Phase 3 owns bundles, price lists, promotions, option-rule authoring, package attribution, and promotion workflows.
4. Add `QuoteLineItem.catalogItemId` plus an immutable sale-specific configuration snapshot. Preserve the existing nullable `productId` digital-product link during expand-first compatibility.
5. Require organization-scoped composite relations for every business-commercial edge. Provider organization is required; consuming-party identity is absent until supported by real transactional evidence.
6. Do not add a generic channel-projection table. Existing channel-specific models link directly to `CatalogItem`; this avoids a second presentation authority while allowing one catalog item to project to many channel records.
7. Centralize creation and compatibility rules in one canonical commercial-chain service. API routes, setup/composition seeds, and later channel adapters call that boundary instead of duplicating provisioning logic.

**Blast radius:** Prisma schema and migrations; organization/product relations; storefront item create/update/read and composition seed paths; quote-line compatibility; product Offerings view; data classification/stewardship; setup/demo backfill; user and architecture documentation.

## UX-fit review

**Decision:** fits with guardrails.

- **Owning area:** internal Storefront management for owner/operator work; Products/Portfolio for digital-architecture operational commitments.
- **Canonical routes:** `/storefront/items` for “what you sell”; `/portfolio/product/[id]/offerings` for a `DigitalProduct`’s operational commitments and any explicitly linked commercial trace.
- **Primary persona:** an owner/operator who should create or edit a normal sellable item without understanding product, offering, catalog, SKU, subscriber, or entitlement records.
- **Navigation layer:** existing section navigation and contextual actions only. No global navigation item, new product tab, or second Catalog Builder home.
- **Progressive disclosure:** the default editor changes the collapsed Product/Offering/CatalogItem chain together. Advanced commercial detail appears only when price, terms, channel, availability, reusable configuration, or operational commitment diverges.
- **Source truth:** `Product` owns what the business manages; `ProductOffering` owns the commercial promise; `CatalogItem` owns selectable terms; `StorefrontItem` owns storefront-only presentation; `ServiceOffering` owns digital operational commitments.
- **Empty/failure states:** explain “what you sell” in business language, preserve an honest unlinked compatibility state, and offer deterministic reconciliation rather than fabricated defaults.
- **AI boundary:** no prompt is sent by catalog navigation or editing.
- **Theme:** reuse existing storefront form primitives and DPF CSS variables. Remove the hardcoded status colors currently present in the DigitalProduct Offerings tab while it is in scope.

## Portal-navigation audit

The current route hierarchy already has the required homes:

- Storefront section navigation answers where owners manage their public goods/services.
- The product detail tab row answers which digital-product lifecycle concern is visible.
- Item create/edit controls are contextual actions, not navigation.

Adding a new global or section-level Catalog route would duplicate the Storefront home and expose schema distinctions as navigation. Phase 2 therefore adds no route. Phase 3 may add contextual Catalog Builder affordances inside Storefront management, but it must not introduce a competing product-management destination.

## Migration safety

Use expand-first, forward-only migrations:

1. Add new tables and nullable compatibility columns without changing existing reads.
2. Add organization-scoped unique keys and foreign keys only where existing rows cannot violate them; include in-file `@migration-safety` attestations for data-safe constraints.
3. Backfill only unambiguous storefront projections:
   - active composition has a real `productLineId`;
   - a same-organization `Product` key matches the storefront template/item key;
   - one default offering and catalog item can be created deterministically.
4. Leave ambiguous legacy rows unlinked and report them through reconciliation observability. Never guess a product or consumer.
5. Add dual-write and invariant guards before any read-authority switch.
6. Preserve `StorefrontItem`, `ServiceOffering`, and `QuoteLineItem.productId`; contraction belongs to a later, separately evidenced release.
7. Verify against representative existing rows as well as a clean schema.

## Test-driven implementation sequence

### Red 1 — canonical contracts

- Add schema/contract tests proving model ownership, composite organization boundaries, typed registries, nullable compatibility, and the absence of a mandatory `DigitalProduct` or consumer link.
- Add migration-safety tests for expand-only application against pre-existing storefront and quote rows.

### Green 1 — additive substrate

- Add `ProductOffering`, `CatalogItem`, `ProductConfiguration`, and `CatalogSku`.
- Add nullable `StorefrontItem.catalogItemId`.
- Add nullable `QuoteLineItem.catalogItemId` and immutable configuration snapshot.
- Register data classification, stewardship, retention, and schema guard expectations.

### Red 2 — collapsed commercial chain

- Test idempotent default Product → ProductOffering → CatalogItem creation.
- Test organization-as-provider default and no placeholder consumers.
- Test divergence without duplicate products or catalog definitions.
- Test ambiguous legacy storefront rows remain honestly unlinked.

### Green 2 — canonical service and compatibility adapters

- Implement one commercial-chain writer and read projection.
- Route storefront create/update and composition seeding through it transactionally.
- Add deterministic legacy reconciliation and observability.
- Preserve legacy response shapes while making catalog authority available.

### Red 3 — storefront, quote, and operational trace UX

- Test collapsed item editing, advanced disclosure conditions, honest empty/failure states, theme tokens, and route ownership.
- Test storefront reads prefer canonical catalog values with compatibility fallback.
- Test quote lines can reference exact catalog items and immutable sale snapshots without requiring a `DigitalProduct`.
- Test the DigitalProduct Offerings tab remains operational and only shows commercial trace when explicitly linked.

### Green 3 — UI and route integration

- Extend the existing Storefront Items workflow; add no navigation destination.
- Reconcile the DigitalProduct Offerings tab and replace hardcoded status colors.
- Add breadcrumbs/related-record drill-down only where the target already exists.

## Refactoring allocation

Reserve 20% of implementation capacity: **8 of 40 units**.

1. Extract the canonical commercial-chain query/write boundary.
2. Replace duplicated storefront item mapping in route, page, and seeding paths.
3. Centralize typed commercial status/channel/configuration registries and their MCP mirrors.
4. Remove hardcoded status colors from the Offerings tab.
5. Add invariant tests that prevent `DigitalProduct`, `ServiceOffering`, or `StorefrontItem` from becoming a parallel business-commercial authority.

Refactoring must reduce duplication or enforce a canonical boundary; it must not absorb later Phase 3–12 behavior.

## Documentation impact

Update in the same branch:

- owner setup/storefront guide for the collapsed “what you sell” workflow;
- architecture documentation for Product vs DigitalProduct and ProductOffering vs ServiceOffering;
- setup/onboarding documentation for default commercial-chain provisioning;
- AI-coworker guidance for provider/consumer evidence and catalog authority;
- data-model/route documentation and generated indexes affected by new models or links.

## Verification

### Source-local per-BI evidence

- Targeted schema, migration, service, compatibility, route, and component tests.
- Affected workspace typecheck when dependencies are available; otherwise classify the source-only harness honestly.
- Generated artifact and documentation checks.

### Integrated delivery-train evidence

The shared sandbox is scarce. Runtime-bound evidence is deferred until the dependency train is assembled, then run once over the exact integrated tree using the repository’s governed local-integration mechanism:

- dependency freshness;
- all affected unit tests;
- production build;
- representative migration application;
- Storefront “what you sell” UX for simple and divergent offerings;
- quote/catalog snapshot behavior;
- DigitalProduct operational-offering compatibility;
- complete later-phase operating-loop flows.

Each child BI receives acceptance-specific evidence from that run. Every PR still requires exact GitHub CI, `pnpm pr:health`, DCO, and the merge queue.

## Backlog coverage

This plan is deliberately atomic for `BI-6C5C648B`. The schema, canonical service, compatibility adapters, Storefront projection, quote seam, UX, migration, and documentation are not independently useful: splitting them would expose a second authority or a model with no safe reader/writer. Later catalog packaging, Product Sold, intelligence, demand, objective, roadmap, and playbook outcomes remain owned by their existing Phase 3–12 backlog items.

**Governed coverage receipt:** `cms4uc61g0y0001run2v0ttgx`

**Source evidence activity:** `cms4xetgv05cq01npasm7qxbv`

## Implementation evidence — source-local

Implemented on `feat/product-catalog-contract` from current `origin/main`:

- additive `ProductOffering`, `CatalogItem`, `ProductConfiguration`, and
  `CatalogSku` models with organization-preserving composite relations;
- nullable compatibility links from Storefront items, quote lines, and
  existing `RentableUnit` inventory to the canonical commercial chain;
- one canonical commercial-chain writer, one catalog-first Storefront row
  adapter, and one DigitalProduct operational-offering query boundary;
- transactional setup, item-create, and item-update integration;
- quote/MCP compatibility for exact Catalog items and immutable one-off
  configuration snapshots while retaining legacy DigitalProduct references;
- boot-time reconciliation through the existing setup seed authority, with
  linked/unresolved counts and no name-based inference;
- progressive owner UX: a one-line business sees no product-line modeling,
  while a confirmed mixed-line business chooses the real line when adding an
  item; legacy divergence alone shows **Needs setup link**;
- canonical data-asset registration and table sensitivity for every new model;
- owner, setup, architecture, and AI-coworker documentation.

Refactoring allocation delivered:

1. centralized Product/Offering/Catalog creation and collapsed updates;
2. removed duplicate page/API Storefront commercial projection mapping;
3. extracted the operational-offering query from the page;
4. centralized mixed-line selection and validation;
5. replaced hardcoded Offerings status colors with theme tokens;
6. added authority, organization-boundary, compatibility, and
   no-fabricated-consumer invariant tests.

Observed source-local evidence:

- 87 targeted assertions pass across commercial services, setup/boot
  reconciliation, quote actions and MCP mirroring, progressive UX, data
  governance, and schema contracts;
- Prisma Client generation succeeds for Prisma 7.8.0;
- the migration-safety guard reports no unattested tightening migrations;
- a direct TypeScript run with an explicit 8 GB heap passed before the final
  mixed-line UI slice; the final post-slice run is captured separately before
  commit.

Runtime-bound production build, migration application, and four-scenario UX
evidence remain intentionally assigned to the governed integrated delivery
train sandbox. This source-local section does not claim those gates.
