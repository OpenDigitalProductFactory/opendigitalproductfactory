---
title: Deployment pipeline and rollback
pageKind: principle
status: published
abstract: Deploy through a repeatable pipeline that executes versioned environment definitions, optimize for short lead time and high frequency without trading away stability, and design for fast recovery — rollback by reverting immutable history, verified by observability.
principleTier: core
principleDirection: Deploy repeatably from versioned definitions; optimize throughput and stability together and design rollback-by-revert with observability verification.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"blast_radius": 0.7, "long_term_maintainability": 0.6, "speed_to_value": 0.5}
professionCompetencyLevel: practitioner
sources:
  - iac/ms-learn
  - dora/four-keys
  - opengitops/principles
  - opentelemetry/observability-primer
---

## Rule

Deploy through a **repeatable pipeline** that executes versioned environment definitions, and design every deploy to be **reversible**.

## The Discipline

- **Repeatable** — release pipelines execute versioned [[professions/devops-platform/infrastructure-as-code]] definitions to configure targets the same way every time.
- **Throughput + stability together** — optimize for short change lead time and high deployment frequency *without* trading away stability (DORA).
- **Fast recovery** — minimize failed-deployment recovery time; design for revert/redeploy.
- **Rollback by revert** — [[professions/devops-platform/gitops-principles]] reconciliation enables rollback against immutable history.
- **Verified by signals** — [[professions/devops-platform/observability-for-operations]] gates and confirms each deploy.

## How To Apply

1. **No manual deploys** — everything flows through the pipeline from versioned source.
2. **Make rollback a first-class path**, not an afterthought — practice it.
3. **Gate on observability** — promote only when signals are healthy; roll back on regression.
4. **Measure** against [[professions/devops-platform/dora-four-key-metrics]].

## See Also

- [[professions/devops-platform/dora-four-key-metrics]]
- [[professions/devops-platform/gitops-principles]]
- [[professions/devops-platform/observability-for-operations]]
- [[professions/devops-platform/sbom-in-the-pipeline]]
