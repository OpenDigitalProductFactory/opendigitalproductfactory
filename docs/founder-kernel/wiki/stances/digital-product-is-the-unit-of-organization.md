---
title: Digital Product is the unit of organization for IT
pageKind: stance
status: published
abstract: Anything that runs code that one party is responsible for that delivers outcomes for a consumer party. That's the right primitive — for portfolio, team, funding, lifecycle, governance, everything.
sources:
  - articles/why-product-centric-approach-needed
  - articles/why-product-centricity-critical
  - papers/shift-to-digital-product-w205
---

## The position

A `[[entities/digital-product]]` is **anything that runs code that one party is responsible for that delivers outcomes for a consumer party**. That definition is the right primitive for organising IT. Portfolio strategy, team structure, investment, lifecycle, governance, EA, ITSM — all of it should reduce to Digital Product.

This isn&#39;t a refinement of the application-centric or service-centric models. It is a replacement for both. Application and service are facets of the same underlying thing; treating them as separate management surfaces is what produces the structural pain Dev and Ops keep blaming on each other.

## Why

I&#39;ve been watching IT misalign with business outcomes for 25 years across Dell, Troux, HPE, and ServiceNow. The misalignments are always the same shape: ITSM optimises for tickets, project management optimises for completion, APM optimises for application inventory, SPM optimises for service availability. None of those measure whether the consumer got the outcome they were promised.

A product-centric model fixes the misalignment by **defining consumers and providers explicitly for every system**. Once you do that, every other framework — IT4IT, ITIL, ArchiMate, CSDM — reorganises around the same anchor and stops contradicting itself.

The Open Group W205 paper (2020) was the first formal statement. IT4IT v3 (2022) carried it into the standard — the Service Model Backbone became the Digital Product Backbone for exactly this reason. DPROM (2025) carries it into the operating model.

## When this applies

- Setting up a new IT operating model.
- Rationalising overlapping portfolios.
- Funding ops vs. dev work that was previously split.
- Designing a CMDB, an EA model, or a service catalog.
- Building agents and AI co-workers that need a stable target to reason about.

## When it doesn't

- Pure infrastructure projects with no consumer party in the IT sense (cabling, datacenter buildouts, raw network gear). Those are inputs to Digital Products, not Digital Products themselves.
- Pure business processes with no system component. Those are operated by Digital Products but aren&#39;t Digital Products.

## Heuristics derived from this stance

- `[[heuristics/contextualize-before-transforming]]` — map existing portfolios onto Digital Product structure before changing anything.

## See also

- Stance: `[[stances/persistent-product-teams-over-projects]]` — the team-side corollary.
- Stance: `[[stances/it4it-is-substrate]]` — the framework-integration corollary.
- Entity: `[[entities/digital-product]]`
