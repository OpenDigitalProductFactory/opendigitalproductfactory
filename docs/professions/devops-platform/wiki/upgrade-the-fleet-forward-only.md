---
title: Upgrade the fleet forward-only
pageKind: principle
status: published
abstract: A fleet of unattended sovereign installs upgrades safely only when every change is forward-only, declaratively described, and rehearsed against real data states — the platform operator is not in the room, so the upgrade path must carry its own safety: guards before apply, recovery points before mutation, and growth bounded by retention.
principleTier: core
principleDirection: Design every fleet-facing change to upgrade unattended — forward-only migrations rehearsed against real data states, declarative desired state, recovery points before mutation, and retention enrollment for every growth table.
principleDimensionVector: {"blast_radius": -0.8, "operational_independence": 0.9, "reversibility": 0.7, "long_term_maintainability": 0.5, "operator_effort": -0.6}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-4-sandbox-prod
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: false
principlePublicRationale: ""
sources:
  - opengitops/principles
  - google/sre-book-risk
---

## Rule

Every change that reaches the fleet — migration, seed, compose topology, retention policy, upgrade step — is designed for an install where **no operator is present**: applied declaratively from versioned desired state, forward-only, with a recovery point taken before mutation and a preflight rehearsal against the install's *actual* data state (not a clean schema) wherever the change class warrants it. A change that needs a human runbook, a shell session, or a DNS edit on the customer's host is a design failure on this platform, not an ops procedure.

## Why

The customer base is many small sovereign installs on lean hosts (Docker Desktop, LAN, CGNAT) that upgrade via self-upgrade with nobody watching. Error budgets teach that reliability comes from engineering the change path, not from heroics at apply time — and here there is no one to be heroic. The platform's measured exposure: 503 migrations in 5 months arriving at installs whose data states span that whole history; ~39 append-only growth tables unenrolled in retention, 26 of them with no time-column index — the slow-motion outage that surfaces first on the leanest host. The L1/L2 migration-safety guard classes are live; the L3 shadow-database preflight is the missing rehearsal step for unattended fleet upgrades.

## How to apply

When designing a change, walk the worst install through it: oldest surviving data state, smallest disk, no operator. The declarative principles apply — desired state versioned and immutable, agents pulling and continuously reconciling; anything imperative in the upgrade path is a defect to engineer out. Every new append-only table enrolls in the retention registry with an indexed time column **in the PR that creates it** (the adoption-ratchet discipline applied to operations). Score decision options on `devops-platform/upgrade_continuity`: an option that keeps every intermediate fleet state upgradeable beats one that requires coordinated simultaneous upgrades, even at feature cost.

## Decision dimensions

- `operational_independence: 0.9` — the install must not depend on the vendor's ops team; that is the sovereignty product promise in operational form.
- `blast_radius: -0.8` — negative: rehearsal and recovery points bound what one bad change can take down.
- `operator_effort: -0.6` — negative: the principle exists to drive required human operations toward zero.
- `reversibility: 0.7` — recovery points and expand→contract keep retreat possible even on a forward-only chain.

## Related

- [[professions/devops-platform/gitops-principles]] — the declarative/versioned/pulled/reconciled substrate this builds on.
- [[professions/devops-platform/deployment-pipeline-and-rollback]] — recovery points are the rollback half of the unattended upgrade.
