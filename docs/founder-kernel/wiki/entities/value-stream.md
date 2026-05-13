---
title: Value Stream
pageKind: entity
status: published
abstract: One of seven cross-cutting flows in IT4IT v3 — Evaluate, Explore, Integrate, Deploy, Release, Operate, Consume. The seam where ITIL, DevOps, SAFe, and TOGAF plug into the Digital Product spine.
sources:
  - frameworks/it4it-v3
---

## What it is

A Value Stream in `[[entities/it4it]]` v3 is one of **seven cross-cutting flows** that operate on the Digital Product Backbone:

1. **Evaluate** — strategy, portfolio fit, investment justification.
2. **Explore** — design, options, architecture, build-vs-buy.
3. **Integrate** — engineering, composition, build.
4. **Deploy** — release engineering, packaging, environment promotion.
5. **Release** — orchestration into production.
6. **Operate** — run, monitor, incident, change.
7. **Consume** — request, fulfilment, customer-facing experience.

Each value stream owns a distinct contract with the `[[entities/digital-product]]`. ITIL plugs into Operate. DevOps plugs into Integrate / Deploy / Release. TOGAF plugs into Explore. COBIT threads through all seven.

## How DPF uses it

DPF&#39;s lifecycle and routing surfaces are organised around the seven value streams. Portfolio pages categorise products by value-stream coverage. Agent coworkers tag their work by value stream so the platform can report on activity by flow.

The platform uses the canonical slugs `evaluate`, `explore`, `integrate`, `deploy`, `release`, `operate`, `consume` everywhere a value stream appears.

## Relationships

- Defined by: `[[entities/it4it]]`.
- Operates on: `[[entities/digital-product]]`.
- The seam for: ITIL (Operate), DevOps/SAFe (Integrate, Deploy, Release), TOGAF (Explore), COBIT (all).

## Examples

A new analytics application proposal moves Evaluate → Explore → Integrate → Deploy → Release → Operate → Consume across its first eighteen months. The agent surfaces relevant tools, runbooks, and approvals depending on which value stream the work is currently in.

## See also

- Stance: `[[stances/it4it-is-substrate]]`
- Entity: `[[entities/it4it]]`
- Raw source: `[raw-sources/frameworks/it4it-v3](../../raw-sources/frameworks/it4it-v3.md)`
