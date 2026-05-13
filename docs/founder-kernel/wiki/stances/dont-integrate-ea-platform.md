---
title: Don't integrate a third-party EA platform with ServiceNow — consolidate on one data model
pageKind: stance
status: published
abstract: EA-platform-to-CMDB integrations go through Independent → Honeymoon → Ugly Reckoning. Pick one platform and one canonical data model (CSDM). The cost of consolidation is far less than the cost of the integration failing slowly.
sources:
  - articles/think-twice-ea-platform-servicenow
  - articles/sibling-portfolios
---

## The position

Don&#39;t integrate a third-party EA platform with ServiceNow (or with any operational system of record). **Consolidate on one platform with one canonical data model — `[[entities/csdm]]`**. Best-of-breed EA loses on practicality even when it wins on feature depth.

> Disclosure: I&#39;m a ServiceNow Senior PM, and this stance aligns with ServiceNow&#39;s commercial interest. It also aligns with 18 years of watching the integration pattern fail at Dell, Troux, HPE, and ServiceNow. The pattern is real; my employer happens to be the consolidation target most often.

## Why

The integration progresses through three predictable phases:

1. **Independent** — both platforms work fine. EA team owns the EA model; Ops team owns the CMDB. Each is correct on its own terms.
2. **Honeymoon** — the integration ships. Everyone reports success. The first ~6 months look great.
3. **Ugly Reckoning** — scope creep, semantic mismatches, chicken-vs-egg ownership questions, and reconciliation drift compound. The integration becomes "unachievable as originally intended." Data quality collapses. People stop trusting the model.

The failure mode is structural. You have two systems of record claiming authority over the same entities. Reconciliation requires either a third authoritative source (which nobody can afford) or a one-way master-slave relationship (which one team has to accept losing). Both options usually fail to ship; the integration limps along producing increasingly stale views.

The alternative is consolidation. Pick one platform and accept that you&#39;ll lose 10–20% of the specialist EA feature depth in exchange for never running the integration. The maths almost always favours the consolidation — see `[[heuristics/reuse-the-camera-in-your-pocket]]`.

## When this applies

- Choosing between a dedicated EA tool and an integrated platform that includes EA capability.
- Inheriting an existing dedicated-EA-tool deployment with a CMDB integration in trouble.
- Designing a CSDM rollout where someone proposes "let&#39;s keep the existing EA tool as the source for application data."

## When it doesn&#39;t

- Pure modeling work that doesn&#39;t need to flow into operations — academic EA exercises, future-state target architectures with no current-state tie-in.
- Specialist domains the consolidation target genuinely doesn&#39;t cover (some industry-specific EA tools have capability ServiceNow lacks; those *might* justify the integration cost, but the bar is high).

## Heuristics derived from this stance

- `[[heuristics/reuse-the-camera-in-your-pocket]]` — the camera analogy makes the trade-off concrete.

## See also

- Stance: `[[stances/trust-the-cmdb-or-rebuild-it]]` — why consolidation only works if the CMDB is trustworthy.
- Entity: `[[entities/csdm]]`
- Entity: `[[entities/portfolio]]`
- Related: `[raw-sources/articles/sibling-portfolios](../../raw-sources/articles/sibling-portfolios.md)` — the APM/SPM unification case study.
