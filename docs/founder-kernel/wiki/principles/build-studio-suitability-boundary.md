---
title: Build Studio Suitability Boundary
pageKind: principle
status: published
abstract: Build Studio is for end-customer functional builds, not architecturally-heavy core-platform efforts; route those to a direct expert build.
principleTier: heuristic
principleDirection: Route architecturally-heavy or core-platform work (refactors, schema/data-layer migrations, datastore changes, cross-cutting substrate) to a direct expert build with a single serialized author; reserve Build Studio for customer-facing functional feature builds.
principleDimensionVector: {"long_term_maintainability": 0.7, "evidence_confidence": 0.5, "human_cognitive_load": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: false
sources: []
---

## Rule

**Build Studio is the paved road for end-customer *functional* builds** — features that customers
use the platform to create and operate. It is **not** the right vehicle for **architecturally-heavy
efforts**: core-platform refactors, `schema.prisma` / data-layer migrations, datastore changes,
and other cross-cutting substrate work. Those route to a **direct expert build** by a capable
author (single serialized owner, verify-before-ship), *not* `promote_to_build_studio`.

This is a **deciding factor at triage/routing time**: architecture altitude is an input, alongside
work-type and size. A BI that is architecturally heavy should not be auto-selected into Build Studio
even when the standing "Build Studio for all development" convention would otherwise apply.

## Why

Build Studio's competence is functional composition against the existing substrate. High-altitude
substrate work — where the change *is* the architecture — sits outside that competence: the blast
radius is the platform's core (data layer, migrations that self-upgrade onto live installs), and a
subtly-wrong build there is far more costly than a wasted feature build. Routing such work to BS
wastes cycles and risks shipping a plausible-but-wrong change to the highest-blast-radius code.
Getting it right needs an expert author holding the whole design coherently and verifying before
ship — which is exactly what the "single serialized migration author" discipline provides.

Concretely: this is why EP-8DC217EB BET-5 (Neo4j+Qdrant → Postgres) is built directly rather than
through Build Studio — the founder's ruling that made this boundary explicit.

## Applies To

Any agent or human triaging, sizing, or routing a backlog item. When the work is core-platform /
architectural, choose direct expert build; when it is customer-facing functional, choose Build
Studio. When unsure, treat "does this change the architecture/substrate itself?" as the tiebreaker
toward direct build.
