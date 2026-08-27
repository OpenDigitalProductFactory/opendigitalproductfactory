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

## The second failure this exists to prevent

On 2026-08-26 the same archetype was **run as a business for one operating day** on a live
install — ten steps in order, through the screens a worker would use. Six steps got part-way,
four could not start, and none completed. The rescue's day was carried on a clipboard, a
whiteboard, a paper binder, a spreadsheet and a phone.

The three most damaging findings were invisible to every step of this method as it stood:

- **No role that can be hired may see an animal.** Both `HR-500 Operations Manager` and
  `HR-600 Workforce Member` are refused the only animal surface. Recruiting has no create
  control, the organization has zero positions, and employment type offers no *volunteer*. The
  business is structurally single-operator.
- **Every public inbound channel demands a donation** before it will accept a message — adoption
  enquiry, found-pet report, surrender request and volunteer offer alike.
- **Typing an intake record published a third party's name, phone and home address** to the open
  web, and the field is write-once, so the only redaction is deleting the animal.

None of these is a missing noun. A perfect score on the thirty entities in the rescue's
requirements would have left all three in place.

**A noun table is not operational validation either.** The first failure taught that completing
onboarding proves nothing; the second teaches that classifying the subject's entities proves
nothing about whether anyone can *do* the day. The method below is extended accordingly: the
study unit grows from the subject alone to the subject, the operators and the public, and a run
stage is added after the paper audit, because several defect classes exist only in use.

## Study unit

One archetype, assessed against a concrete fictitious instance of it. Generic assessment does not
work: "a nonprofit" has no operating day, but "a dog and cat rescue with 40 animals, a foster
network, and one part-time vet" does.

The instance has **three dimensions**, and an archetype is only assessed when all three are:

| Dimension | The question | Missed if skipped |
|---|---|---|
| **Subject** | What does the business hold, house, schedule, treat and account for? | The original gap: a catalog row standing in for an animal |
| **Operators** | Who performs the day, can the archetype hire them, and can those roles reach the work? | A complete model only its founder can open |
| **Public** | Can a stranger reach the business, for each reason they arrive? | An inbound channel that turns people away |

The subject dimension is what steps 2-5 score. The operator and public dimensions are assessed
in step 6, because both are questions about use rather than about schema.

## Method

Steps 1-5 are the paper audit and answer *what is modelled*. Step 6 runs the day on a live install
and answers *what can be done*. Both are required; the second regularly contradicts the first.

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

### Step 6 — Run the day

Steps 1-5 predict what the archetype can do. This step measures it. Perform the operating day
written in step 1, in order, in the product, and record each step **completed / partial /
impossible** with what a real operator would have done instead at every break.

Five rules, each earned by a run that went wrong without it:

1. **Do not stop to read the schema.** When a step cannot be completed, record the real-world
   fallback — paper, a whiteboard, a spreadsheet, a phone call, abandoning the task — and move to
   the next step. Analysis comes after the day. A run that pauses to explain each failure becomes
   platform work and never reaches the afternoon.
2. **Populate before judging.** An empty surface reads as fine. The rescue's public listing was
   recorded as a positive twice before three animals exposed that it is a dead end.
3. **Use the roles that would do the work.** Create the archetype's own staff, sign in as them,
   and perform each step from the account that would really perform it. A founder account hides
   every authorization gap, and authorization gaps are invisible in the schema.
4. **Walk in from the public side.** For each reason a stranger contacts this business — buy,
   book, adopt, report, surrender, apply, complain, donate — start outside, signed out, and try
   to get through.
5. **Try the destructive controls.** Delete, cancel, remove, archive. Check for confirmation,
   undo, and target size at the width the work is really done at.

### The five probes that belong in every run

Independent of archetype, because each has now failed at least once:

- **The arrival surface.** Open the product as a worker starting a shift. Is what it demands the
  business's work? Count the items and classify them; an owner's attention list that is mostly
  platform housekeeping is a defect with a number attached.
- **Staffing.** Can the archetype hire the roles its day requires — by title, employment type and
  work location? Can a vacancy be opened at all? Are the roles on offer this business's roles, or
  the platform's?
