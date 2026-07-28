# Catalog Builder implementation plan (`BI-83C7D9EE`)

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

**Epic:** `EP-ED496EB0`
**Backlog item:** `BI-83C7D9EE`
**Dependency:** `BI-6C5C648B` (`feat/product-catalog-contract`)
**Work capsule:** `WC-0768119D`
**Branch:** `feat/catalog-builder`
**Worktree:** `D:\DPF-worktrees\catalog-builder`
**Design:** `docs/superpowers/specs/2026-07-27-product-management-operating-loop-design.md`

## Outcome

Add an owner-readable Catalog Builder over the Phase 2 commercial catalog. A business can keep the ordinary one-item/one-price experience, or deliberately add bundles, reusable configurations and SKUs, effective-dated price lists and promotions, channel eligibility, and the correct fulfillment route. Packaging never changes Product or ProductLine parentage, a one-off configuration never creates a reusable SKU implicitly, and package analytics expose component attribution without counting the sale twice.

This plan does not implement Product Sold, consumer/subscriber projections, Product Direction, intelligence, demand, objectives, roadmap, or later operating-loop phases.

## Backlog coverage

- Decision: `atomic`
- Coverage receipt: `cms4xq37r069301npvb0jxa5x`
- Parent BI: `BI-83C7D9EE`
- External dependency: `BI-6C5C648B`
- Rationale: the additive schema, canonical domain service, storefront compatibility adapter, progressive editor, immutable selection snapshots, and attribution invariants are one reviewable capability. None is independently safe or useful without the others.
- Internal deliverables:
  - `catalog-packaging-schema`
  - `catalog-builder-domain` → `catalog-packaging-schema`
  - `catalog-builder-ux` → `catalog-builder-domain`
  - `catalog-attribution-invariants` → `catalog-builder-domain`

## Verified starting point

- Phase 2 supplies `ProductOffering`, `CatalogItem`, `ProductConfiguration`, `CatalogSku`, `StorefrontItem.catalogItemId`, `RentableUnit.catalogSkuId`, and `QuoteLineItem.configurationSnapshot`.
- `CatalogItem` is the canonical purchase option. `StorefrontItem` is a compatibility/channel projection.
- `ProductConfiguration.specification` is the existing reusable configuration document; configuration rules extend that contract rather than creating another configuration authority.
- Existing public execution surfaces already distinguish storefront booking, purchase, inquiry/quote, donation, and rental.
- Existing `Quote`/`QuoteLineItem`/`SalesOrder`, `StorefrontBooking`, `Subscription`, `RentableUnit`, and rental-agreement services remain the transaction/fulfillment authorities.
- No business catalog price-list, bundle, promotion, or channel-eligibility model exists. Models named `ChangePromotion` and `PromotionBackup` belong to Build Studio and are not commercial promotions.
- Live data on 2026-07-28 contains 11 `StorefrontItem`, 12 `StorefrontBooking`, one `Quote`, one `QuoteLineItem`, zero `SalesOrder`, zero `Subscription`, and zero `RentableUnit` rows. The live schema does not yet contain the Phase 2 commercial catalog tables, so Phase 3 runtime verification must use the integrated Phase 2→3 migration train rather than infer safety from an empty new table.
- No overlapping open PR was found for catalog packaging, bundles, price lists, or business promotions.

## Governed option decision

WWMD decision `DI-325BC0273836` recommends `normalized-catalog-packaging` with high confidence (composite `9.775`, margin `4.412`):

1. **Chosen — normalized catalog-owned contracts.** Add small relational contracts for bundle components, price lists/entries, promotions, and channel eligibility; keep reusable rules on `ProductConfiguration`; use existing quote snapshots for one-off selections.
2. **Rejected — catalog JSON contract.** Faster initially, but weak for effective dating, referential integrity, query boundaries, analytics, and fleet evolution.
3. **Rejected — storefront-owned packaging.** Would make a channel projection the commercial authority and duplicate rules across future channels.

The earlier complete-model decision `DI-26D56D03E6BD` was escalated at low confidence, but the operator explicitly resolved its governing question in this epic: preserve the complete canonical model and use progressive disclosure. This child decision addresses only the remaining storage/ownership option.

## Architecture review (advisory)

