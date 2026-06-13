---
title: GitOps principles
pageKind: principle
status: published
abstract: GitOps manages systems by four principles — declarative desired state, versioned and immutable storage, automatically pulled by agents, and continuously reconciled. Git becomes the single source of truth; the system converges to the repo.
principleTier: core
principleDirection: Express desired state declaratively in version control and let agents pull and continuously reconcile it; never push imperative changes to targets.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"long_term_maintainability": 0.7, "blast_radius": 0.6, "evidence_density": 0.5}
professionCompetencyLevel: practitioner
sources:
  - opengitops/principles
---

## Rule

Manage systems by the four **OpenGitOps** principles:

1. **Declarative** — "a system managed by GitOps must have its desired state expressed declaratively."
2. **Versioned and immutable** — desired state is stored with enforced immutability and a full version history.
3. **Pulled automatically** — "software agents automatically pull the desired state" from the source.
4. **Continuously reconciled** — agents observe actual state and continuously reapply the desired state.

## Why

Git becomes the **single source of truth**; the running system converges to the repo, not the reverse. This yields an immutable audit trail (roll back by reverting a commit), eliminates configuration drift (reconciliation auto-corrects), and removes ad-hoc manual changes to live targets.

## How To Apply

1. **Declare every environment** in version control; the repo describes desired state, not procedural steps.
2. **Use a pull-based reconciler** in the target rather than pushing from CI.
3. **Roll back by revert** against the immutable history — see [[professions/devops-platform/deployment-pipeline-and-rollback]].
4. Pairs with [[professions/devops-platform/infrastructure-as-code]] (declarative infra definitions).

## See Also

- [[professions/devops-platform/infrastructure-as-code]]
- [[professions/devops-platform/deployment-pipeline-and-rollback]]
- [[professions/devops-platform/dora-four-key-metrics]]
