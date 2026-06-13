---
title: Review for code health, not gatekeeping
pageKind: heuristic
status: published
abstract: The standard of code review is whether a change definitely improves overall code health. Reviewers favor progress over perfection, look at the full picture, and resolve disagreement by discussion.
professionCompetencyLevel: practitioner
sources:
  - google/eng-practices
---

## Heuristic

Approve a change once it **definitely improves the overall code health** of the system, even if it is not perfect. The goal of review is continuous improvement, not a perfect-or-blocked gate.

## What To Look At

Google's code-review standard directs reviewers to assess:

- **Functionality** — does the change do what it intends, for users and the codebase?
- **Complexity** — is it as simple as it can be; no over-engineering?
- **Tests** — correct, well-designed automated tests (see [[professions/software-engineer/automated-testing-verification]]).
- **Naming, comments, style** — clear names; comments explain *why*; follow the style guide, defaulting undocumented style to codebase consistency.

## Working Rules

1. **Favor progress.** Approve once health clearly improves; mark optional polish as "Nit:".
2. **Facts over preference.** Technical facts and engineering principles settle disagreements; pure preference does not block.
3. **Escalate, don't stall.** Resolve standoffs by discussion and escalation, never by indefinitely withholding approval.

## See Also

- [[professions/software-engineer/automated-testing-verification]]