- **Alignment summary:** aligned with guardrails after selecting normalized catalog-owned packaging and retaining transaction/channel authorities.
- **Important — catalog ownership:** bundles, price lists, promotions, eligibility, and fulfillment rules must reference canonical `CatalogItem`; they may not be stored only on `StorefrontItem` or `bookingConfig`.
  **Plan edit:** place writes behind `apps/web/lib/products/catalog-builder.ts` and make storefront APIs thin adapters.
- **Important — exact sale selection:** Phase 2 quote lines can identify `CatalogItem` or carry a one-off configuration, but cannot identify an exact reusable SKU.
  **Plan edit:** add nullable `QuoteLineItem.catalogSkuId` and keep `configurationSnapshot` immutable for one-off or historical selection detail.
- **Important — one-off promotion:** a successful quote configuration may become reusable only through an explicit command that creates `ProductConfiguration` and optional `CatalogSku`, records quote-line provenance, and is idempotent.
  **Plan edit:** add nullable promotion provenance to `ProductConfiguration`; never backfill reusable rows from arbitrary JSON.
- **Important — attribution:** component attribution is a projection of one package sale, not a second revenue ledger.
  **Plan edit:** persist optional allocation percentages on bundle membership, validate the total, and expose one package total plus non-additive component allocations from a pure query helper.
- **Minor — fixed values:** fulfillment routes, channel eligibility states, price-list statuses, promotion types/statuses, component eligibility, and allocation modes need canonical TypeScript registries. Database strings remain forward-compatible in the expand release; invariant tests prevent drift.
- **Migration posture:** additive tables and nullable columns only. No legacy row is guessed into a package, SKU, promotion, channel, or fulfillment route. Existing catalog rows derive a read-time route until a deterministic compatibility reconciliation writes it.
- **Standards inherited:** official ServiceNow catalog/product-offering guidance and IT4IT provider/consumer separation are already researched and cited by the parent design; no new external protocol is introduced.
- **Recommended next step:** proceed test-first with the schema/service contract, then the contextual storefront experience.

## UX fit review

- **Decision:** `fits-with-guardrails`
- **Owning area:** internal Storefront management
- **Canonical route family:** `/storefront/items`
- **Contextual advanced route:** `/storefront/items/[id]/catalog`
- **Primary persona:** owner/operator maintaining what customers can buy; a product manager may drill through from the product Commercial area.
- **Navigation layer:** contextual row action only; no global or Storefront section-navigation addition.
- **Simple path:** the existing create/edit dialog remains the default one-item/one-price workflow. CTA type deterministically supplies the initial fulfillment route.
- **Advanced disclosure:** “Manage packaging and sales options” appears only for a catalog-linked saved item. The advanced page groups package contents, price/validity, reusable options/SKUs, channel availability, and fulfillment.
- **Reuse/convergence:** reuse the existing Storefront page shell, row-action sheet, mutation states, form controls, theme tokens, and report-kit data display. Replace the existing hardcoded CTA badge colors while touching the list.
- **Source truth:** `CatalogItem` plus the catalog-builder read model; `StorefrontItem` supplies storefront presentation only.
- **Empty/failure behavior:** an unlinked legacy item shows the existing “Needs setup link” state; an empty advanced page explains that the ordinary price already works and offers optional packaging actions; invalid date/allocation/configuration rules return field-level guidance without partial writes.
- **AI boundary:** no AI prompt is sent by navigation or editor actions.
- **Evidence before merge:** component/route tests, keyboard/label checks, theme scan, mobile and desktop browser exercise, and the four required business fixtures.
- **Captured in:** this plan.

## Data contract

The final names may be mechanically adjusted to Prisma conventions, but ownership and traceability are fixed:

- `CatalogItem.fulfillmentRoute String?`
  - values: `direct-purchase`, `booking`, `configured-purchase`, `quote`, `subscription`, `reservation`, `verified-other`
  - nullable during expand; read adapter derives `quote` when `quoteRequired`, otherwise derives from the linked storefront CTA until reconciled
- `CatalogBundleComponent`
  - organization-preserving parent and component `CatalogItem` relations
  - quantity
  - standalone eligibility (`standalone-and-bundle`, `bundle-only`)
  - price allocation mode (`percentage`, `equal`, `unallocated`)
  - optional allocation percentage
  - effective dates, ordering, and source provenance
- `CatalogPriceList`
  - organization, key/name, currency, status, effective dates, provenance
- `CatalogPriceListEntry`
  - price-list plus exact `CatalogItem` and optional `CatalogSku`
  - amount/type, minimum quantity, effective dates, provenance
