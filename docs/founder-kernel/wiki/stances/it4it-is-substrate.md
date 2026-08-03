---
title: IT4IT is the substrate — a hub of frameworks, not a competitor
pageKind: stance
status: published
abstract: The IT4IT Reference Architecture integrates ITIL, COBIT, TOGAF, DevOps, and SAFe at the operating-model layer — it does not replace them. This is why DPF's own lifecycle, teams, and coworker routing are organised around the seven value streams described by the IT4IT Reference Architecture rather than a home-grown process model.
sources:
  - articles/briefings-direct-it4it-2019
  - articles/open-group-2017-managing-business-of-it
  - frameworks/it4it-v3
  - papers/shift-to-digital-product-w205
---

## The position

`[[entities/it4it]]` is not a framework that competes with ITIL, COBIT, TOGAF, DevOps, or SAFe. It is **the substrate that integrates all of them at the operating-model layer**. A hub of frameworks, designed as one architecture.

This positioning matters because every framework conversation tends to devolve into framework-vs-framework debate. IT4IT short-circuits that: ITIL owns service operations; COBIT owns governance; TOGAF owns the modeling vocabulary; DevOps and SAFe own delivery; IT4IT owns the integration between them.

This is not an abstract framework preference — it is the operating-model spine DPF is built on. DPF does not invent a bespoke lifecycle; it adopts IT4IT&#39;s seven `[[entities/value-stream]]` flows as the canonical shape that every product, team, and coworker keys off. The stance below is why the platform has that shape.

## Why

I&#39;ve worked with IT4IT since the forum&#39;s 2014 inception (100+ engagements since 2013). Every successful adoption I&#39;ve seen starts with the same insight: the customer already has ITIL, already has some flavour of COBIT, often has TOGAF, and increasingly has DevOps and SAFe. The question isn&#39;t "which framework wins?" — it&#39;s "how do they coexist without contradicting each other?"

IT4IT&#39;s seven value streams (Evaluate, Explore, Integrate, Deploy, Release, Operate, Consume) are the seam where the other frameworks plug in. ITIL processes attach to Operate. DevOps practices attach to Integrate/Deploy/Release. TOGAF models attach to Explore. COBIT controls thread through all seven. Adopt the substrate and the framework-vs-framework fight simply stops — each one keeps its job and attaches where it belongs.

## How DPF uses it

The "substrate" claim is not rhetorical in DPF — it is wired into the data model. The platform keys off the seven canonical value-stream slugs (`evaluate`, `explore`, `integrate`, `deploy`, `release`, `operate`, `consume`) everywhere a flow appears:

- **Teams and gates are value-stream-shaped.** Value-stream teams, their roles, and their human-in-the-loop gates are first-class rows, not tags bolted onto a generic project object.
- **Coworkers route by value stream.** A coworker tags each unit of work with the value stream it belongs to, so the platform can reason about — and report on — activity by flow rather than by ticket.
- **Capabilities and portfolios crosswalk to the seven streams.** Business-capability perspectives and the IT4IT crosswalk map onto the same slugs, so a `[[entities/digital-product]]` can be read by its value-stream coverage.

Because the spine is IT4IT rather than a DPF invention, a company adopting DPF is never asked to abandon the frameworks it already runs. ITIL keeps working and attaches at Operate; TOGAF keeps working and attaches at Explore. That is `[[stances/contextualize-dont-transform]]` applied to the platform itself: DPF gives the customer the integrating substrate they were missing, not a rival framework to migrate onto.

## When this applies

- Any conversation that&#39;s starting to turn into framework-vs-framework.
- Designing or extending a DPF surface that touches lifecycle, team structure, or work routing — reach for the seven value streams, not a new bespoke process model.
- Standards-adoption decisions where the question is "which standard do we pick?"
- Onboarding a company that already runs ITIL or TOGAF onto DPF — position DPF as the substrate their frameworks plug into.

## When it doesn&#39;t

- Pure ITIL or pure TOGAF shops with no cross-framework reconciliation problem. They don&#39;t need a substrate; they have one framework working.
- Greenfield startups where there&#39;s no installed framework base yet. IT4IT can be the starting point, but so can many things.

## Heuristics derived from this stance

- `[[heuristics/contextualize-before-transforming]]` — map IT4IT onto current operations, don&#39;t flip the operating model.
- `[[heuristics/pitch-simple-adjust-per-audience]]` — how to frame IT4IT (or DPF) for the audience in front of you.
- `[[heuristics/find-at-least-one-champion]]` — adoption needs an evangelist.

## See also

- Entity: `[[entities/it4it]]`
- Entity: `[[entities/value-stream]]`
- Stance: `[[stances/digital-product-is-the-unit-of-organization]]` — the spine operates on Digital Products.
- Raw source: `[raw-sources/articles/briefings-direct-it4it-2019](../../raw-sources/articles/briefings-direct-it4it-2019.md)`
