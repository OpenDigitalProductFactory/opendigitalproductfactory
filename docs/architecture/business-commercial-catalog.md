# Business Commercial Catalog

## Authority Boundary

The business commercial catalog belongs to **Goods and Services for Sale**.
It is separate from WWMD and DigitalProduct architecture:

```text
ProductLine → Product → ProductOffering → CatalogItem
                                      ├→ ProductConfiguration → CatalogSku
                                      ├→ CatalogBundleComponent → CatalogItem
                                      ├→ CatalogPriceListEntry → CatalogPriceList
                                      ├→ CatalogPromotionItem → CatalogPromotion
                                      ├→ CatalogChannelEligibility
                                      ├→ StorefrontItem
                                      ├→ QuoteLineItem → CatalogSku?
                                      └→ ProductSold → typed evidence / party /
                                                       entitlement / fulfillment
```

`ProductLine`, `Product`, `ProductOffering`, `CatalogItem`,
`ProductConfiguration`, and `CatalogSku` are organization-scoped business
records. `DigitalProduct` remains the software/data/platform architecture
record. `ServiceOffering` remains the operational-commitment record for a
DigitalProduct. Its nullable link to `ProductOffering` is a trace, not an
ownership transfer.

The provider is explicit on `ProductOffering`. For a simple business it
defaults to the owning organization. The model does not create a consumer,
subscriber, product team, business unit, or entitlement. Those identities must
come from customer, booking, order, subscription, fulfilment, or other real
evidence.

## Canonical And Projected Fields

`CatalogItem` owns the commercial name, description, price type, amount,
currency, availability policy, quote requirement, fulfillment route, and
lifecycle status.
`StorefrontItem` links to a Catalog item and owns channel presentation:
category, image, call-to-action, booking configuration, visibility, and sort
order.

During the expand release, legacy Storefront fields remain populated and are
dual-written for compatibility. Catalog-first readers use the linked Catalog
item when present and return an explicit `storefront` compatibility source when
it is absent. They never infer a link from similar names.

The common one-to-one Product/default Offering/Catalog item path is managed
through one service boundary and remains collapsed in owner UX. Additional
record detail appears only when archetype capability or actual divergence
requires it.

## Configurations And Quotes

`ProductConfiguration` stores deliberately reusable standard configurations.
`CatalogSku` is optional and identifies a reusable configuration or inventory
identity. A one-off configured sale is instead stored as an immutable JSON
snapshot on `QuoteLineItem` alongside the exact `catalogItemId`. The legacy
`DigitalProduct` quote reference remains nullable during migration.

An operator may deliberately promote a successful one-off quote configuration
to a reusable `ProductConfiguration` and `CatalogSku`. The command records the
source quote line, immutable promotion snapshot, and promotion time. Quoting
alone never creates reusable catalog rows.

When a quote selects an existing SKU, `QuoteLineItem.catalogSkuId` records the
exact selection. The quote service verifies that the SKU belongs to the same
catalog item before writing the line. Quote revisions copy both the SKU
identity and configuration snapshot so commercial history does not drift.

## Packaging, Prices, Promotions, And Routes

Catalog Builder extends a `CatalogItem`; it does not create another Product or
change ProductLine parentage:

- `CatalogBundleComponent` packages existing organization-owned catalog items,
  retaining quantity, standalone eligibility, ordering, and effective dates.
- `CatalogPriceList` and `CatalogPriceListEntry` provide effective-dated prices
  for an item or exact SKU. A SKU-specific price wins over the item default.
- `CatalogPromotion` and `CatalogPromotionItem` apply effective-dated
  percentage, fixed-amount, or fixed-price changes without creating seasonal
  Products.
- `CatalogChannelEligibility` says whether a catalog item may be sold through a
  named channel. It does not publish a `StorefrontItem`.
- `CatalogItem.fulfillmentRoute` selects direct purchase, booking, configured
  purchase, quote, subscription, reservation, or another verified route.

Until `fulfillmentRoute` is written, the compatibility reader derives only
deterministic mappings: quote-required items use `quote`; booking, purchase,
and rental storefront calls to action map to booking, direct purchase, and
reservation. An inquiry without quote evidence stays unresolved.

