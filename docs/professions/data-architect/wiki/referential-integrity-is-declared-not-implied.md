---
title: Referential integrity is declared, not implied
pageKind: principle
status: published
abstract: An *Id column without a declared relation is a foreign key the database cannot defend — orphanable on every delete, unjoinable by the query planner, invisible to schema tooling. Declare the relation, index the FK side, and treat an FK-shaped column with no relation as a defect at review time.
principleTier: core
principleDirection: Declare every FK-shaped column as a real relation with a leading index; never ship an *Id column whose target the schema does not enforce.
principleDimensionVector: {"schema_grounding": 1.0, "long_term_maintainability": 0.8, "blast_radius": -0.6, "evidence_density": 0.4, "speed_to_value": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: false
principlePublicRationale: ""
sources:
  - postgresql/data-definition
  - fowler/evolutionary-database-design
---

## Rule

A column shaped like a foreign key (`epicId`, `taskRunId`, `leaseHolderPrincipalId`, …) **is** a foreign key, and the schema must say so: a declared relation with referential behavior the data architect chose (`Cascade`, `SetNull`, `Restrict` — a decision, not a default), and an index on the FK side. A bare `String` column that happens to hold another table's id is integrity by convention — the database cannot defend it, the planner cannot use it, and every reader must guess whether it is trustworthy.

## Why

The platform's own governance spine demonstrated the failure mode: the `Workroom` record — the canonical claim record that the consequential-action gate is being anchored on — carried ~11 FK-shaped columns with no declared relation, and ~360 such columns exist across 209 models, alongside ~204 *declared* relations with no leading index (including recursive trees and join tables indexed on neither side). Governance that trusts `leaseHolderPrincipalId` to name a real principal needs the schema, not the application layer, to guarantee it. Additive FK + index migrations are among the cheapest fleet-safe changes that exist; unbacked links, once relied on, are among the most expensive to retrofit.

## How to apply

At schema review: any new `*Id` column either gets a declared relation + index in the same change, or a written statement of why it is genuinely not a reference (a semantic key like `capsuleId`, an external system's id). At decision time: when weighing designs, score the option that declares its relations higher on `schema_grounding` and lower on `data-architect/migration_fleet_risk` — the declared option catches orphans at write time on every install, instead of at read time on one. When backfilling relations onto a populated fleet, follow the expand→contract discipline: add the index, verify orphan counts, then enforce the constraint.

## Decision dimensions

- `schema_grounding: 1.0` — this is the schema-grounding axis applied to the data model itself.
- `long_term_maintainability: 0.8` — declared relations are what keep a 588-model schema navigable.
- `blast_radius: -0.6` — negative: enforcement at the database boundary contains what application bugs can corrupt.
- `speed_to_value: -0.2` — one relation block and one index per column.

## Related

- [[professions/data-architect/schema-migration-practices]] — the fleet-safe mechanics for adding constraints to populated installs.
- [[professions/data-architect/one-data-model]] — unbacked links are how parallel truths creep into a single model.
