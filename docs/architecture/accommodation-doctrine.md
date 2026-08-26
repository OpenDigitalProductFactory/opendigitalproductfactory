# Accommodation doctrine

How to decide, when a new archetype reveals a difference, whether it is **canonical**,
**vertical**, or **an attribute** — and how to move it later without a rescue project.

This exists so that being wrong is cheap. It is deliberately short. It is a decision procedure,
not an architecture.

---

## Why

Two failure modes, both already observed in this codebase.

**Canonicalising too early is guessing.** Restaurant alone made the capacity substrate look
finished. Tier, blocking holds and jurisdiction were invisible until a structurally unlike
archetype was tried. Any design written from one probe is fiction.

**Canonicalising too late is a migration.** Beauty and hospitality were cloned first. Undoing
that required a dual-read migration carrying `sourceRef` provenance on every row. It worked, but
that is the real price of "refactor it in as we go" at the shared layer — and it scales with
every vertical that lands before the fix.

So: keep discovering incrementally, but classify each difference *at the moment of discovery*
using a fixed procedure, and use a standard accommodation mechanism rather than inventing one
each time.

## The five patterns (already in the codebase, now named)

| # | Pattern | Mechanism | Existing use |
|---|---|---|---|
| 1 | **Open kind vocabulary** | a validated slug column, open set | `Resource.kindSlug` — "chair, station, treatment_room, table, kitchen, ..." |
| 2 | **Polymorphic subject** | `<x>KindSlug` + `<x>Ref` | `CareAppointment.subjectKindSlug` + `subjectRef` |
| 3 | **Polymorphic demand** | `demandSlug` + `demandRef` | `ResourceCapacityAllocation` — "booking, hold, service-turn, ..." |
| 4 | **Clone-to-canonical backfill** | `sourceRef` unique provenance key | `Resource.sourceRef` — "e.g. `BeautyResource:<id>`" |
| 5 | **Typed escape hatch** | `attributes` / `layoutState` Json | `Resource.attributes`, `OperationalSceneLayout.layoutState` |

Patterns 1-3 accommodate variation **with no schema change**. Reach for them first; most
differences are one of these three and stop there.

## The classification procedure

Ask in order. Stop at the first yes.

**1. Is it only a word?**
Same structure, different label — kennel / table / campsite / treatment room.
-> **Pattern 1.** Add a slug value. No schema change, no decision to record.

**2. Is it a new kind of thing attaching to something canonical?**
An animal attaching to an intake packet; a service turn creating demand on a resource.
-> **Pattern 2 or 3.** Register the kind, supply the owning-vertical resolution. No schema change.

**3. Is it a new field that nothing outside this vertical will ever query or constrain on?**
-> **Pattern 5.** Put it in `attributes`. **Register the key** (see below).

**4. Is it a new field that must be queried, sorted, or constrained across verticals?**
-> Needs a real column. Go to the promotion rule.

**5. Is it a new structure — its own lifecycle, its own events?**
-> Build it **in the vertical first**. Go to the promotion rule.

## The promotion rule

How many *independent* archetypes need it?

| Sightings | Action |
|---|---|
| **1** | Build it in the vertical. Do not canonicalise on one example. |
| **2** | Keep it vertical, but **shape it for promotion** and record the second sighting. |
| **3** | **Promote to canonical.** Three independent sightings is a real invariant. |

Three overrides:

- **Load-bearing beats counting.** If getting it wrong is unlawful, unsafe, or corrupts
  reporting, promote at **2**. Wrong in two places is already expensive. *Holds are the current
  example: a restaurant hold is a convenience, a stray hold is statutory.*
- **Keystones promote at 1.** If other elements cannot proceed without it, it is canonical by
  definition regardless of sightings. *Subject identity is the current example.*
- **Never promote from one probe's imagination.** A sighting means an archetype actually needs it
  to run its day, not that it might one day.

### Worked example, live right now

A resource-to-capability map — "which kennels take a large dog", "which sites fit a 32ft rig",
"which stations perform colour".

- beauty — `BeautyResourceService` (built)
- pet-rescue — kennel suitability (required, §5 of the rescue requirements)
- campground — dimensional fit (expected)

Three independent sightings from unrelated verticals. **Promote.** That decision needed no
architecture review — it fell out of counting.

## The promotion mechanic

Do not invent one. This path is already proven by the hospitality/beauty -> `Resource` migration:

