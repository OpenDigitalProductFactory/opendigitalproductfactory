# Business Commercial Catalog

## Authority Boundary

The business commercial catalog belongs to **Goods and Services for Sale**.
It is separate from WWMD and DigitalProduct architecture:

```text
ProductLine → Product → ProductOffering → CatalogItem
                                      ├→ ProductConfiguration → CatalogSku
                                      ├→ StorefrontItem
                                      └→ QuoteLineItem
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
currency, availability policy, quote requirement, and lifecycle status.
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

## Fleet-Safe Evolution

The initial migration is expand-only:

- four new tables;
- nullable Storefront and quote links;
- no destructive backfill or tightened legacy columns;
- organization-preserving composite foreign keys;
- idempotent application reconciliation through the existing setup seed
  authority.

On boot, storefronts with active unlinked items run the same setup
reconciliation. Rows backed by real composition/product-line evidence are
linked. Rows without that evidence remain usable and are reported as
unresolved. A later contract release may remove duplicated legacy fields only
after fleet convergence is measured and compatibility readers are no longer
needed.