Bundle revenue remains one commercial sale. Percentage or equal component
allocations are non-additive analysis attributes; they never create a second
revenue ledger. Explicit percentages are bounded from zero through 100 and
must total 100. The canonical signal projection derives component attach rate,
quote conversion, margin, and option demand only from supplied transaction
evidence. It deduplicates selection identifiers and withholds margin whenever
cost evidence is incomplete.

## Product Sold Ledger

`ProductSold` is DPF's immutable, organization-scoped commercial sale fact.
It snapshots the selected provider, Product, Offering, Catalog item, optional
SKU/configuration, and pricing at materialization. Existing `QuoteLineItem`,
`SalesOrder`, `StorefrontOrderLineItem`, `StorefrontBooking`,
`RentalAgreement`, and support `Subscription` models remain their own
transaction or fulfillment authorities; typed `ProductSoldEvidence` rows link
them without creating a parallel order system.

The ledger follows these invariants:

- revenue is additive only at the `ProductSold` root;
- package component allocations are non-additive;
- names, pricing, configuration, and provider history come from immutable
  snapshots rather than the current catalog;
- a party link requires a canonical `CustomerAccount` or `CustomerContact`;
- an entitlement requires a real beneficiary and evidence;
- a fulfillment instance requires a real booking, rental agreement/unit, or
  EdgeNode target;
- ordinary purchases do not create support subscriptions;
- new Storefront orders dual-write normalized lines and retain the legacy JSON
  payload, while unlinked legacy rows remain unmaterialized.

The canonical organization-scoped trace query is
`apps/web/lib/products/product-sold-query.ts`. Contextual product UI and future
reports/coworkers consume that boundary rather than reproducing joins or
guessing identities.

## Product Operating Context Query Boundary

`apps/web/lib/product-management/product-operating-context-query.ts` is the
canonical read boundary for organization, product-line, and business-product
management context. It authorizes the organization once, keeps organization
predicates on every business query, applies bounded stable ordering, and feeds a
pure assembler. Every projected item retains a canonical identifier,
`sourceKind`, and `asOf`; every slice reports whether its data is available,
partial, or unavailable.

The query connects a business Product to an enabling `DigitalProduct` only
through the existing explicit path:

```text
Product
  → ProductOffering.operationalServiceOfferingId
  → ServiceOffering.digitalProductId
  → DigitalProduct
```

It does not add or infer a general Product-to-DigitalProduct association.
Research proposals and marketing battlecards may carry a nullable
`digitalProductId`; null remains the truthful organization-wide scope.
Product-scoped research execution preserves that identifier in the canonical
`WikiPage`/`WikiPageSource` provenance. It does not dual-write a legacy
`KnowledgeArticle`; an article remains an explicit retained snapshot.

Demand, knowledge, change, architecture, and dependency evidence is included
only through the resolved enabling digital products. Product decisions,
objectives, outcomes, and scheduled playbooks remain explicitly unavailable
until their owning phases provide typed associations. Prompt strings, route
text, similar names, and empty result sets are never used to invent scope.

Current ServiceNow CRM/CSM documentation includes Sold Product, installed
product/install-base, party, and entitlement concepts. DPF's `ProductSold` is
therefore described as a DPF commercial-ledger extension informed by those
adjacent concepts—not as a claim that ServiceNow lacks Sold Product, nor as an
exact CSDM entity. IT4IT and DPF `DigitalProduct` remain focused on digital
product architecture and lifecycle.

## Fleet-Safe Evolution

The Phase 2 and Catalog Builder migrations are expand-only:

- additive commercial and packaging tables;
- nullable Storefront, quote, fulfillment-route, and promotion-provenance
  links;
- no destructive backfill or tightened legacy columns;
- organization-preserving composite foreign keys;
- partial unique indexes for nullable default SKU and price-list scopes;
- idempotent application reconciliation through the existing setup seed
  authority.

On boot, storefronts with active unlinked items run the same setup
reconciliation. Rows backed by real composition/product-line evidence are
linked. Rows without that evidence remain usable and are reported as
unresolved. A later contract release may remove duplicated legacy fields only
after fleet convergence is measured and compatibility readers are no longer
needed.