- **Reachability.** For every surface the day needs, can the role that performs that step open it?
- **A fact that must not be public.** Every archetype has one — a bite history, a medical note, a
  price floor, a complainant's identity. Record it and then look at the public site.
- **Editing after creation.** Change something you entered an hour ago. Fields that cannot be
  corrected are a distinct failure from fields that do not exist.

### Defect classes the noun table cannot express

Name these explicitly in findings; each survives a full-marks noun score.

| Class | Definition | Seen as |
|---|---|---|
| **Unreachable** | The model and its surface exist; the role that needs it is refused | Only the founder can open the animals |
| **Inert affordance** | A control states a capability its destination does not have | Sixteen value-stream stages with chevrons that lead nowhere; a link reading "Add an appointment" onto a read-only calendar |
| **Write-once** | A field accepts a value at creation and can never be corrected | An intake description containing someone's address, redactable only by deletion |
| **Forced publication** | The only place to record an operational fact is a public one | Intake notes rendering as marketing copy |
| **Silent failure** | An action returns success-shaped nothing | Create Employee leaving the dialog open with no error; Decline not changing the count until a reload |

### Output of the run

A written account of the day: every step marked, every fallback named, and one plain answer to
**could this business have operated today, and on what?** File one backlog item per finding as it
is discovered, and carry on with the day — a platform blocker is a backlog item, not a detour.

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

## Operability, reported beside coverage

Coverage answers *is the model there*. It cannot answer *can the day be done*, and the two come
apart in both directions — an archetype can score well on entities nobody is allowed to open, and
the pet-rescue run completed one whole step at 0.05 coverage.

So report a second number, and keep it separate:

**Operability = steps completed / steps in the operating day**, counting a partial step as a half.

Deliberately not folded into the coverage formula. Coverage is a property of the schema and stays
comparable across every archetype ever scored; operability is a property of a run on a specific
install at a specific version, and would poison that comparison. Two numbers, both dated, both
naming what they were measured against.

Record with the score: the install, the date, the roles used, and the count of steps by outcome.

For reference, `pet-rescue` measured **0.30 operability** on 2026-08-26 — of ten steps, zero
completed, six partial, four impossible — against **0.05 coverage** measured the previous day.
The gap between the two is the interesting part: it is made of the reachability, inert-affordance
and forced-publication defects above, none of which coverage can see.

An archetype is **not supported** below 0.6 coverage, and is **not operable** below 0.8
operability. Say which of the two is failing; they call for different work.

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

**A run that becomes platform work has failed.** The strongest pull in this method is to stop at
the first break and fix it, or to open the schema and explain it. One thread lost an entire cycle
that way and never attempted an intake. The day is the deliverable; findings are filed in passing.

**Correct vocabulary is not reachable capability, and it is the more convincing illusion.** The
rescue cockpit names all sixteen stages of the operating day accurately — identify and triage,
quarantine and place, deliver daily care, transfer custody. Every stage reads zero and none is
clickable. A surface that names the work correctly reads as further along than one that says
Quotes and Orders, and is not.

**Assess the operators, or you assess a demo.** Every judgement made from a single founder account
is a judgement about a business with one employee. If the instance has no worker persona, creating
one is part of the audit, not preparation for it.

**A crash seen once is not a defect until it is seen twice.** One surface appeared to crash during
the rescue run and loaded correctly on retry; it was not filed. Evidence before diagnosis applies
inside this method as much as outside it.

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
6. A written account of a **run** of the operating day, every step marked and every fallback
   named, performed from the roles that would really do the work and including the public path in.
7. An operability figure with its date, install and role list, reported beside the coverage score.
8. The five standing probes answered — arrival surface, staffing, reachability, a fact that must
   not be public, and editing after creation.

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

Changes to the method or the **coverage** formula require re-scoring any archetype whose recorded
score was produced under the previous version, or the scores stop being comparable — which is the
only property that makes them useful.

The 2026-08-26 augmentation — the operator and public dimensions, step 6, the defect classes and
the operability axis — deliberately leaves the coverage formula untouched, so **no re-score is
required** and every figure on record stays comparable. What it adds is a second measurement that
did not exist before, which archetypes acquire as they are next run rather than retroactively.
Coverage figures without a paired operability figure simply mean the archetype has not been run
yet; that absence is itself worth reporting.