- `CatalogPromotion`
  - organization, key/name, status, adjustment type/value, effective dates, provenance
- `CatalogPromotionItem`
  - promotion plus target `CatalogItem`; optional price-list scope
- `CatalogChannelEligibility`
  - catalog item, channel key, eligibility state, effective dates, provenance
  - a storefront projection remains the publishing record; eligibility does not publish by itself
- `ProductConfiguration`
  - continue using `specification` for typed options/constraints
  - add nullable immutable promotion provenance (`promotedFromQuoteLineItemId`, `promotionSnapshot`, `promotedAt`)
- `QuoteLineItem.catalogSkuId String?`
  - exact reusable selection when present
  - `configurationSnapshot` remains the immutable one-off/historical package snapshot

All organization-crossing relations use composite organization-preserving keys where the target supports them. New-table constraints are data-safe because no legacy rows exist in those tables. Existing-table columns are nullable. Any later `NOT NULL`, check, or uniqueness tightening is a separate contract release.

## Refactoring allocation (approximately 20%)

Reserve one implementation slice in five for:

1. Move CTA and price-type registries out of `ItemFormDialog.tsx` into a shared catalog contract.
2. Establish one `CatalogBuilderClient` boundary so routes, boot reconciliation, tests, and future MCP tools do not duplicate Prisma query shapes.
3. Extend the Phase 2 catalog-first storefront projector rather than adding a second read adapter.
4. Centralize commercial-selection snapshots and bundle attribution calculations as pure functions.
5. Replace hardcoded CTA badge colors with semantic theme tokens.
6. Add schema, registry, organization-boundary, route-derivation, allocation-total, and no-implicit-SKU invariant tests.

## TDD implementation sequence

### 1. Red: fixed contracts and schema invariants

Add failing tests for:

- the seven fulfillment routes and exact registry values;
- normalized models/relations and nullable expand columns;
- exact quote-line SKU trace;
- no commercial packaging relation to `DigitalProduct`;
- organization-preserving bundle and price relations;
- migration-safety classification.

Then add the Prisma schema and `20260728170000_add_catalog_builder_packaging` migration. The migration is expand-only: create new tables/indexes/foreign keys and add nullable columns. Include `@migration-safety` attestations for new-table constraints and no destructive backfill.

### 2. Red: canonical Catalog Builder domain

Create `apps/web/lib/products/catalog-builder.test.ts` before `catalog-builder.ts`. Cover:

- derived fulfillment route from quote requirement/storefront CTA;
- active price-list and promotion resolution by `asOf`, channel, item, and exact SKU;
- rejected inverted validity windows;
- bundle component organization and self-reference checks;
- percentage allocation must total 100 when explicitly complete;
- equal allocation remains deterministic;
- one package sale total with non-additive component attribution;
- immutable commercial selection snapshots;
- explicit, idempotent promotion of one-off configuration to reusable configuration/SKU;
- no reusable row created by quoting alone;
- fixed-price/direct and booking routes bypass quote;
- quote/configured routes retain existing Quote/SalesOrder path.

Implement the smallest domain service and typed `CatalogBuilderClient` that makes each red test green.

### 3. Red: compatibility and API behavior

Extend Phase 2 tests and add route/service tests for:

- existing one-to-one items continue to create/update through the collapsed chain;
- CTA type maps to fulfillment route without exposing the advanced editor;
- linked Storefront reads canonical price and route;
- unlinked legacy rows remain visible and do not fabricate catalog packaging;
- bundle/price/promotion/configuration writes are atomic and organization-scoped;
- exact SKU or snapshot flows into existing quote creation;
- invalid cross-organization component/SKU references fail before a write.

Add thin authenticated APIs under `/api/storefront/admin/catalog/[catalogItemId]` that call the canonical service.

### 4. Red: progressively disclosed owner UX

Add component/route tests before UI:

- ordinary one-line item list and dialog show no bundle/SKU/price-list jargon;
- a linked saved item offers “Manage packaging and sales options” contextually;
- advanced route renders honest empty guidance instead of zero metrics;
- bundle rows identify source product/item, quantity, eligibility, and allocation;
- promotions show validity and do not masquerade as products;
- fixed/booking items do not show quote as a required step;
- configured/quote items explain the next transaction route;
- keyboard labels, focus, mobile wrapping, and semantic theme tokens remain intact.

Implement the contextual page and focused editor components. Do not add global navigation, a new dashboard, or a second product Commercial home.

