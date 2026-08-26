# Archetype Operating-Model Audit

## Purpose

Establish whether an archetype can **run a business**, not whether its screens look right.

This is the domain counterpart to the [UX Archetype Audit Rubric](./ux-archetype-audit-rubric.md).
That rubric audits surfaces — route purpose, cognitive load, inert actions, vocabulary
consistency, whether capacity is *presented* coherently. It presumes an operating model exists and
asks whether the UI represents it well.

This audit asks the prior question: **is there an operating model at all?**

## The failure this exists to prevent

During a from-scratch dogfooding cycle the `nonprofit-community` / `pet-rescue` archetype was
installed, configured, and driven through onboarding to 11/11 completion. The public storefront
rendered correctly with archetype-appropriate semantics — Donate rather than Buy, *Adopt a Pet* as
Free/Enquire, a **LAPSING DONORS** panel. Thirteen backlog items were filed and the cycle was
reported as successful.

The archetype had **no operating model**. `AdoptableAnimal` was a catalog listing. There was no
housing, no care schedule, no supplies, no adoption appointment, no veterinary coordination, no
intake pipeline, no events, and no funding model beyond ad-hoc donations. A shelter could publish
a website and do nothing else.

Every check that ran passed. The gap was found only because the operator asked a question the
process did not contain: *what does this business actually do all day?*

**Onboarding completion is not operational validation.** An archetype can complete every setup
step, publish, and score well on the UX rubric while being unable to run the business for a single
day. Nothing in this process may report an archetype as done on that basis.

## Study unit

One archetype, assessed against a concrete fictitious instance of it. Generic assessment does not
work: "a nonprofit" has no operating day, but "a dog and cat rescue with 40 animals, a foster
network, and one part-time vet" does.

## Method

### Step 1 — Write the operating day BEFORE touching the platform

In plain prose, describe one ordinary day at this business, opening to closing. Then a bad day
(the thing that goes wrong), and one periodic cycle (month-end, season, inspection).

Write this first, from domain knowledge, and **do not consult the platform while writing it**.
Reading the product first anchors the description to what the product already does, which is the
precise bias this audit exists to defeat.

### Step 2 — Extract operational nouns and verbs

From the operating day, list every thing the business **holds, houses, schedules, consumes,
treats, or accounts for**, and every action performed on them.

For the rescue this yielded: animal, kennel, foster home, care round, medication course, supply
stock, adopter, application, meet-and-greet, home check, vet practice, procedure, intake, hold
period, event, donation, grant, restricted fund.

A useful completeness prompt: **what does the operator do that, if it stopped for a week, would
harm someone or break the law?** Those are the load-bearing nouns, and they are the ones most
often missing.

### Step 3 — Classify each noun against the substrate

For every noun, search the schema and classify into exactly one bucket:

| Class | Meaning | Action |
|---|---|---|
| **Canonical** | A generic model exists and is usable as-is | Wire the vertical to it |
| **Vertical-bound** | The right shape exists but is welded to another vertical | Decide: generalise or clone |
| **Absent** | Nothing models this | Design it, subject-agnostically where possible |
| **Decoy** | A model shares the name but not the meaning | Record it explicitly so nobody wires to it |

Search both schema and routes; a model can be generic while the only route consuming it is not.

**Every "absent" claim must be evidenced by a search that returned nothing**, quoted in the
finding. Absence asserted from memory is the most common error in this audit.

### Step 4 — Hunt the canonical analogue

Before designing anything new, ask: **which already-built vertical has this same shape under a
different name?**

The strongest finding of the first run came from the operator observing that kennel layout
resembles restaurant floor layout. The schema agreed: `Resource.capacityUnit` already defaults to
`"units"`, and the restaurant path merely hardcodes `kind: "table"` and `capacityUnit: "seats"`
over it. A kennel is that same canonical element with a different unit.

Run this deliberately for every noun. Housing, scheduling, intake, capacity and stock recur across
verticals under different vocabulary, and the analogue is usually already built:

- a kennel, a table, a treatment room and a storage unit are all **capacity-bearing resources**
- a vet visit, a salon booking and a clinical appointment are all **scheduled events against a subject**
- shelter intake, patient intake and tenant onboarding are all **staged admission with exceptions**

### Step 5 — Score, then file

