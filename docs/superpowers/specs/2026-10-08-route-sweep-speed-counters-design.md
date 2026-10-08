---
status: active
---

# Deterministic speed counters in the UX route sweep

| Field | Value |
| --- | --- |
| Backlog item | `BI-BDB43823` |
| Epic | `EP-B95469DB` — Portal speed: measure the operator journey first, then ratchet every win |
| Depends on | `BI-BD0B0DCC` (operator journey timing), for field correlation once deployed |
| Date | 2026-10-08 |
| Profile | Feature |

## Problem

Wall-clock milliseconds are too noisy to gate CI. The portal's only per-route CI ratchet, the UX route sweep, freezes words, controls, accessibility and page structure. It holds nothing about speed. So a change that doubles a page's script weight, or makes its layout jump after first paint, passes every gate.

The sweep also carries a history of nondeterminism: BI-48741E66, BI-5AA67DE4, BI-69FE5504 and BI-AFDE8CB8. Any counter added to it must therefore prove two things before it may block a PR: that it is identical on unchanged code, and that it moves with wall-clock time. This is rule 2 of the frontend-engineer [performance procedure](../../professions/frontend-engineer/wiki/performance-budgets-core-web-vitals.md).

## Objectives

**OBJ-1:** Measure deterministic speed counters per route inside the existing sweep run, with no second browser pass.

**OBJ-2:** Admit a counter as a gate only once it is shown to be repeatable on an unchanged tree and to track wall-clock time. Record every rejection with its reason.

**OBJ-3:** Gate admitted counters as only-down ratchet axes, so a proven win cannot silently regress.

## Design grounding

This design extends the existing sweep rather than adding a new tool:

- `apps/web/scripts/ux-route-sweep.ts`: the existing per-route Playwright pass. Its route phases already time `navigationAndSettleMs` (lab wall-clock), and the counters are read in the same page after the same settle.
- `apps/web/lib/ux-budget/ratchet.ts`: `RATCHET_AXES`, `RouteBaseline` and `evaluateSweep`. Admitted counters become axes there. No parallel evaluator is added.
- `apps/web/lib/ux-budget/route-budget-baseline.json`: the existing frozen baseline. It is refreshed through the existing `--update-baseline` workflow input (`ux-route-sweep.yml`).
- `scripts/check-module-size.mjs` and `module-size-baseline.txt`: the precedent for "a ceiling may only fall, and the smaller number wins".

No schema, route or UI is added.

## Research and benchmarking

| Implementation | Approach | DPF adopts / rejects |
| --- | --- | --- |
| Lighthouse CI (`lhci assert`) | Budgets on resource bytes and counts plus lab timings, asserted per URL. | **Adopt** the byte and count budgets, which are deterministic for a given build. **Reject** asserting lab timings, which Lighthouse itself documents as variable run to run. |
| size-limit / bundlesize | Per-entry compressed JS bytes checked in CI, ceiling only falls by convention. | **Adopt** the metric: script bytes actually loaded by a route. **Reject** a separate tool, because the sweep already loads every route in a real browser. |
| Chromium Layout Instability API (`layout-shift` entries) | The browser reports each unexpected shift, with `hadRecentInput` and sources. | **Adopt** the count of unexpected shifts after first paint as a candidate. CLS in the field comes from BI-BD0B0DCC. |
| Valgrind instruction counts | Deterministic CPU work for Node hot paths. | **Reject** here. It needs a Node harness per hot path and does not apply to browser routes. It stays a candidate for server hot paths later. |

Standards followed: the Web Vitals guidance that lab timing is diagnostic and field data is ground truth; Resource Timing Level 2 (`encodedBodySize`, `initiatorType`); Layout Instability API.

## Proposed design

### 1. Candidate counters, read in the existing settle

After the sweep's existing `load` and settle step, the sweep reads these in the page:

| Counter | Source | Expected |
| --- | --- | --- |
| `scriptBytes` | Sum of `encodedBodySize` of `resource` entries with `initiatorType` `script` | Deterministic for a build |
| `requestCount` | Count of `resource` entries at settle | Possibly noisy (polling) |
| `layoutShifts` | Count of buffered `layout-shift` entries with `hadRecentInput === false` and `value > 0` | Deterministic if rendering is |
| `longTasks` | Count of buffered `longtask` entries over 50 ms | CPU-dependent, expected to be rejected |

### 2. Admission (OBJ-2)

`apps/web/scripts/ux-speed-counter-admission.ts` runs the sweep's measurement twice on the same tree and decides each counter:

1. **Repeatability.** Every route must give identical counter values in both passes. One difference anywhere disqualifies the counter.
2. **Tracks wall-clock time.** Across all swept routes, the Spearman rank correlation between the counter and `navigationAndSettleMs` (the median of the two passes) must be at least 0.5. Spearman is used because it compares rank order, which a monotone but non-linear relationship still satisfies.

The verdict for every candidate is written to `apps/web/lib/ux-budget/speed-counter-admission.json`: rho, n, the repeatability result and the reason. Rejected counters stay listed with their reason.

### 3. Gate (OBJ-3)

- Only counters marked `admitted` in the admission file are evaluated. `RouteBaseline` gains optional fields for them, and they join `RATCHET_AXES` with the rule "regression when the value is above the baseline".
- A route with no baseline value for a counter is reported, not failed. This follows the existing bootstrap behaviour.
- When a counter falls, the report shows the lower value. `--update-baseline` writes `min(current, baseline)`, so a ceiling can never be raised by a refresh. Raising one needs a hand edit, which is visible in review.

### 4. Field correlation (after BI-BD0B0DCC deploys)

Once journey timing is live, the epic records whether each admitted counter's movement on a route agrees with that route's field LCP p75. A counter whose lab admission is later contradicted by field data is demoted. That is an edit to the admission file, with the evidence attached.

## Failure analysis

| Scenario | Effect | Prevention |
| --- | --- | --- |
| A counter flakes on unchanged code | PRs blocked at random, which is the sweep's known failure | Two-pass repeatability is required before admission. One mismatch disqualifies the counter. |
| A counter is repeatable but unrelated to speed | Agents optimize the wrong hill | The rho ≥ 0.5 rank correlation with lab wall-clock is required. Demotion follows if field data disagrees. |
| A refresh raises a ceiling | A regression is hidden | `--update-baseline` writes `min(current, baseline)` for counters. |
| Counters add sweep time | A slower CI | Reads are buffered Performance entries in the same page. No extra navigation. |

## Objective and acceptance manifest

| ID | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | The sweep records `scriptBytes`, `requestCount`, `layoutShifts` and `longTasks` per route from buffered Performance entries in the existing settle, with no extra navigation (unit-tested reader). |
| AC-2 | OBJ-2 | The admission script disqualifies any counter whose values differ between two passes on the same tree, and requires Spearman rho ≥ 0.5 against `navigationAndSettleMs` (pure functions, unit-tested). |
| AC-3 | OBJ-2 | `speed-counter-admission.json` lists every candidate with rho, n, repeatability and reason, from a real two-pass run, and rejected counters remain listed. |
| AC-4 | OBJ-3 | An admitted counter above its baseline fails `evaluateSweep`. A counter not admitted never fails it. A missing baseline value is reported, not failed. |
| AC-5 | OBJ-3 | `--update-baseline` writes `min(current, baseline)` for counter axes, so a refresh never raises a ceiling. |