### 5. Fixtures, documentation, and refactor pass

Add reusable test fixtures for:

- salon: haircut + shave seasonal special;
- restaurant: full dinner experience versus à la carte items;
- hotel: room plus conference/event package;
- automotive: car plus loan plus insurance, including off-the-lot SKU and one-off configured purchase.

Update:

- `docs/user-guide/products/` for products versus ways-to-buy;
- `docs/user-guide/storefront/` for packaging, prices, promotions, routes, and simple/advanced disclosure;
- `docs/architecture/business-commercial-catalog.md`;
- `docs/architecture/ai-coworker-development-principles.md`;
- setup guidance if CTA-derived fulfillment changes operator expectations;
- data-governance classifications and generated documentation index.

Run the reserved refactor pass and rerun every affected test after it.

## Migration and fleet safety

1. Phase 3 remains stacked on the pushed Phase 2 head until Phase 2 merges.
2. Create only additive tables, indexes, and nullable existing-table columns.
3. Do not infer packages, promotions, reusable configurations, SKUs, consumers, or subscribers from legacy names.
4. Route derivation is a compatibility read first. A boot reconciliation may write only deterministic mappings:
   - `quoteRequired=true` or `priceType=quote` → `quote`
   - storefront CTA `booking` → `booking`
   - `purchase` → `direct-purchase`
   - `rental` → `reservation`
   - unknown/inquiry without quote evidence stays null/compatibility-derived
5. Do not modify committed Phase 1 or Phase 2 migrations.
6. Apply the complete Phase 2→3 chain to both a clean database and the integrated representative-data sandbox.
7. Contract/tightening work is explicitly out of this branch.

## Source verification

Before push:

- targeted Vitest suites for catalog contracts, domain service, storefront adapters/APIs/components, quote integration, data governance, and schema invariants;
- `pnpm --filter @dpf/db exec prisma generate`;
- `pnpm --filter @dpf/db typecheck`;
- direct web TypeScript check when the worktree dependency harness supports it, otherwise the established external runner plus integrated sandbox build;
- migration-safety guard;
- staged secret scan;
- DCO commit check;
- overlap sweep against `origin/main` and open PRs.

The worktree is classified `source-only (node_modules_missing)`. Use the established external Vitest runner for source tests and do not report an unrun local build as passed.

## Integrated scarce-sandbox phase gate

Do not lease the shared sandbox for Phase 3 alone. After all child BI branches in the product-management train are source-complete:

1. Assemble the dependency train in an isolated integration ref.
2. Claim `local-integration-ci`.
3. Run `node scripts/sandbox-freshness-preflight.mjs --converge`.
4. Record branch/SHA, lease, freshness verdict, and resolved dependency versions.
5. Apply the Phase 2→remaining-phase migrations to representative existing data.
6. Run affected unit suites and `pnpm --filter web build`.
7. Exercise the setup/catalog/purchase flows for:
   - simple one-line business;
   - salon services plus retail goods;
   - hotel rooms plus conferences/events;
   - restaurant dining plus private events;
   - Phase 3 automotive configured/off-the-lot fixture.
8. Verify fixed-price and booking paths bypass quote, configured/quote paths use existing quote/order, one-off selections do not create reusable SKUs, and package revenue is counted once.
9. Capture screenshots/receipts and attach typed evidence to every affected BI and capsule.

## Rollback

- Before merge: revert the Phase 3 commit(s); Phase 2 behavior remains intact.
- After deployment but before data use: revert application reads/writes while leaving additive tables/nullable columns dormant.
- After Phase 3 data exists: do not drop or rewrite the migration. Disable advanced writes, preserve rows, and ship a forward corrective migration/service fix.
- Storefront compatibility reads continue to serve existing rows throughout rollback.

## Definition of done

- Every acceptance criterion on `BI-83C7D9EE` has a named automated or runtime receipt.
- Architecture and UX guardrails above are implemented.
- Required docs and data-governance records are current.
- Source verification is green.
- Integrated migration, production build, and owner UX evidence are green.
- The branch is DCO-signed and pushed.
- A regular ready-for-review PR is open only after gates pass.
- `pnpm pr:health <number>` reports all checks terminal/passing, mergeable, and zero unresolved threads.
- The PR enters the merge queue in dependency order.
- `BI-83C7D9EE` is marked done only with fresh test, build, migration, UX, source, and documentation evidence.