Produce the coverage score below, then file an epic with one child item per gap, ordered by
**dependency, not priority**. Housing before care rounds, because care rounds locate against
housing. Workspace last, because every tile reads a model built earlier — a dashboard built first
correctly shows zeros.

Resolve architectural decisions (generalise vs clone) inside the epic rather than deferring them;
an unresolved gate blocks every child item behind it.

## Coverage score

Comparable across archetypes, which is what turns "pick the least-defined archetype next" into a
measurement rather than an opinion.

For each operational noun score:

- **2** — a canonical or vertical-native model exists and the archetype uses it
- **1** — a model exists but the archetype cannot reach it (vertical-bound), or it is partial
- **0** — absent

Operating-model coverage = sum of scores divided by (2 x noun count).

Record the noun table, the score and the date in the epic. Re-score after the epic closes; the
delta is the evidence the archetype improved.

For reference, `pet-rescue` scored **0.28** at first assessment (2026-08-22): 18 nouns scoring
10 of a possible 36 — two fully present (the animal catalog, donations), six reachable-but-bound
or partial, ten absent. The worked noun table is recorded on epic `EP-5102F494`.

An archetype below **0.6** should not be described as supported in external material.

## Traps

**The vocabulary layer is labels, not process.** `ArchetypeVocabulary` is eleven strings
(`itemsLabel`, `priceLabel`, `stakeholderLabel`, and so on) over one fixed process — priced items
sold to customers. Every archetype must supply a `priceLabel`. Relabelling cannot express that an
animal has no price, that a kennel has occupancy, or that intake is a staged medical workflow.
Never accept "the vocabulary handles it" as evidence of fit.

**Name collisions are traps, not substrate.** `InventoryEntity` and `InventoryRelationship` are
the *codebase* inventory used for contributor source-graph sync. Wiring physical supplies to them
because the noun matched would have been a real defect. Classify these as **Decoy** explicitly.

**Check the backlog, not only the code.** Substrate lives in two places. In the first run, four
items were re-filed by hand under new IDs after a teardown without noticing `BI-4A833B6D`, an
in-progress item owning exactly that problem. Search existing epics and items for the gap before
filing; a duplicate filed against an in-progress epic causes two threads to edit the same code.

**A passing UX audit is not a passing operating model.** The two audits are independent and an
archetype must pass both. The rescue passed the UX pass convincingly, which is what made the
domain gap invisible.

**Do not let the operator supply the domain.** If the founder has to explain what the business
does before the gap becomes visible, this audit was skipped. Step 1 exists to prevent exactly that.

## Definition of done

An archetype has been through this audit when all of the following exist:

1. A written operating day, bad day and periodic cycle.
2. A noun table with every entry classified, and every **Absent** backed by a quoted search.
3. A canonical-analogue note for every Absent and Vertical-bound noun.
4. A coverage score with its date.
5. An epic whose children cover every gap, ordered by dependency, with architectural decisions
   resolved rather than deferred.

## Standards basis (do not re-derive)

- [UX Archetype Audit Rubric](./ux-archetype-audit-rubric.md) — the surface counterpart; run both.
- [Accommodation Doctrine](./accommodation-doctrine.md) — how to classify a difference this audit
  finds as canonical, vertical or attribute, and the promotion rule. **Run this on every finding**;
  the audit surfaces gaps, the doctrine decides where they belong.
- [Canonical Minimal Substrate](./canonical-minimal-substrate.md) — the current element set and
  what is already built. Check here before designing anything; most gaps are reach, not absence.
- [Canonical Lifecycle Grammar](../superpowers/specs/2026-08-15-canonical-lifecycle-grammar-design.md)
  — stages, in-stage states and gated advancement. Any new entity with a lifecycle declares a
  grammar rather than a new stage enum.
- Archetype operating models: [pet-rescue](./archetypes/pet-rescue-operating-model.md) ·
  [campground](./archetypes/campground-operating-model.md)
- [Archetype Business Value Streams](./archetype-business-value-streams.md)
- [Four-Portfolio Archetype AI Workforce Operating Standard](./four-portfolio-archetype-ai-workforce-operating-standard.md)

## Change control

Changes to the method or the scoring formula require re-scoring any archetype whose recorded score
was produced under the previous version, or the scores stop being comparable — which is the only
property that makes them useful.
