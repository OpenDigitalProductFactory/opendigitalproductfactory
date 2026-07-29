---
title: Evolve schema additively — expand, migrate, contract
pageKind: principle
status: published
abstract: Schema change reaches running systems, so it is staged rather than switched. Add the new shape alongside the old, backfill and migrate consumers, and remove the old shape only once nothing reads it. An already-applied migration is never edited — a correction is a new migration — and every invariant the design claims must be one the database can actually enforce.
principleTier: core
principleDirection: Stage schema change as expand-migrate-contract with each step independently deployable; never edit an applied migration, and never claim an invariant the database cannot enforce.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"reversibility": 0.8, "long_term_maintainability": 0.7, "schema_grounding": 0.7, "blast_radius": -0.7, "business_disruption": -0.6}
professionCompetencyLevel: expert
sources:
  - fowler/parallel-change
  - fowler/evolutionary-database-design
  - postgresql/data-definition
---

## Rule

Three staged, independently-deployable steps — never one switch:

1. **Expand.** Add the new column, table, or enum member **nullable / optional**, alongside the old shape. Old and new coexist; nothing breaks.
2. **Migrate.** Backfill existing rows, dual-write if there are live writers, and move consumers over one at a time.
3. **Contract.** Once nothing reads or writes the old shape, drop it — and only then tighten the new column to `NOT NULL` or add the constraint that assumes a full backfill.

Two absolutes ride along:

- **An applied migration is immutable.** A migration that has run anywhere is never edited. A correction is a *new* migration.
- **An invariant is only real if the database enforces it.** If the design says "this combination is unique", there must be a constraint that makes it so.

## Why

Sato's *Parallel Change* is the general form: when a change is backward-incompatible and has consumers you do not control in one commit, expand/migrate/contract is what makes each phase independently releasable instead of requiring every consumer to change at the same instant. Schema is the case where this matters most, because the consumers include the currently-running application.

Sadalage and Fowler's *Evolutionary Database Design* supplies the immutability half: migrations are small, sequenced scripts held in version control and applied in order to a blank database. Editing an applied migration breaks that guarantee — environments that already ran the old text and environments that will run the new text now hold *different schemas from the same version number*, and nothing detects the divergence. Their prescribed resolution for a conflict is to renumber and retest your own migration, never to rewrite history.

The unenforceable-invariant failure is the one that most often survives review, because it reads as correct. The classic instance: a uniqueness rule declared over columns where one is nullable. In SQL, `NULL` is not equal to `NULL`, so a plain unique constraint permits unlimited rows whose nullable component is null — the duplicates the design was written to prevent. The design says "unique"; the database says "go ahead". Push a required-from-day-one `NOT NULL` into an expand step and you get the sibling failure: the deploy fails on existing rows, or silently fills them with a default that means nothing.

## How To Apply

1. **Nullable in expand, tightened in contract.** A column required by the final design starts optional. Backfill is what earns the `NOT NULL`.
2. **Ship the migration artifact with the plan.** A plan that describes a schema change but produces no migration file is not implementable; that is a *revise-before-building* finding.
3. **State the uniqueness key explicitly**, including its behaviour over nullable components, and pick the constraint that actually enforces it (a partial index, a sentinel value, or a non-nullable discriminator) rather than assuming a plain unique constraint covers it.
4. **Name the backfill.** How existing rows acquire a value, and what happens to rows that cannot. "Backfill" without a rule is an unhandled case.
5. **Order the drop last, in its own deploy.** Contract is a separate release from migrate; collapsing them reintroduces the coupling the pattern removed.
6. **Add foreign keys instead of string references** when the relation is real — referential integrity is an invariant the database can enforce, and a string reference is one it cannot.

## See Also

- [[professions/enterprise-architecture/extend-canonical-models-never-fork]]
- [[professions/enterprise-architecture/name-and-type-the-contract-canonically]]
- [[professions/enterprise-architecture/architecture-review-verdict-thresholds]]
