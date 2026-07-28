---
title: "Product Inventory"
area: products
order: 1
---

## Overview

DPF keeps two related product concepts separate:

- **Business products** are the goods, services, experiences, or access the
  organization sells. They belong to an organization-owned product line under
  **Goods and Services for Sale**. Storefront setup creates the initial
  hierarchy from lines the operator confirms.
- **Digital products** are software, data, platforms, or other digital
  architecture. The Product Inventory is the structured catalogue for these
  digital products. Every digital product has a lifecycle stage, operational
  status, portfolio and taxonomy links, and associated backlog.

A business product may later be traced to digital products that constitute or
augment it, once a real relationship and consuming workflow exist. Setup does
not invent that trace, and it does not turn a salon service, hotel room, meal,
or retail good into a digital product.

## From Product To Something A Customer Can Select

The commercial path is:

`Product line → Product → Offering → Catalog item → Storefront item`

- A **Product** is the durable good, service, experience, or access the
  organization manages.
- An **Offering** is the provider's commercial promise for that Product.
- A **Catalog item** is the exact selectable or requestable thing shared by
  storefront, sales-desk, quote, partner, and future mobile channels.
- A **Storefront item** is the public presentation of that catalog item. Its
  name, description, price, and quote requirement come from the catalog while
  storefront-only presentation such as image, category, call to action, and
  display order remains on the Storefront item.

For the common one-product case, DPF creates and updates the Product, default
Offering, and Catalog item together. Owners keep using **Storefront → Items**;
the underlying record layers are not exposed unless the commercial definition
actually diverges. A one-line business sees no product-line control. When the
confirmed business mix has multiple lines, the add-item form asks which real
line owns the new item. An item labeled **Needs setup link** is an older projection
that lacks real product-line evidence. Finish or reconcile setup rather than
guessing a relationship.

A reusable standard configuration may later receive a SKU. A one-off
configuration selected for a specific quote is captured immutably on that
quote line and does not create permanent catalog or SKU clutter.

## Package And Price A Catalog Item

After an item has a catalog link, open **Storefront → Items** and choose
**Manage packaging and sales options** from that item's actions. The first
control is intentionally simple: confirm how customers complete the purchase.
Ordinary fixed-price purchases and bookings continue directly; a quote is
required only when the selected route says so.

Open **Advanced packaging and sales options** only when the business actually
needs one of these:

- combine existing things you sell into a package;
- divide one package sale across components for non-additive analysis;
- add an effective-dated price or seasonal offer;
- publish a deliberately reusable standard option and SKU;
- promote a successful one-off quoted option into that reusable catalog;
- allow or disallow the catalog item in a sales channel.

Adding a package does not move its components to another product line. A
seasonal offer does not create another Product. New package components begin
with equal revenue attribution; use **Set exact revenue attribution** when the
business has a defensible percentage split. The percentages must total 100,
and the package is still counted as one sale.

For configured goods such as cars or homes, an off-the-lot selection can point
to an exact reusable SKU. A build-to-order selection stays as an immutable
one-off quote or order snapshot unless an operator explicitly promotes it.

## Key Concepts

- **Lifecycle Stage** — Where the product is in its development and operational life: Plan, Design, Build, Production, or Retirement.
- **Status** — The current operational state: Draft (not yet active), Active (in use), or Inactive (paused or decommissioned).
- **Stage-Gate Readiness** — A checklist of criteria that must be met before a product can advance from one lifecycle stage to the next. Gates ensure quality and governance before promotion.
- **Taxonomy Attribution** — Each product is tagged with nodes from the DPPM taxonomy tree, enabling comparison with similar products and portfolio-level filtering.
- **Software Enrichment** — Inventory entity details can show the latest known version, update posture, canonical manufacturer/product identity and CPE, plus sourced support-lifecycle milestones when that enrichment is available.
- **Canonical Inventory Record** — Normal inventory lists, product counts, and
  product inventory tabs show the active canonical record for a discovered
  entity. Superseded records remain retained as governed repair evidence but do
  not appear in normal operational views or inflate their counts. An old direct
  entity link redirects to the canonical record.

## What You Can Do

- Confirm the initial business product mix during Storefront setup
- Use the Goods and Services for Sale hierarchy for business-product reporting
- Edit the common Product, default Offering, and Catalog item through one
  collapsed Storefront item workflow
- Manage optional packages, dated prices, promotions, reusable SKUs, channel
  eligibility, and fulfillment routes without creating parallel products
- Browse all products with filtering by lifecycle stage, status, portfolio, and taxonomy
- View a product's full profile including its health metrics, linked backlog items, and architecture models
- Inspect available software identity and support-lifecycle facts without leaving the inventory entity detail page
- Follow an older inventory-entity link to the canonical record without editing
  a retained superseded copy
- Check stage-gate readiness and see which criteria are outstanding before the next stage
- Advance a product through lifecycle stages once gate criteria are satisfied
- Register a new product and assign it to a portfolio and taxonomy category

## Reading Product Health

The product health view includes the same capability-aware service summary used by platform monitoring. A disabled optional capability is shown as **Optional — inactive**, not as a false outage. An enabled optional service that cannot be observed is **Optional — degraded**; an unavailable required service is **Required — unavailable**. External AI runtimes are labeled **External — provider managed** and use reconciled provider evidence. These labels and their actions, rather than color alone, explain whether operator attention is required.
