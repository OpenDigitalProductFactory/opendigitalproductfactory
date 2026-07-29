---
title: Name and type the contract canonically
pageKind: principle
status: published
abstract: A categorical value gets an enumerated type, not a free string; a shape shared by a producer and a consumer gets one typed contract both import, not two structural guesses; and a new route, job, or field is named by the convention its neighbours already follow. Naming and typing are architecture, because they are what makes drift detectable instead of silent.
principleTier: core
principleDirection: Give every categorical value an enumerated type and every shared shape one imported contract, and name new surfaces by the convention their neighbours already use.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"schema_grounding": 0.9, "long_term_maintainability": 0.8, "reusability": 0.6, "human_cognitive_load": -0.5}
professionCompetencyLevel: practitioner
sources:
  - opengroup/archimate-3-2
  - ietf/rfc-9110
  - postgresql/data-definition
  - dpf/agents-rulebook
---

## Rule

Three obligations, all of them checkable in a design before a line is written:

1. **Categorical values are enumerated.** A field with a closed set of legal values — a status, a kind, a basis, a period type — is declared as a type with those members, in the registry where the estate's enums live. Not a `String` with the values described in prose.
2. **A shared shape has one contract.** When a producer and a consumer both know a structure, exactly one typed definition exists and both import it. Two independently-derived shapes that agree today are a divergence with a delay on it.
3. **New surfaces follow the existing convention.** A route, job name, table, or field is named the way its neighbours are named. Consistency is the contract; a one-off convention is a small permanent tax on everyone who reads the estate afterwards.

Route and handler layers stay thin: the handler resolves and authorizes, then delegates to the domain service that owns the behaviour.

## Why

ArchiMate's whole apparatus is typed elements and typed relationships — the model has meaning because a "serves" relationship means one thing everywhere, not because each diagram's author was careful. An estate whose categorical values are free strings has thrown that away: nothing distinguishes a legal value from a typo, and every consumer re-implements the same partial validation slightly differently.

RFC 9110 makes the naming half explicit at the interface level: HTTP's value comes from *uniform*, generic semantics that any participant can interpret without prior negotiation. A route named against the estate's convention inherits that interpretability for free. A route named against nothing forces every future reader to check what it actually does.

The database side is the same claim with teeth. PostgreSQL's DDL gives real machinery — enumerated types, check constraints, foreign keys — that turns "this must be one of four values" from documentation into an invariant. Prose in a spec constrains nothing; a type constrains everything downstream of it, including the code a future contributor has not written yet.

The cost of getting this wrong is not a bug on day one. It is that drift becomes **undetectable**. A fifth status value written into a `String` column is accepted silently and read by every consumer as something it does not handle. The same value written into an enumerated type fails loudly, at the boundary, where it is cheap to fix.

## How To Apply

1. **Enumerate before you build.** Every categorical field in the design names its legal values and the registry they are declared in. A design that leaves them as prose is a *revise-before-building* finding — the types are load-bearing.
2. **Point both sides at one definition.** If the plan shows a shape declared twice, that is the finding; collapse it to one import.
3. **Check the neighbours for naming.** Read the adjacent routes, jobs, and columns first. Match them, including pluralization and casing.
4. **Keep the handler thin.** Route → authorize → delegate. Business rules in a route handler cannot be reused, and are the usual reason a second copy appears later.
5. **Push the constraint into the database** where it is expressible — see [[professions/enterprise-architecture/evolve-schema-additively]].
6. **Extend the enum registry in place**; a second registry is a fork — see [[professions/enterprise-architecture/extend-canonical-models-never-fork]].

## See Also

- [[professions/enterprise-architecture/extend-canonical-models-never-fork]]
- [[professions/enterprise-architecture/evolve-schema-additively]]
- [[professions/enterprise-architecture/archimate-three-layers]]
