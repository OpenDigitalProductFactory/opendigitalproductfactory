---
title: Infrastructure as code
pageKind: principle
status: published
abstract: Define and deploy infrastructure through versioned, declarative models so the same definition produces the same environment every time. Idempotence eliminates configuration drift and "snowflake" environments; edit the source, not the target.
principleTier: core
principleDirection: Define infrastructure declaratively in version control; deploy idempotently from the source and never hand-edit live targets.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"long_term_maintainability": 0.7, "blast_radius": 0.6}
professionCompetencyLevel: practitioner
sources:
  - iac/ms-learn
---

## Rule

Define and deploy infrastructure via a **versioned, declarative model**. The same model yields the same environment on every deploy, and all definitions live in version control.

## Why

- **Declarative over imperative** — describe desired state; let the tool converge to it, rather than scripting steps.
- **Idempotence** — "the ability of a given operation to always produce the same result"; re-applying is safe.
- **No snowflakes / no drift** — IaC eliminates hand-tuned, irreproducible environments; you **edit the source, not the target**.
- **Versioned** — all definitions in version control give history, rollback, and audit.

## How To Apply

1. **Everything in version control** — no manual console changes that the source doesn't capture.
2. **Declarative definitions** describing desired state.
3. **Idempotent applies** — re-running converges, never duplicates.
4. Pairs naturally with [[professions/devops-platform/gitops-principles]] (pull + reconcile the declared state).

## See Also

- [[professions/devops-platform/gitops-principles]]
- [[professions/devops-platform/deployment-pipeline-and-rollback]]
- [[professions/devops-platform/sbom-in-the-pipeline]]
