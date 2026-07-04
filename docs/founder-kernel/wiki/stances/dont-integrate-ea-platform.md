---
title: Consolidate on one canonical data model — don't integrate two systems of record
pageKind: stance
status: published
abstract: When two platforms each claim authority over the same entities, the integration between them goes through Independent → Honeymoon → Ugly Reckoning and fails slowly. Pick one platform and one canonical data model. This is the war-story behind why DPF is one cohesive platform, not an integration hub.
sources:
  - articles/think-twice-ea-platform-servicenow
  - articles/sibling-portfolios
---

## The position

When two platforms each hold a **system of record for the same entities**, don&#39;t integrate them — **consolidate on one platform with one canonical data model**. Best-of-breed loses on practicality even when it wins on feature depth. The cost of consolidating is almost always far less than the cost of an integration that fails slowly.

This is the conviction DPF is built on. DPF is deliberately *one cohesive platform over one data model* rather than a hub that wires together best-of-breed point tools — because I have watched the wire-it-together pattern fail the same way for 18 years. The stance below is why the platform has the shape it does.

## Why

Any integration between two systems of record for the same entities progresses through three predictable phases:

1. **Independent** — both platforms work fine. Each team owns its own model; each is correct on its own terms.
2. **Honeymoon** — the integration ships. Everyone reports success. The first ~6 months look great.
3. **Ugly Reckoning** — scope creep, semantic mismatches, chicken-vs-egg ownership questions, and reconciliation drift compound. The integration becomes "unachievable as originally intended." Data quality collapses. People stop trusting the model.

The failure mode is structural, not a matter of effort or tooling. Two systems of record claiming authority over the same entities can only be reconciled by a third authoritative source (which nobody can afford) or a one-way master-slave relationship (which one team has to accept losing). Both usually fail to ship; the integration limps along producing increasingly stale views.

The alternative is consolidation: pick one platform, accept losing 10–20% of specialist feature depth, and never run the integration. The maths almost always favours consolidation — see `[[heuristics/reuse-the-camera-in-your-pocket]]`.

### The war-story: EA platforms and ServiceNow

The pattern that named this stance was third-party enterprise-architecture tools integrated with ServiceNow&#39;s CMDB, consolidating instead on one canonical model (`[[entities/csdm]]`).

> Disclosure: I wrote the original argument as a ServiceNow Senior PM, and it aligns with ServiceNow&#39;s commercial interest. It also aligns with 18 years of watching the same integration pattern fail at Dell, Troux, HPE, and ServiceNow. The pattern is real independent of the vendor; ServiceNow simply happened to be the consolidation target most often.

The generalisation is the point: the entities were "applications" and the two records were "the EA tool" and "the CMDB," but the structural trap — two authorities, slow reconciliation failure — is the same wherever it appears, which is why DPF refuses to be the second record.

## When this applies

- Choosing between a dedicated best-of-breed tool and an integrated platform that already covers the capability.
- Inheriting a two-system-of-record integration that&#39;s in trouble.
- Any DPF adoption where someone proposes keeping an existing external tool as the authoritative source for entities the platform already models.
- Designing a canonical-data-model rollout (CSDM or DPF&#39;s own model) where a parallel authority is being proposed.

## When it doesn't

- Pure modeling work that never flows into operations — academic exercises, future-state target architectures with no current-state tie-in.
- Specialist domains the consolidation target genuinely doesn&#39;t cover. Those *might* justify the integration cost, but the bar is high — one authority per entity, not two.

## Heuristics derived from this stance

- `[[heuristics/reuse-the-camera-in-your-pocket]]` — the camera analogy makes the trade-off concrete.

## See also

- Stance: `[[stances/trust-the-cmdb-or-rebuild-it]]` — consolidation only works if the surviving record is trustworthy.
- Entity: `[[entities/csdm]]`
- Entity: `[[entities/portfolio]]`
- Related: `[raw-sources/articles/sibling-portfolios](../../raw-sources/articles/sibling-portfolios.md)` — the APM/SPM unification case study.
