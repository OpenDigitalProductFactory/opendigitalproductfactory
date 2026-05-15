---
title: Digital Product
pageKind: entity
status: published
abstract: Anything that runs code that one party is responsible for that delivers outcomes for a consumer party.
sources:
  - articles/why-product-centric-approach-needed
  - articles/why-product-centricity-critical
  - papers/shift-to-digital-product-w205
---

## What it is

A Digital Product is **anything that runs code that one party is responsible for that delivers outcomes for a consumer party**. The simplest possible framing of a 25-year-arc through APM, SPM, IT4IT, and CSDM.

The point of the definition is what it excludes. A Digital Product is not a project (projects end; products persist). It is not a ticket queue (tickets are symptoms; products produce outcomes). It is not an application or a service in isolation (those are facets — the Digital Product is the whole that contains both).

## How DPF uses it

Digital Product is the unit of organization for everything DPF tracks. Portfolios contain Digital Products. Teams own Digital Products. Investment flows to Digital Products. Lifecycle stages apply to Digital Products. EA models, IT4IT value streams, and CSDM data all reduce to Digital Products as the anchor.

The platform&#39;s `DigitalProduct` Prisma model is the canonical row; everything else is a projection of it.

## Relationships

- `[[entities/portfolio]]` — a Portfolio is a curated set of Digital Products.
- `[[entities/it4it]]` — IT4IT v3&#39;s seven value streams operate on Digital Products; the Service Model Backbone was renamed the Digital Product Backbone for this reason.
- `[[entities/csdm]]` — CSDM is the canonical data model; Digital Product is the entity it&#39;s built to describe.
- `[[entities/value-stream]]` — value streams are where Digital Products are evaluated, built, run, and consumed.

## Examples

A SaaS customer portal that engineering owns and the storefront team consumes. A logging stack that platform engineering owns and every application team consumes. A reporting service that data platform owns and finance consumes. None of these is a project; each is a persistent Digital Product with named consumers, named providers, and outcomes that can be measured.

## See also

- Stance: `[[stances/digital-product-is-the-unit-of-organization]]`
- Stance: `[[stances/persistent-product-teams-over-projects]]`
