---
title: Performance budgets and Core Web Vitals
pageKind: heuristic
status: published
abstract: Hold the page to Core Web Vitals budgets — LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1 — measured at the 75th percentile. To make the portal faster, measure the operator journey first, gate only counters proven to track wall-clock time, lock each win behind a ceiling that only falls, and never trade freshness or large complexity for a few milliseconds.
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

## How to Make the Portal Faster

Use this procedure for any DPF speed work, whether a human or an agent does it. It was adopted for EP-B95469DB after a review of a large AI-driven speed sprint. The latency budgets it measures against are in the [operations and performance views spec](../../../superpowers/specs/2026-07-28-business-operations-and-performance-views-design.md).

1. **Measure the journey before changing anything.** "Make it faster" with no number is a guess. Time the operator journey from the user's interaction to the rendered result, with client and server time recorded separately. Never start the clock when a component mounts: a dashboard can report 200 ms while the operator waits eight seconds. Record the baseline before the change and the result after it.
2. **A lab counter is evidence only once it is shown to track wall-clock time.** Wall-clock time in CI is too noisy to gate on. Use deterministic counts instead, such as database queries per render, React commits per interaction, layout shifts after first paint, and long tasks. Before a count becomes a gate, show on at least one route that it moves with the journey timing. A count that varies on unchanged code, or does not follow real latency, is removed rather than optimized.
3. **Ratchet every proven win.** Once a count improves, its ceiling drops to the new value and can only go down. A win without a ceiling is lost by the next unrelated change.
4. **Weigh complexity against the gain.** A large change for a few milliseconds is refused. A build plugin or new abstraction must pay for its maintenance with a measured, user-visible improvement.
5. **Speed never costs correctness or freshness.** Cutting requests or cache writes to improve a counter must not stop data from updating. Cached data shown before the server answers must still revalidate, and should look provisional until it is confirmed. A list that keeps showing deleted rows is a defect, not a speed-up. A send must not be acknowledged before it is stored (BI-DEFA25EE).
6. **Stream finished blocks and keep heavy formatting off the main thread.** Render a reply by paragraph, code block or table, not token by token, and memoize blocks that are already finished. Syntax highlighting and tokenization run in a worker so the 8.3 ms frame budget at 120 Hz survives a long reply.
7. **A human checks every change users can see.** Counters do not catch UX regressions such as pop-in, flicker or reordered keystrokes. Attach before/after recordings, and have the owner rule on trade-offs such as when a skeleton appears or how a table reveals.

## See Also

- [[professions/frontend-engineer/responsive-design]]
- [[professions/frontend-engineer/wcag-four-principles-aa-conformance]]
- [[count-the-operations-to-outcome]]
- [[evidence-before-diagnosis]]
