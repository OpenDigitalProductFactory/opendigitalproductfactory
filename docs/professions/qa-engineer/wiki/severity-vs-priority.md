---
title: Severity vs priority
pageKind: entity
status: published
abstract: Severity measures a defect's impact; priority measures the importance of fixing it relative to other work. They are managed separately — a low-severity bug can be high priority and vice versa.
professionCompetencyLevel: foundational
sources:
  - wikipedia/software-bug
  - wikipedia/bug-tracking
---

## Definition

Two independent dimensions describe every defect:

- **Severity** measures the bug's **impact** — for example data loss, financial harm, loss of goodwill, or wasted effort.
- **Priority** measures the **importance of resolving** the bug relative to other bugs and work.

These "may be quantified and managed separately." A low-severity cosmetic bug on the signup page may be high priority; a high-severity crash in a rarely-used admin tool may be low priority.

## Severity Is Not Fix Complexity

A common error is conflating severity with how hard a fix is. The two are unrelated: "the severity of a bug may not be directly related to the complexity of fixing the bug." Estimate effort separately from impact.

## How DPF Coworkers Use It

- Record **both** severity and priority on every defect — they drive different decisions (impact vs scheduling).
- Use them to feed [[professions/qa-engineer/risk-based-testing-shift-left]]: prioritize by business impact, not raw defect count.
- A defect is only actionable if it can be reproduced — see [[professions/qa-engineer/defect-needs-reproduction]].

## See Also

- [[professions/qa-engineer/defect-needs-reproduction]]
- [[professions/qa-engineer/risk-based-testing-shift-left]]
