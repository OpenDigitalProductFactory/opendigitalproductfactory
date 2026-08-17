---
title: Fleet-Safe Schema Evolution
pageKind: principle
status: published
abstract: A migration must apply cleanly against ANY existing install's data state, not just a clean schema — forward-only, immutable after commit, expand→contract for semantic change, with backfill inline. The fleet of sovereign installs has no ops team to rescue a stuck upgrade.
principleTier: core
principleDirection: Author every schema change to apply against any fleet data state — forward-only, immutable once committed, expand→contract for semantic change, backfill inline, verified by the migration-safety guard before merge.
principleDimensionVector: {"blast_radius": -1.0, "reversibility": 0.7, "long_term_maintainability": 0.6, "governance_compliance": 0.5, "speed_to_value": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Sovereign-install customers upgrade unattended; the fleet-safety discipline is a product property they rely on.
---

## Rule

Every migration is written for the **fleet**, not for your database: it must apply cleanly against *any* existing install's data state — populated, empty, or mid-history — not just a freshly migrated schema. Migrations are forward-only and immutable after commit; a wrong migration is corrected by a new one, never edited. Semantic changes (narrowing a type, enforcing a new constraint, moving data) go **expand → migrate → contract** across releases so every intermediate fleet state is valid. Backfill SQL ships inline in the same migration, and the migration-safety guard (L1/L2) verifies the change class before merge.

## Why

The platform's customer base is many small single-tenant sovereign installs on lean hosts, upgrading unattended via self-upgrade — there is no DBA to nurse a failed migration at 2 a.m., so a migration that assumes one install's data state is an outage shipped to every other install. The growth rate makes this the highest-volume risk surface: 503 migrations in 5 months, 222 schema-touching commits in 90 days, 588 models. The L1/L2 guard classes are shipped; the L3 shadow-database preflight (rehearsing each migration against a copy of the install's real data before applying) is the remaining load-bearing piece for unattended fleet upgrades.

## Applies To

Everyone who authors or reviews a migration: in-platform coworkers, external coding agents, humans. Applies equally to seed changes on install/template paths — a symptom on one install is usually a defect for every install.

## How To Apply

Before writing a migration, ask what the *worst-populated* install looks like: rows that predate the column you're adding, duplicates the new unique would reject, NULLs the new NOT NULL would break on. Add the expand step (nullable column, permissive constraint), backfill inline, and defer the contract step to a later release once the fleet has converged. Never add a destructive step to make a migration idempotent locally. When the guard flags a change class, that is the finding — reshape the migration, don't exempt it.

## Decision Dimensions

- `blast_radius: -1.0` — negative at maximum: the entire principle is blast-radius containment across the fleet.
- `reversibility: 0.7` — expand→contract keeps every intermediate state retreat-safe even though the chain itself is forward-only.
- `long_term_maintainability: 0.6` — an immutable, linear chain stays reasoned-about.
- `speed_to_value: -0.3` — expand→contract costs a release of latency on semantic changes.

## Examples

- **Positive:** a status-string→enum migration shipped as expand (add enum column, backfill from string, dual-write) in release N and contract (drop string) in N+1 — every install upgrades cleanly regardless of when it takes each release.
- **Negative:** a migration that renames a column in place and edits an already-committed migration file to "fix" it — the fleet now has installs on divergent chains, which is unrecoverable without manual surgery.

## Related

- [[principles/architecture-over-shortcuts]] — in-place semantic change is the canonical quick fix this domain forbids.
- [[principles/plan-before-install-paths]] — the same fleet-mindedness applied to install and seed paths.
