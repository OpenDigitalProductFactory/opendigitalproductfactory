---
title: WSJF — weighted shortest job first
pageKind: heuristic
status: published
abstract: WSJF prioritizes work as relative cost of delay divided by relative job duration — sequence the shortest jobs with the highest cost of delay first. If you quantify only one thing, quantify cost of delay.
professionCompetencyLevel: practitioner
sources:
  - safe/wsjf
---

## Heuristic

Prioritize backlog items by **Weighted Shortest Job First (WSJF)**:

```
WSJF = Cost of Delay / Job Duration   (both relative, not absolute)
```

Sequence the **shortest jobs with the highest cost of delay first** — this job-sequencing produces the best economic results.

## Cost of Delay

SAFe composes Cost of Delay from three relative factors: **user/business value**, **time criticality**, and **risk reduction / opportunity enablement**. The guiding rule (attributed to Reinertsen): if you only quantify one thing, quantify the Cost of Delay. WSJF also conveniently ignores sunk costs — a Lean-economics property, since only future delay and remaining duration matter.

> Licensing note: WSJF is SAFe content (copyrighted, © Scaled Agile). This page paraphrases the method with attribution and does not reproduce SAFe text.

## How DPF Coworkers Use It

- Use WSJF to order the [[professions/product-manager/product-backlog-is-ordered-and-refined]] when items compete for the same capacity.
- Pair with [[professions/product-manager/outcome-over-output]]: high WSJF should track real outcome value, not output volume.

## See Also

- [[professions/product-manager/product-backlog-is-ordered-and-refined]]
- [[professions/product-manager/outcome-over-output]]
