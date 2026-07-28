# Product Sold traceability implementation plan (`BI-574638B7`)

> **For agentic workers:** execute this plan as one independently reviewable backlog item — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, preserve every existing transaction authority behind an adapter, use the integrated product-management train for runtime gates, and use `dpf-pr-with-dco` for handoff.

**Epic:** `EP-ED496EB0`
**Backlog item:** `BI-574638B7`
**Dependency:** `BI-83C7D9EE` (`feat/catalog-builder`)
**Work capsule:** `WC-5CAB84A0`
**Branch:** `feat/product-sold-traceability`
**Worktree:** `D:\DPF-worktrees\product-sold-traceability`
**Design:** `docs/superpowers/specs/2026-07-27-product-management-operating-loop-design.md`

## Outcome

Create an immutable, organization-scoped commercial sale ledger that can answer what was sold, by which provider, from which Product/Offering/CatalogItem and optional SKU/configuration, at what effective price or promotion, through which real transaction line, and—only when evidence exists—to which account, consumer, subscriber entitlement, or fulfillment instance.

The ordinary owner experience remains “Customer purchases and use.” A simple one-line business defaults the organization as provider and sees only real purchases and fulfillment. Enterprise identity, entitlement, installation, package allocation, and evidence details remain progressively disclosed.

This branch does not turn `DigitalProduct` into a business product, broaden the support-specific `Subscription` model, create customer identities from email strings, fabricate subscribers or consumers, add Product Direction/intelligence/demand/objectives/roadmaps, or implement the umbrella `BI-5C5FA641`.

## Backlog coverage

- Decision: `atomic`
- Coverage receipt: `cms50s0zr022r01mx5ff7uqwk`
- Parent BI: `BI-574638B7`
- External dependency: `BI-83C7D9EE`
- Rationale: the sale ledger, normalized transaction-line evidence, materialization adapters, trace query boundary, contextual UX, and lifecycle/reporting invariants form one safe capability. A ledger without reliable writers is empty substrate; writers without an immutable ledger or duplicate guards are unsafe; and a trace UI without the canonical query boundary would create a competing authority.
- Internal deliverables:
  - `product-sold-ledger-schema`
  - `transaction-evidence-adapters` → `product-sold-ledger-schema`
  - `product-sold-trace-query` → `transaction-evidence-adapters`
  - `contextual-purchase-consumption-ux` → `product-sold-trace-query`
  - `lifecycle-reporting-invariants` → `transaction-evidence-adapters`

## Verified starting point

- Phase 1 supplies the organization-owned `ProductLine` → `Product` hierarchy; `DigitalProduct` remains digital-product architecture.
- Phase 2 supplies `ProductOffering.providerOrganizationId`, canonical `CatalogItem`, optional reusable `ProductConfiguration` and `CatalogSku`, plus storefront and quote compatibility links.
- Phase 3 supplies effective price lists, promotions, bundle components, channel eligibility, fulfillment routes, exact quote-line SKU selection, immutable one-off configuration snapshots, and non-additive package attribution.
- `StorefrontOrder` stores line selections only in `items Json`; it has no normalized line model. That cannot provide an exact, referentially safe transaction-line boundary.
- `QuoteLineItem` is normalized and may point to `CatalogItem`, `CatalogSku`, and a configuration snapshot. `SalesOrder` is the accepted-quote transaction root and has no duplicate line table.
- `StorefrontBooking` and `RentalAgreement` are existing booking/rental authorities. Their customer email/name snapshots are transaction evidence, not canonical consumer identities.
- `Subscription` is explicitly the support/hosting contract for a customer's DPF instance. It remains narrow; general recurring business sales do not become this model.
- No `ProductSold`, general entitlement, installed-product, or cross-archetype consumption ledger exists in the stacked source.
- Live data audited on 2026-07-28 contains one `CustomerAccount`, zero `CustomerContact`, one `QuoteLineItem`, 12 `StorefrontBooking`, zero `StorefrontOrder`, zero `SalesOrder`, zero `Subscription`, zero `RentalAgreement`, and zero `RentableUnit` rows.
- The 12 live bookings all carry customer email evidence but no `customerContactId`. The implementation must retain those evidence snapshots and leave the canonical consumer unknown.
- Live booking `itemId` values mix semantic fixture IDs and a database ID. No legacy ProductSold row may be fabricated unless the entire catalog/transaction mapping is deterministic.

## Standards correction and boundary

Current official ServiceNow documentation now describes **Sold Product**, Install Base Item, Installed Product, Account, Contact, Consumer, and entitlement concepts in its CRM/CSM product model:

- [CRM product data](https://www.servicenow.com/docs/r/customer-relationship-management/crm-product-data.html)
- [Customer Service Management use-case tables](https://www.servicenow.com/docs/r/customer-service-management/csm-use-case-tables.html?contentId=nHXo6WXU9uxflhZZoVLPgw)
- [Configure CSM products](https://www.servicenow.com/docs/r/customer-service-management/configure-csm-products.html?contentId=kLu_XbHWYGw7IxxZKBImlg)
- [Create an install base item](https://www.servicenow.com/docs/r/customer-service-management/create-install-base-item.html)

Therefore the parent design's statement that current CSDM does not supply Product Sold is too broad. Phase 4 documents DPF `ProductSold` as a **DPF commercial-ledger extension informed by current CSM/CSDM-adjacent concepts**, with stronger cross-archetype catalog, transaction-line, historical-snapshot, and non-double-counting semantics. It does not claim that the exact DPF contract is part of CSDM.

The [Open Group IT4IT Standard 3.0.1](https://publications.opengroup.org/c24a) remains focused on digital products and digital-product lifecycle. That supports keeping WWMD and `DigitalProduct` focused on digital architecture while “Goods and Services for Sale” owns the business commercial hierarchy and ledger.

## Governed option decision

WWMD decision `DI-427419F4AD2D` recommends `normalized-sale-ledger` with high confidence (composite `5.8316`, margin `2.1137`):

1. **Chosen — normalized immutable sale ledger.** Add one `ProductSold` root plus typed evidence, party, entitlement, fulfillment-instance, and component-allocation records. Materialize only from real transaction evidence through idempotent adapters.
2. **Rejected — derived projection only.** Existing sources do not preserve a stable historic product/offering/price/configuration/provider snapshot and cannot offer one canonical duplicate-safe reporting boundary.
3. **Rejected — one wide nullable sale row.** It conflates transaction evidence, parties, entitlements, instances, and allocations; makes multi-evidence lifecycle evolution brittle; and encourages placeholder values.

The strongest decision contributors were Never Assume—Verify, Research and Use Standards, Architecture Over Shortcuts, and Single Source of Truth. The outcome was recorded on the BI activity timeline.

## Architecture review (advisory)

- **Decision:** `fits-with-guardrails`
- **Authority:** `ProductSold` is the immutable commercial sale fact. Existing quote/order/booking/rental/subscription records remain transaction or fulfillment authorities and write through idempotent adapters.
- **Provider boundary:** every sale snapshots `providerOrganizationId` from the selected offering. For the simple-business path, Phase 1/2 already defaults that provider to the organization. No team, business unit, or employee provider is invented.
- **Consumer boundary:** account/contact/subscriber roles exist only as optional party links backed by canonical rows and source evidence. Email/name/phone remain evidence snapshots when no canonical party exists.
- **Transaction line:** add `StorefrontOrderLineItem`; do not query `StorefrontOrder.items` as the future reporting authority. New orders dual-write normalized lines and the legacy JSON compatibility payload. Existing JSON may be reconciled only when catalog identity and amounts are deterministic.
- **Quote path:** accepted quote lines remain the exact commercial lines. Do not create a duplicate SalesOrder line authority.
- **Subscription boundary:** a real support `Subscription` may be linked as later evidence/entitlement, but ProductSold never requires one and never creates one for an ordinary good, booking, event, rental, or one-time service.
- **Historical stability:** snapshot names, provider, configuration, effective price/promotion, currency, and commercial terms at materialization. Later catalog edits do not rewrite the sale fact.
- **Lifecycle:** purchase, cancellation/refund, fulfillment, entitlement, and consumption state changes append or update their owned lifecycle record through idempotent transition functions; they do not erase transaction evidence.
- **Reporting:** sale amount is additive exactly once at the ProductSold root. Component allocations are explicitly non-additive explanatory projections.
- **Organization isolation:** all new relations preserve organization in composite keys where possible, and every command/query begins with authorized organization scope.
- **Data classification:** the sale root and non-additive component allocations are internal business data; transaction lines, evidence, party links, entitlements, and fulfillment traces are confidential because they carry or point to customer activity.
- **Compatibility:** legacy unlinked transactions remain visible in their owning screens but do not produce guessed ProductSold rows.
- **Migration posture:** expand-only tables and nullable source columns, deterministic dual-write, no destructive backfill, and no new required constraint on an uncertain legacy value.
- **Recommended next step:** proceed red-first with schema and invariant tests, then materialization adapters.

## UX fit review

- **Decision:** `fits-with-guardrails`
- **Owner language:** “Customer purchases and use,” “Purchase,” “Customer/account,” “Fulfillment,” and “What was selected.” Avoid exposing CSDM, install-base, entitlement, SKU, or subscriber jargon until the record actually uses it and the operator expands details.
- **Canonical homes:** contextual drill-down from existing product Commercial context and existing order/booking/rental detail. No global navigation entry and no parallel sales dashboard.
- **Simple path:** a one-line owner sees purchase, amount/status, customer evidence if present, and fulfillment status. Empty state explains that traces appear after a catalog-linked purchase or booking.
- **Progressive disclosure:** “More traceability” reveals provider, Product/Offering/CatalogItem, SKU/configuration, price/promotion evidence, entitlement, instance, and package allocation.
- **Honest unknown:** an email-only booking displays the captured customer name/email as transaction evidence and labels the canonical customer/account link as not established. It never says “consumer created.”
- **Package display:** show one charged package amount followed by “included items (allocation, not additional revenue).”
- **Reuse:** existing Storefront/product page shells, detail sheets, mutation states, report-kit tables, semantic theme tokens, and authorization boundaries.
- **Failure behavior:** partial or conflicting evidence produces a recoverable “trace needs review” state with source references; it does not silently select a customer or catalog item.
- **AI boundary:** viewing or writing a trace does not invoke AI. Later coworkers consume only the canonical authorized query boundary.
- **Evidence before merge:** component/route tests, keyboard and label checks, theme scan, mobile/desktop browser exercise, and the required cross-archetype scenarios.

## Data contract

Final field names may be mechanically adjusted to Prisma conventions, but ownership and invariants are fixed.

### `ProductSold`

- organization and stable semantic `productSoldId`
- snapshotted `providerOrganizationId`
- required canonical `Product`, `ProductOffering`, and `CatalogItem`
- optional exact `CatalogSku` and reusable `ProductConfiguration`
- sale lifecycle/status and `purchasedAt`
- quantity, amount, currency, unit-price/discount/tax/total snapshot
- optional effective price-list entry and promotion references plus immutable pricing snapshot
- immutable product/offering/catalog/configuration/provider snapshot
- source provenance, creation/update timestamps
- organization-preserving unique keys and indexes

The root is one additive commercial fact. It is not an installed asset, subscription, entitlement, account, consumer, or fulfillment record.

### `StorefrontOrderLineItem`

- organization-preserving link to `StorefrontOrder`
- exact `CatalogItem`, optional `CatalogSku`, and immutable configuration/pricing snapshots
- quantity and monetary fields
- stable line key/idempotency identity
- compatibility payload position/source metadata

New Storefront orders dual-write these rows and the existing `items Json`. Reads prefer normalized lines when present and fall back to legacy JSON without claiming canonical traceability.

### `ProductSoldEvidence`

- organization and `ProductSold`
- evidence kind and observed time
- one typed source link per row: quote line, SalesOrder, storefront order line, booking, rental agreement, or support subscription
- immutable evidence snapshot and source provenance
- uniqueness that prevents the same source line/event from materializing a second sale

Evidence can accumulate as a transaction moves from selection to fulfillment. A generic string source is not accepted where a typed local authority exists.

### `ProductSoldParty`

- organization and `ProductSold`
- role: account, consumer, or subscriber
- exactly one canonical `CustomerAccount` or `CustomerContact` when applicable
- supporting evidence id/kind, observed time, and immutable display snapshot
- no row when only an unverified email/name exists

Roles are intentionally distinct. An account does not automatically become a consumer or subscriber.

### `ProductSoldEntitlement`

- organization and `ProductSold`
- optional evidence-backed account/contact beneficiary
- optional support `Subscription` link only when that real contract exists
- entitlement kind, quantity/rights snapshot, validity window, and lifecycle status
- source evidence/provenance

No entitlement is created merely because a sale exists.

### `ProductFulfillmentInstance`

- organization and `ProductSold`
- instance kind and lifecycle
- typed optional booking, rentable-unit/rental-agreement, or EdgeNode evidence where those authorities exist
- stable external/source reference only for verified integrations
- started/completed/ended timestamps and immutable fulfillment snapshot

A one-time completed service may have a fulfillment record without an installed asset. A physical good may be fulfilled without a subscription. A subscription may exist without an EdgeNode.

### `ProductSoldComponentAllocation`

- organization and `ProductSold`
- exact component `CatalogItem`
- quantity and allocation mode
- optional allocated amount/percentage and immutable bundle snapshot
- explicitly non-additive reporting semantics

## Refactoring allocation (approximately 20%)

Reserve one implementation slice in five for:

1. Introduce one `ProductSoldRepository`/query boundary shared by routes, future Product Direction, reports, and coworkers.
2. Centralize idempotent materialization and lifecycle transitions instead of embedding Prisma writes in storefront, CRM, booking, or rental routes.
3. Add a compatibility adapter for legacy `StorefrontOrder.items`; do not duplicate JSON parsing across readers.
4. Centralize canonical party-evidence resolution with explicit `resolved`/`unknown` outcomes.
5. Replace duplicated transaction-source and status mapping rules with typed registries and pure functions.
6. Add invariant tests for organization preservation, exact-one typed evidence source, no-placeholder parties, historical snapshots, duplicate prevention, and non-additive allocation.
7. Correct the parent design and affected architecture/coworker documentation to reflect current ServiceNow terminology and the exact DPF extension boundary.

## TDD implementation sequence

### 1. Red: schema and migration invariants

Add failing tests for:

- normalized ProductSold/evidence/party/entitlement/fulfillment/allocation models;
- normalized Storefront order lines and deterministic compatibility fields;
- required Product/Offering/CatalogItem and snapshotted provider boundary;
- optional SKU/configuration/party/entitlement/instance links;
- organization-preserving composite relations;
- uniqueness preventing duplicate sale materialization from one transaction line;
- no relation that makes `DigitalProduct` the business Product Sold authority;
- additive/nullable expand migration classification.

Then add the Prisma schema and migration. Use new tables, nullable source columns, indexes, and deterministic data-safe backfills only. Do not tighten uncertain legacy data.

### 2. Red: immutable materialization domain

Create tests before the domain service for:

- direct storefront order line → one ProductSold;
- accepted quote line/SalesOrder → one ProductSold without a duplicate SalesOrder line table;
- booking, completed service, rental, physical good, configured good, package, and support-subscription evidence;
- organization default provider from the snapshotted ProductOffering;
- exact price-list/promotion/configuration selection snapshot;
- repeat invocation returns the same sale;
- a different source line creates a distinct sale;
- email-only evidence leaves party links empty;
- canonical account/contact evidence creates only justified roles;
- ordinary goods/services never create a support Subscription or entitlement;
- later catalog/provider edits do not change historical snapshots;
- cancellation/refund/fulfillment transitions preserve evidence history.

Implement pure normalization functions and one transaction-safe writer boundary until each test is green.

### 3. Red: transaction adapters and compatibility

Extend existing source tests before code:

- `createStorefrontOrder` dual-writes normalized lines atomically while retaining legacy JSON;
- accepted quote/SalesOrder materializes from exact quote lines;
- booking creation/completion adds evidence only when the booking maps deterministically to a canonical CatalogItem;
- rental reservation/checkout/return links the real agreement and unit when available;
- support-subscription conversion links evidence without changing ProductSold identity;
- retries and webhook replays do not duplicate rows;
- cross-organization IDs are rejected before writes;
- legacy unlinked transactions stay visible and produce no guessed trace.

Keep adapters thin and call the canonical materialization service.

### 4. Red: trace query and reporting boundary

Add query tests for:

- organization authorization before lookup;
- product, order, booking, rental, account, and customer-context trace retrieval;
- honest unknown party state;
- additive sale totals exactly once;
- package component allocations returned separately as non-additive;
- effective historical names/price/configuration from snapshots;
- fixed service, subscription, physical good, configurable good, and bundle shapes;
- stable `asOf`, canonical IDs, evidence kinds, and source references.

Implement a typed read model consumed by UI and future operating-context work.

### 5. Red: progressively disclosed UX

Add route/component tests before UI:

- ordinary purchase summary contains no enterprise jargon;
- evidence-only customer data is not presented as a canonical consumer;
- expanded trace shows provider → Product → Offering → CatalogItem → optional selection → transaction → optional party/entitlement/instance;
- package totals and allocations cannot be visually added twice;
- empty/unlinked states are useful and honest;
- authorization, loading, failure, mobile wrapping, keyboard labels, and semantic theme tokens are correct.

Implement contextual drill-down in existing product and transaction homes without adding global navigation.

### 6. Fixtures, documentation, and refactor pass

Add reusable fixtures for:

- simple one-line service with no canonical customer;
- salon services plus retail goods;
- hotel room plus conference/event package;
- restaurant dining plus private event;
- configured physical good and reusable SKU;
- real support subscription with an optional installed EdgeNode.

Update:

- `docs/user-guide/products/` for purchases, use, evidence, and honest unknowns;
- `docs/user-guide/storefront/` for normalized order trace and package totals;
- `docs/architecture/business-commercial-catalog.md`;
- the parent product-management design's standards boundary;
- setup guidance where deterministic catalog links affect later traceability;
- AI-coworker development guidance for canonical query use and no fabricated parties;
- data-governance classifications and generated documentation indexes.

Run the reserved refactor pass and rerun all affected tests.

## Migration and fleet safety

1. Phase 4 remains stacked on the pushed Phase 3 head until earlier phases merge.
2. Create additive tables, indexes, and nullable compatibility columns first.
3. Preserve `StorefrontOrder.items`; dual-write new normalized lines and prefer normalized reads.
4. Backfill an existing order's organization from its Storefront only if the relation is deterministic.
5. Do not parse legacy JSON into ProductSold unless exact CatalogItem identity, quantity, amount, currency, and line identity can all be proven. The default is no backfill.
6. Do not infer CustomerContact/CustomerAccount from matching email text.
7. Do not infer Product, Offering, SKU, configuration, subscriber, entitlement, installed instance, provider team, or business unit.
8. Any exact typed foreign-key/check/uniqueness constraint on a new table carries a data-safe attestation because no prior rows exist.
9. Do not modify committed Phase 1–3 migrations.
10. Apply the complete Phase 2→4 migration chain to a clean database and representative existing-data sandbox.
11. Tightening or legacy contraction is a later fleet-convergence release.

## Source verification

Before push:

- targeted Vitest for schema invariants, ProductSold domain/query boundaries, storefront/CRM/booking/rental/subscription adapters, contextual components/routes, reporting, and authorization;
- `pnpm --filter @dpf/db exec prisma validate`;
- `pnpm --filter @dpf/db exec prisma generate`;
- `pnpm --filter @dpf/db typecheck`;
- web TypeScript/build only where the source-only harness can prove it; otherwise reserve the claim for the integrated sandbox;
- migration-safety and stewardship-scope guards;
- documentation index/link checks;
- staged/tree secret scans;
- DCO commit check;
- overlap sweep against current `origin/main` and open PRs.

This worktree is `source-only (node_modules_missing)`. An unrun worktree build is not a passed build.

## Integrated scarce-sandbox phase gate

Do not lease the shared sandbox for Phase 4 alone. After all child BI branches in the product-management train are source-complete:

1. Assemble the dependency train in an isolated integration ref.
2. Claim `local-integration-ci`.
3. Run `node scripts/sandbox-freshness-preflight.mjs --converge`.
4. Record integration SHA, lease, freshness verdict, and resolved Next/React/TypeScript/Prisma versions.
5. Apply the full migration train to representative existing data and to a clean database.
6. Run affected unit suites and `pnpm --filter web build`.
7. Exercise catalog → purchase/booking/quote/rental → Product Sold → optional party/entitlement/instance traces for:
   - simple one-line business;
   - salon services plus retail goods;
   - hotel rooms plus conferences/events;
   - restaurant dining plus private events;
   - configured/reusable-SKU physical good;
   - support subscription plus installed instance.
8. Prove no fabricated identities, provider teams, subscribers, entitlements, or instances.
9. Prove package revenue totals once and allocations remain non-additive.
10. Capture screenshots/receipts and attach typed evidence to every affected BI and capsule.

## Rollback

- Before merge: revert Phase 4 commits; Phase 3 catalog behavior remains intact.
- After deployment before ProductSold data use: disable adapter writes and contextual reads while leaving additive tables dormant.
- After ProductSold data exists: do not drop or rewrite the migration. Stop affected adapters, preserve ledger/evidence rows, and ship a forward corrective migration/service fix.
- Legacy transaction screens and JSON compatibility reads remain available throughout rollback.

## Definition of done

- Every acceptance criterion on `BI-574638B7` has a named automated or runtime receipt.
- Current standards language and the exact DPF extension boundary are documented.
- Architecture and UX guardrails above are implemented.
- No placeholder provider, team, business unit, account, consumer, subscriber, entitlement, or instance is created.
- ProductSold history remains stable after catalog/provider changes.
- Reporting counts root sales once and component allocations separately.
- Source verification is green.
- Integrated migration, production build, and owner UX evidence are green.
- The branch is DCO-signed and pushed.
- A regular ready-for-review PR opens only after gates pass.
- `pnpm pr:health <number>` reports all checks terminal/passing, mergeable, and zero unresolved threads.
- The PR enters the merge queue after Phase 3.
- `BI-574638B7` is marked done only with fresh test, build, migration, UX, source, documentation, and standards evidence.
