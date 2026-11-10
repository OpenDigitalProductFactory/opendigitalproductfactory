---
status: active
---

# Workroom flow F7: the home leads with the main value stream

- **Backlog item:** BI-F19A1128
- **Epic:** EP-B70E718D
- **Design:** [Workroom flow map and measurement](../specs/2026-10-02-workroom-flow-map-and-measurement-design.md) §7 (L0) and §9
- **Depends on:** BI-0FB4A049 and BI-C5CD9EAE (F4/F5), whose read models and drill-in this slice reuses.

## Design grounding

- **Which portfolio leads.** The archetype's `activationProfile.portfolios` decides it. Where an archetype declares a primary portfolio, that portfolio leads.
- **What the hero shows.** It reuses the F4/F5 read models and F3's flow map.
- **Placement.** Decided in DI-10A2E3AC2DF9.

## Backlog coverage

- Decision: atomic
- Parent: BI-F19A1128
- Receipt: blocked-by: the coverage receipt binds this plan's immutable blob at a pushed commit, and this branch cannot be pushed until the local-CI gate passes; it is minted against the pushed blob immediately after
- Rationale: Choosing the portfolio, writing the sentence and drawing the hero form one surface. None of the three is useful without the others.
- Dependencies: BI-0FB4A049, BI-C5CD9EAE

| Deliverable | Live BI | Requirements | Contracts | Flows | Verification | Independently shippable |
|---|---|---|---|---|---|---|
| Main value stream hero | BI-F19A1128 | §7 L0, §9 | `resolveHeroPortfolio`, `bottleneckSentence`, `MainStreamHero` | home → hero → area drill-in | AC-F7-1, AC-F7-2 | No (atomic) |

## Acceptance

- **AC-F7-1:** the hero leads with the archetype's primary portfolio. When more than one is primary, the busiest of them leads. When none is declared, the busiest portfolio overall leads.
- **AC-F7-2:** the hero names one bottleneck in plain words, or says that nothing is waiting. Choosing a step opens that step in the area's drill-in.

## Recorded limitations

- **Archetype value-stream stages are not yet bound to workroom stages.** That needs a stage reference, which BI-B8B3FB70 provides. Until then, the twin strip keeps showing a dash for any stage nothing records, and the hero draws the workroom shapes themselves.
