---
title: Architecture Decision Record (ADR)
pageKind: entity
status: published
abstract: An ADR captures one architectural decision and its rationale using Nygard's five parts — Title, Status, Context, Decision, Consequences. Context is value-neutral; a superseded decision changes status rather than being deleted.
professionCompetencyLevel: practitioner
sources:
  - nygard/adr
  - adr/github
---

## Definition

An **Architecture Decision Record (ADR)** captures a single architectural decision and its rationale, including its trade-offs and consequences. ADRs accumulate into a project's decision log.

## Nygard's Five-Part Structure

1. **Title** — a short noun phrase naming the decision.
2. **Status** — proposed / accepted / deprecated / superseded.
3. **Context** — the forces at play (technological, political, social, project-local), written in **value-neutral language** describing the forces, not the preferred answer.
4. **Decision** — stated in active voice: "We will …".
5. **Consequences** — the resulting context after applying the decision: positive, negative, and neutral.

## Working Rules

- **Context is neutral.** Describe the forces honestly, not as justification for a foregone conclusion.
- **Supersede, don't delete.** When a decision is reversed, change its status to *superseded* (linking the new ADR) so the historical record survives.
- **Freely reusable.** Nygard's original article is CC0/public-domain, so its template can be adopted directly in DPF.

## How DPF Coworkers Use It

- Use this structure whenever [[professions/enterprise-architecture/record-decisions-as-adrs]] is triggered.

## See Also

- [[professions/enterprise-architecture/record-decisions-as-adrs]]
