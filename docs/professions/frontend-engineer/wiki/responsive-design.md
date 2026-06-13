---
title: Responsive design across devices
pageKind: heuristic
status: published
abstract: Build layouts that adapt to the viewport rather than targeting a fixed width. The web is meant to work for everyone on any device, and Core Web Vitals are judged across both mobile and desktop.
professionCompetencyLevel: practitioner
sources:
  - mdn/accessibility
  - webdev/core-web-vitals
---

## Heuristic

Design layouts that **adapt to the viewport** — fluid grids, flexible media, and breakpoints — rather than targeting a single fixed width. The web is "fundamentally designed to work for all people, whatever their hardware, software, language, location, or ability."

## Why

Users arrive on phones, tablets, laptops, and large displays. Core Web Vitals are assessed across **both mobile and desktop** at the 75th percentile, so a layout that only holds on a designer's monitor fails real users. In particular, **CLS ≤ 0.1** means reflow on varying viewports must not cause unexpected layout shifts — reserve space for media and avoid content jumps as the page adapts.

## How To Apply

1. **Fluid first.** Use relative units and flexible layouts; add breakpoints where the content needs them, not at device-specific pixel widths.
2. **Reserve space** for images/embeds to protect [[professions/frontend-engineer/performance-budgets-core-web-vitals]] (CLS).
3. **Test small screens** and keyboard/zoom — responsiveness and accessibility reinforce each other ([[professions/frontend-engineer/wcag-four-principles-aa-conformance]]).

## See Also

- [[professions/frontend-engineer/performance-budgets-core-web-vitals]]
- [[professions/frontend-engineer/wcag-four-principles-aa-conformance]]
