---
title: Relations Are Typed, Never Generic
pageKind: principle
status: published
abstract: Every relation recorded in a DPF graph names what it means. A catch-all such as "associated with", "related to", "linked to" or a bare "references" is refused.
principleTier: commandment
principleDirection: Record every relation under a registered type that states its meaning, direction, endpoint kinds and inverse; never record a generic connection.
principleDimensionVector: {"schema_grounding": 0.9, "long_term_maintainability": 0.85, "evidence_density": 0.7, "governance_compliance": 0.6, "legibility_of_consequence": 0.6, "human_cognitive_load": -0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: A graph is only as useful as the meaning of its edges; adopters building on DPF's knowledge graph, EA model and inventory need the same guarantee.
---

## Rule

Every relation recorded in a DPF graph names what it means. It has a type from the governed relation vocabulary (`packages/db/src/relation-vocabulary-entries.ts`), and that type states:

- its meaning, in one sentence that can be tested;
- its direction;
- the kinds of thing allowed at each end;
- the label it reads with in reverse.

This applies to the graph mirror (`graph_edge`), the EA model, inventory, documents and the knowledge base.

A catch-all is refused: "associated with", "related to", "linked to", "connected", an unqualified "references", "other". Some standard notations define a weak relation, such as an ArchiMate association or a SysML trace. Where DPF must keep one, the edge carries a required qualifier that says what it specifically means. An authored hyperlink stays a hyperlink, classed `navigational`, and analysis does not read it as a semantic fact.

## Why

A generic relation says that two things are connected but not how. One such edge is harmless. Thousands of them leave a graph that a person cannot read and an AI cannot reason over: a foreign key looks the same as a compliance obligation, and a dependency looks the same as a mention.

The live inventory on 2026-10-27 found 3,328 generic edges, 27.9% of the platform's non-code graph. Both generic types were projections of the same Prisma relations, written twice under two vague labels.

Established vocabularies already give typed relations:

- ArchiMate 3.2 relationships (association is its weakest);
- W3C SKOS;
- W3C PROV-O;
- schema.org;
- SQL foreign keys;
- SysML v2.

Reusing them makes an edge legible inside DPF and portable outside it.

The WWMD decision on 2026-10-27 (DI-415EC6EDD266) scored four options. A commandment scored 12.42, a core principle 11.15, a profession principle 8.08 and a guard alone 4.33. Confidence was high and no commandment conflicted.

## Applies To

Applies to everyone who records a relation:

- in-platform coworkers writing EA or knowledge links;
- external coding agents adding a projection, a seed or an edge type;
- humans modelling in the EA canvas or linking documents.

It does not apply to the free text of a description. It governs the structured relation, not the prose around it.

## How To Apply

1. **Pick an existing registered type.** Read the relation vocabulary first; most relations already have a typed key mapped to a standard.
2. **Register a new type properly when none fits.** Give it a meaning, direction, domain, range, inverse label, class and a standard mapping, plus a migration row in `graph_relation_type`. A generic name is refused by the registry lint, the `upsertGraphEdge` check, the database foreign key and the relation-vocabulary guard.
3. **Qualify a weak standard relation.** An ArchiMate association needs a `role`. A cross-layer SysML trace needs a `traceKind`.
4. **Never fall back.** An importer or a "pick a default" helper that cannot type a relation reports a finding. It never writes a generic edge.

Design: [typed relation vocabulary](../../../superpowers/specs/2026-10-27-typed-relation-vocabulary-design.md). Extends [name and type the contract canonically](../../../professions/enterprise-architecture/wiki/name-and-type-the-contract-canonically.md) and [add only the associations live data proves necessary](../../../professions/enterprise-architecture/wiki/minimal-proven-associations.md).

## Decision Dimensions

- `schema_grounding: 0.9`: the relation's meaning lives in a registered, database-enforced vocabulary, not in each writer's habits.
- `long_term_maintainability: 0.85`: typed edges stay analysable as the graph grows; generic ones decay into noise.
- `evidence_density: 0.7`: a typed edge is a checkable claim, and a generic one claims nothing.
- `human_cognitive_load: -0.4`: a reader no longer has to guess what an edge means.

## Examples

- **Positive:** A Prisma foreign key is recorded once, from the model that holds it, as `HAS_FOREIGN_KEY_TO` with its field and cardinality. A required cascading key is ArchiMate composition.
- **Positive:** A control's evidence is `EVIDENCED_BY` (PROV-O), and the evidence is `ATTRIBUTED_TO` the actor responsible.
- **Counterexample:** Writing `ASSOCIATED_WITH` between two data objects for every relation in both directions. 2,123 such edges told an analyst nothing that the field names did not already say.
- **Counterexample:** An importer that turns every relationship type it does not recognise into an association. The original meaning is lost silently.