1. Add the canonical model **alongside** the clone. Nothing is dropped.
2. Backfill with `sourceRef = '<CloneModel>:<id>'`, unique, so the backfill is idempotent and
   re-runnable.
3. **Dual-read** — canonical first, clone as fallback.
4. Cut writes to canonical.
5. Retire the clone, with a test proving no legacy table or column was dropped prematurely and
   that the rollback selector stays provenance-bounded.

Steps 1-3 are non-breaking, which is what makes an incorrect earlier classification cheap.

## Escape-hatch discipline

`attributes` Json is a **staging area, not a destination**.

- Anything queried or constrained across verticals **must graduate to a column**. Json is not a
  way to avoid the promotion rule.
- **Register every key you put in it.** This is the discipline that prevents the expensive
  failure: `OperationalSceneLayout.layoutState` is opaque, so if pet-rescue writes `tier` for a
  stacked cat condo and warehousing writes `level` for a rack, the two diverge silently and
  promotion later requires reconciling both. One registry file per Json column, listing key,
  meaning, owning vertical, and type.
- A key used by a second vertical is a **sighting**, and counts toward promotion.

## Probe discipline

**Use two probes, never one.** Restaurant alone was insufficient and actively misleading. Choose
the second probe to be **structurally unlike** the first, and treat anything only the second
needs as a *candidate* canonical element rather than a vertical special case.

**Distinguish probe types, and say which you are running:**

- **Discovery probe** — structurally unlike anything built. Expected to surface new canonical
  candidates. *pet-rescue was this.*
- **Confirmation probe** — similar to what exists. Expected to surface **few or none**. *campground
  is this.* If a confirmation probe surfaces many new canonical elements, the model is wrong —
  stop and re-cut rather than absorbing them one at a time.

## Recording

One decision record per promotion or deliberate non-promotion. It must state:

- the difference, in the archetype's own words
- the classification and which step of the procedure produced it
- sighting count and which archetypes
- rejected options and why
- for a non-promotion: what would change the answer

Two threads answering the same generalise-vs-clone question differently produces a generalised
schema under a cloned vocabulary. That has already nearly happened once
(`BI-2C80E6EA` / `BI-51C95802`) — check for an existing decision before opening a new one.

## Anti-patterns

- **Canonicalising from one probe.** Every time, so far, the second probe changed the shape.
- **Treating vocabulary as structure.** Eleven labels over one fixed process is not archetype
  support. If the only thing that changes is a word, pattern 1 is the whole answer.
- **Json as a destination.** Unregistered keys in a shared Json column are a future migration
  with no provenance.
- **Clone without `sourceRef`.** A clone that cannot be backfilled is a permanent fork.
- **Deferring a keystone.** Anything other elements depend on blocks everything behind it;
  resolve it inside the epic rather than after.
- **Believing a passing UX review or a completed onboarding.** Both passed on pet-rescue at 0.05
  operating-model coverage.

## Applying this to campground

Campground is a **confirmation probe**. Expected classification, to be checked rather than
assumed:

| Difference | Expected | Pattern |
|---|---|---|
| site / loop / pad naming | vocabulary | 1 |
| stay = occupancy episode | existing canonical (once lifted) | — |
| reservation, walk-in, waitlist | existing demand vocabulary | 3 |
| ranger rounds | same round shape as kennel rounds | — |
| campground map | `OperationalSceneLayout`, flat — will not stress tier | — |
| hookups (30/50amp, water, sewer) | capability map | promote (3rd sighting) |
| **dimensional fit** — does a 32ft rig fit site 14 | **candidate canonical** | see below |
| **seasonal sites** — episodes lasting months | **stress test** | see below |
| length-of-stay limits (statutory on public land) | jurisdiction rules | candidate, 2nd sighting |

Two to watch closely:

**Dimensional fit** is not capacity-as-a-count. `Resource.capacity: Int` cannot express "32 feet
fits in 40 feet". It is constraint matching against resource attributes, and it is the same shape
as kennel suitability and refrigerated racking — which is why it is the third sighting of the
capability map rather than something new.

**Very long episodes.** A seasonal site runs for months with sub-metered utilities billed against
it; a restaurant turn is ninety minutes. If the episode model assumes short spans anywhere —
index shape, conflict-window scans, `expectedEndAt` semantics — campground will find it. This is
the single most valuable thing this probe can tell us, and it is cheap to check early.

If campground produces more than one or two genuinely new canonical candidates, treat that as
evidence the nine-element set is mis-cut, not as nine-plus-N.
