---
title: Performance budgets and Core Web Vitals
pageKind: heuristic
status: published
abstract: Hold the page to Core Web Vitals budgets — LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1 — measured at the 75th percentile. Budget for the slow path, and trade richness against these thresholds deliberately.
professionCompetencyLevel: expert
sources:
  - webdev/core-web-vitals
---

## Heuristic

Treat the **Core Web Vitals** as performance budgets the page must stay within, measured at the **75th percentile** across mobile and desktop:

- **LCP (Largest Contentful Paint)** — main content should render within **2.5 seconds** of load start.
- **INP (Interaction to Next Paint)** — pages should have an INP of **200 milliseconds or less**.
- **CLS (Cumulative Layout Shift)** — pages should maintain a CLS of **0.1 or less**.

## Why

Core Web Vitals are "the subset of Web Vitals that apply to all web pages" and should be measured by every site owner. They are judged at the **75th percentile** — meaning you must budget for the slow path (older devices, weaker networks), not the median. They are also a search-ranking and real-user-experience signal.

## The Expert Trade-off

This is the expert-tier page because the work is **trade-off management**: a large hero image or heavy client-side framework improves richness but spends LCP/INP budget. Budget explicitly — set per-page byte and timing budgets, defer non-critical JS, reserve layout space (CLS), and measure with real-user data, not just lab runs. Responsiveness ([[professions/frontend-engineer/responsive-design]]) and these budgets are evaluated together.

## See Also

- [[professions/frontend-engineer/responsive-design]]
- [[professions/frontend-engineer/wcag-four-principles-aa-conformance]]
