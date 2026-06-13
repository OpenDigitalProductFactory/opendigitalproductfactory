---
title: WSJF prioritization
pageKind: heuristic
status: published
abstract: WSJF sequences work for maximum economic benefit — score = relative cost of delay divided by relative job duration; the smaller, higher-cost-of-delay job goes first. Cost of delay aggregates value, time criticality, and risk reduction. It ignores sunk costs.
professionCompetencyLevel: practitioner
sources:
  - safe/wsjf
---

## Heuristic

Prioritize portfolio work by **Weighted Shortest Job First (WSJF)**:

```
WSJF = Cost of Delay / Job Duration   (both relative)
```

The **smaller job with the higher cost of delay goes first** — this sequencing yields maximum economic benefit, not the largest ROI estimate.

## Cost of Delay

Cost of delay aggregates **user/business value**, **time criticality**, and **risk reduction / opportunity enablement**. The model also **automatically ignores sunk costs** — a Lean-economics principle: only future delay and remaining duration matter, never prior spend.

> Licensing note: WSJF is SAFe content (copyrighted); paraphrased with attribution.

## How DPF Coworkers Use It

- Use WSJF as the ordering signal that keeps the [[professions/portfolio-management/balance-the-portfolio]] mix economically optimal under capacity constraints.
- Re-sequence freed capacity (from rationalization) toward the highest-CoD work.

## See Also

- [[professions/portfolio-management/balance-the-portfolio]]
- [[professions/portfolio-management/what-is-portfolio-management]]
