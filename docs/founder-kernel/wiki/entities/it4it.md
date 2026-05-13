---
title: IT4IT
pageKind: entity
status: published
abstract: The Open Group's reference architecture for managing the business of IT — a hub of seven value streams that integrate ITIL, COBIT, TOGAF, DevOps, and SAFe.
sources:
  - frameworks/it4it-v3
  - articles/briefings-direct-it4it-2019
  - articles/open-group-2017-managing-business-of-it
  - papers/shift-to-digital-product-w205
---

## What it is

IT4IT is The Open Group&#39;s reference architecture for the operating model of IT itself. v3 (2022) refactored the standard around `[[entities/digital-product]]`: seven value streams (Evaluate, Explore, Integrate, Deploy, Release, Operate, Consume) operate on the Digital Product Backbone — renamed from the Service Model Backbone in v3 specifically because Digital Product turned out to be the right spine.

IT4IT does not replace ITIL, COBIT, TOGAF, DevOps, or SAFe. It integrates them. It is the substrate on which those frameworks coexist as one operating model.

## How DPF uses it

DPF&#39;s portfolio and product surfaces are organised around the seven IT4IT value streams. Lifecycle states reference them. The MCP tool surface routes capability discovery through them. Agent coworkers categorise their work by value stream.

The platform&#39;s position is that **IT4IT is canonical**. Customers may operate other frameworks (and should — they own ITIL processes, deploy SAFe trains, run TOGAF reviews), but those connect to the platform&#39;s spine via IT4IT&#39;s value-stream contract.

## Relationships

- Substrate for: ITIL, COBIT, TOGAF, DevOps, SAFe — see `[[stances/it4it-is-substrate]]`.
- Operates on: `[[entities/digital-product]]` (via the Digital Product Backbone introduced in v3).
- Defines: `[[entities/value-stream]]` (the seven that make up the standard).
- Anchors data: `[[entities/csdm]]` represents IT4IT functional components and value-stream activity.

## Examples

A new application proposal moves through Evaluate (does it fit the portfolio strategy?), Explore (which option is right?), Integrate (build/buy/compose), Deploy, Release, Operate, and finally Consume — each value stream owning a distinct contract with the Digital Product.

## See also

- Stance: `[[stances/it4it-is-substrate]]`
- Heuristic: `[[heuristics/pitch-simple-adjust-per-audience]]` — how to introduce IT4IT to executives.
- Raw source: `[raw-sources/frameworks/it4it-v3](../../raw-sources/frameworks/it4it-v3.md)`
