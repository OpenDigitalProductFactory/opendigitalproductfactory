---
title: "Product Inventory"
area: products
order: 1
---

## Overview

The Product Inventory is a structured catalogue of all digital products in your organization. Every product has a lifecycle stage, an operational status, and links to its portfolio, taxonomy classification, and associated backlog.

## Key Concepts

- **Lifecycle Stage** — Where the product is in its development and operational life: Plan, Design, Build, Production, or Retirement.
- **Status** — The current operational state: Draft (not yet active), Active (in use), or Inactive (paused or decommissioned).
- **Stage-Gate Readiness** — A checklist of criteria that must be met before a product can advance from one lifecycle stage to the next. Gates ensure quality and governance before promotion.
- **Taxonomy Attribution** — Each product is tagged with nodes from the DPPM taxonomy tree, enabling comparison with similar products and portfolio-level filtering.
- **Software Enrichment** — Inventory entity details can show the latest known version, update posture, canonical manufacturer/product identity and CPE, plus sourced support-lifecycle milestones when that enrichment is available.

## What You Can Do

- Browse all products with filtering by lifecycle stage, status, portfolio, and taxonomy
- View a product's full profile including its health metrics, linked backlog items, and architecture models
- Inspect available software identity and support-lifecycle facts without leaving the inventory entity detail page
- Check stage-gate readiness and see which criteria are outstanding before the next stage
- Advance a product through lifecycle stages once gate criteria are satisfied
- Register a new product and assign it to a portfolio and taxonomy category

## Reading Product Health

The product health view includes the same capability-aware service summary used by platform monitoring. A disabled optional capability is shown as **Optional — inactive**, not as a false outage. An enabled optional service that cannot be observed is **Optional — degraded**; an unavailable required service is **Required — unavailable**. External AI runtimes are labeled **External — provider managed** and use reconciled provider evidence. These labels and their actions, rather than color alone, explain whether operator attention is required.
