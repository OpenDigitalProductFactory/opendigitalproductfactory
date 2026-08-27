---
title: Validate an archetype by running its business, not by auditing its surfaces
slug: validate-an-archetype-by-running-its-business
pageKind: principle
status: draft
abstract: An archetype is validated by attempting a real operating day in the product with populated data, not by reading its schema or reviewing its screens. Feature audits on empty surfaces produce confident wrong answers.
principleTier: principle
principleDirection: Prefer evidence from attempting the operator's actual day with real records over evidence from schema reads, empty-surface review, or completed onboarding.
principleDimensionVector: {"evidence_density": 1.0, "customer_value": 0.8, "long_term_maintainability": 0.4, "speed_to_value": -0.3, "blast_radius": -0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
  - build-studio
principlePublic: false
principlePublicRationale: ""
---

## Rule

To find out whether an archetype works, attempt the operator's day in the product: create the
records, run the steps in order, and record where you get stuck. Do not substitute a schema read,
a screen review, or a completed onboarding for that attempt.

Two failure modes this rule exists to prevent:

- **Assessing empty surfaces.** A surface with no data renders an empty state, and an empty state
  hides every defect that only appears once records exist.
- **Drifting from the business into the platform.** When a step fails, the pull is to open the
  schema and explain why. That converts a business test into a platform investigation and the day
  never gets run.

## Applies To

Anyone validating an archetype, vertical, or customer-facing capability — in-platform coworkers,
external coding agents, and humans. It applies to a dogfooding cycle, an acceptance pass, and any
claim that an archetype is "supported".

## Why

DPF's archetypes fail quietly in the direction of looking finished. The storefront carries
archetype-appropriate vocabulary, onboarding completes, and the UX rubric passes — while the
business underneath cannot run for a single day.

A worked case: the `pet-rescue` archetype completed onboarding 11/11, published a correct public
storefront (Donate rather than Buy, Adopt as Free/Enquire), and passed a UX review. Its
operating-model coverage was **0.05**. It had no intake, no housing, no care round, no medical
record, and no outcome vocabulary. Every check that ran passed.

Three specific errors traceable to not running the business:

1. **The operating day was written from the platform.** Reading the product first anchors the
   noun list to what the product already does, which is the precise bias the audit exists to
   defeat. It yielded 18 nouns; the domain has 30. The archetype scored 0.28 instead of 0.05 —
   not a measurement error, a scope error, and it made a near-empty archetype look a third done.
2. **The public storefront was recorded as a positive** on an instance with zero animals. Adding
   three exposed that the listing is a dead end: no per-animal URL, no per-animal inquiry, and
   no filtering. For a rescue that is the entire acquisition funnel, and it was invisible while
   the surface was empty.
3. **The consumer surface was inferred rather than researched.** The adoption listing standard —
   the field set adopters filter on, and the 40+ syndication destinations rescues actually depend
   on — was assumed for two cycles until it was looked up, which changed the requirements
   materially.

The generalisation: **completed onboarding is not operational validation, and a passing surface
review is not either.** Only the attempt to work a day distinguishes an archetype that runs a
business from one that renders a business.

## How To Apply

1. **Write the operating day before touching the platform.** An ordinary day, a bad day, and one
   periodic cycle, from domain research. If the product has already been opened, the day is
   contaminated — write it in a separate session or from a source outside the product.
2. **Research the consumer-facing surface rather than inferring it.** Find out what the
   equivalent real-world artifact contains and what the established interchange format is. Do not
   derive it from what the product happens to render.
3. **Populate before judging.** At minimum: several subject records, one transaction, one status
   change. Follow each to every surface that should reflect it.
4. **Attempt each step in order, in the product, as the role that does it** — including at the
   device width that role actually uses.
5. **When a step fails, record what a real operator would do instead** — paper, a spreadsheet,
   a phone call, abandoning the task — and move to the next step. Do not stop to diagnose. A
   platform blocker is a backlog item, not a detour.
6. **Check defaults on create and every destructive control.** What state does a new record land
   in, and who can see it? Does delete confirm? These are invisible on an empty instance.
7. **End with one judgement:** could this business have operated today, and on what?

## Decision Dimensions

- `evidence_density: 1.0` — the strongest pull. The principle is entirely about attempted work as
  evidence over inspected structure as evidence.
- `customer_value: 0.8` — an archetype is a promise to an operator that they can run their
  business. Only running it tests the promise.
- `long_term_maintainability: 0.4` — findings from a real day are concrete and reproducible;
  findings from a schema read tend to be restated each cycle.
- `speed_to_value: -0.3` — a modest concession. Running a day is slower than reading a schema.
  The principle accepts that because the alternative is confident wrong answers.
- `blast_radius: -0.4` — an archetype declared supported on surface evidence radiates the error
  into external material, roadmaps, and adopter expectations.

## Related

- [Test in the portal build, not just in unit tests](./test-in-the-portal-build.md) — the same
  argument one layer down: real execution over inferred correctness.
- [Structural verification is not functional verification](./structural-verification-is-not-functional.md)
- `docs/architecture/archetype-operating-model-audit.md` — the method this principle governs.
