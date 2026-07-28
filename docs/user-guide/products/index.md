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

## Key Concepts

- **Lifecycle Stage** — Where the product is in its development and operational life: Plan, Design, Build, Production, or Retirement.
- **Status** — The current operational state: Draft (not yet active), Active (in use), or Inactive (paused or decommissioned).
- **Stage-Gate Readiness** — A checklist of criteria that must be met before a product can advance from one lifecycle stage to the next. Gates ensure quality and governance before promotion.
- **Taxonomy Attribution** — Each product is tagged with nodes from the DPPM taxonomy tree, enabling comparison with similar products and portfolio-level filtering.
- **Software Enrichment** — Inventory entity details can show the latest known version, update posture, canonical manufacturer/product identity and CPE, plus sourced support-lifecycle milestones when that enrichment is available.

## What You Can Do

- Confirm the initial business product mix during Storefront setup
- Use the Goods and Services for Sale hierarchy for business-product reporting
- Browse all products with filtering by lifecycle stage, status, portfolio, and taxonomy
- View a product's full profile including its health metrics, linked backlog items, and architecture models
- Inspect available software identity and support-lifecycle facts without leaving the inventory entity detail page
- Check stage-gate readiness and see which criteria are outstanding before the next stage
- Advance a product through lifecycle stages once gate criteria are satisfied
- Register a new product and assign it to a portfolio and taxonomy category

## Reading Product Health

The product health view includes the same capability-aware service summary used by platform monitoring. A disabled optional capability is shown as **Optional — inactive**, not as a false outage. An enabled optional service that cannot be observed is **Optional — degraded**; an unavailable required service is **Required — unavailable**. External AI runtimes are labeled **External — provider managed** and use reconciled provider evidence. These labels and their actions, rather than color alone, explain whether operator attention is required.
