# Archetype Demo Factory — a realistic business per archetype, at scale (design)

**Status:** proposed
**Epic:** EP-ARCHETYPE-DEMO (proposed) · workstream **A** of [EP-LIVING-BUSINESS-EXCELLENCE](2026-07-15-living-business-excellence-program-design.md)
**Parent program:** [Living Business Excellence Program](2026-07-15-living-business-excellence-program-design.md)
**Also realizes:** the unbuilt P2–P4 of [Business Activity Simulator](2026-07-04-business-activity-simulator-design.md)
**Started:** 2026-07-15

## 1. Problem

To know whether a customer will be delighted the first time they open DPF, we must be able to
*see* a realistic version of their business — for **any** of the 94 archetypes — and iterate on
it. Today we cannot:

- Seeded operational demo data (staff / customers / bookings / finance) exists for **0 of 94
  archetypes**. Seeding an archetype (`seedStorefrontArchetypes`, `archetype-reset.ts`) creates
  storefront *templates* and an **empty** org — no demand, no workforce, no money moving.
- The only "see the twin" harness (`/admin/twin-kit`) renders **generic fixture** data
  (`buildDemoTwinSnapshot`), not a persona'd business. A dental practice shows as "first
  healthcare leaf" with synthetic "Table 1 / Ticket #123" units.
- The Business Activity Simulator shipped **1 archetype** (field-service, financial only); its
  cross-archetype factories and viz wiring were earmarked P2–P4 and never built.
- Deep persona *doctrine text* exists for ~8 flagship slugs; there are 5 hardcoded e2e businesses.

**The constraint that dominates the design (founder's biggest worry):** an effective way to test
and iterate **each** archetype **without a massive per-archetype effort**. Anything that costs
*one hand-built business × 94* fails.

## 2. Principle: derive, don't author

A demo business is **derived** from the archetype's own structure by one generator, with only a
**thin flavor layer** authored. This is the same derive-with-override discipline the twin already
uses (ADR-4); the demo factory is the fifth member:
`deriveOperationalValueStream` · `deriveTwinProfile` · `deriveFieldDispatchProfile` ·
`deriveMediaProfile` · **`deriveDemoBusiness`**.

Coverage is therefore **94/94 from day one** (every archetype derives a valid demo), and fidelity
is **incremental** (a curated flavor file raises a given archetype from "plausible" to "a real
owner would recognize this"). Marginal cost per archetype = a small data file, or zero.

### 2.1 What the generator reads (all already per-archetype, all shipped)

`deriveDemoBusiness(archetype, { seed, flavor? })` composes existing per-archetype signal:

| Source | Contributes |
|---|---|
| `ArchetypeDefinition` — `itemTemplates`, `sectionTemplates`, `ctaType`, `tags`, `vocabulary` | the offerings/services, the CTA (booking/purchase/inquiry/donation/rental), the domain nouns |
| `schedulingDefaults` (`schedulingPattern`: slot/class/…) | the booking cadence + how demand arrives on the calendar |
| `deriveTwinProfile(archetype)` — `template`, `zones`, `queues`, `resourceNoun`, `capacityChips`, `cog` | the shape of resources + demand to populate (tables/vans/chairs/accounts) |
| `deriveOperationalValueStream(archetype)` — stages, `loadBearingStageKeys`, `capacityUnit`, `demandSignature` | *where* work-in-flight sits along the value stream (Epic C makes this a first-class binding) |
| `getPlaybook(category, ctaType)` — `keyMetrics`, `primaryGoal` | realistic KPI targets → plausible volumes (bookings/day, utilization, revenue) |
| `resolveBusinessProfile(archetype)` — mission/who-we-serve/tone | company name style, customer archetypes, staff role titles |
| workforce roster patterns + `agent_registry` | the human roster + the AI coworkers that inhabit the twin |

The generator is **deterministic** given `seed` (a stable string, e.g. the archetypeId) — no
`Math.random`/`Date` in the pure core (matching the twin's demo-snapshot discipline) — so demos
are reproducible, snapshot-testable, and diffable.

### 2.2 The thin flavor layer (the only authored part)

```
interface DemoFlavor {
  companyName?: string;                 // "Bright Smile Dental" vs derived "Demo Dental Practice"
  locale?: string;                      // name/currency/address style
  staff?: Array<{ name; role }>;        // a few real-sounding people
  customers?: string[];                 // a few real-sounding customer names
  signatureOfferings?: string[];        // hero services beyond the template defaults
  notes?: string;                       // one-line "what a great one feels like"
}
```

Flavor lives in a per-archetype registry (a data file, category-defaulted). **This is the same
curated material as Epic B's excellence corpus** — authored once, consumed by both the demo
factory (fidelity) and WWWD priming (stance). Absent flavor, the generator falls back to
category-derived defaults that are always valid.

## 3. The demo business shape

```
interface DemoBusiness {
  archetypeId; companyName; currency; timezone;
  workforce: DemoWorker[];              // humans (roles) + AI coworkers (kind: "ai")
  customers: DemoCustomer[];
  demand: DemoDemand[];                 // bookings/orders/matters across value-stream stages + queue ages
  finance: { bills; invoices; taxPeriod; obligations };   // money in-flight (feeds the utility band + outcomes)
  seededAt;                             // stamped after generation (outside the pure core)
}
```

It is a superset of exactly the substrate `loadLivingBusinessSnapshot` already reads
(`workforceRoster`, `storefrontBooking`, `serviceProvider`, `bill`, `invoice`,
`taxObligationPeriod`, `obligation`) — so a loaded demo renders through the **live** projection,
not a fixture. Demo and live are the same code path; only the data's provenance differs.

## 4. Load path — reversible, single-org-safe

DPF is single-org-per-deployment. `loadDemoBusiness(archetypeId, { flavor? })`:

1. Sets the deployment org's `StorefrontConfig.archetypeId` (via the existing archetype-reset
   path) so templates/vocabulary match.
2. Generates the `DemoBusiness` and **upserts** it into the real tables (idempotent, tagged
   `source: "demo"` so it is distinguishable and removable).
3. Runs the setup-completion seeds (incl. `seedOrgWwwdCorpus`) so the primed corpus is present.

`unloadDemoBusiness()` removes every `source: "demo"` row — a clean teardown. A guardrail forbids
loading a demo over an org that has **non-demo** data (never clobber a real business).

## 5. Review & test at scale — the answer to "iterate without massive effort"

Three mechanisms, all powered by the one deterministic generator:

### 5.1 Gallery harness — *see* all 94 in minutes
Extend `/admin/twin-kit` (or a sibling `/admin/twin-gallery`) to iterate `ALL_ARCHETYPES`,
render each twin from its generated `DemoBusiness` through `TwinView`, and lay them out as a
scannable grid grouped by category. A reviewer scans the entire catalog on one page, spots the
weak ones, and clicks through to the full `/workspace` view for any archetype. No business is
stood up by hand.

### 5.2 Golden snapshots — *catch regressions* automatically
One vitest that loops all 94: `deriveDemoBusiness → loadLivingBusinessSnapshot-shape → TwinView`
and snapshots the result. Deterministic input ⇒ stable snapshots ⇒ any derivation change surfaces
as a reviewable diff across every archetype at once. Coverage is 94/94 from a single test file.

### 5.3 Delight oracle — *assert realism*, not just "renders"
A per-archetype rubric (an oracle, in the simulator's `oracles.ts` spirit) asserting each demo is
**non-degenerate and plausible**: every zone has resources, the primary queue has demand with
sane wait-times, the cog has a real proposed move, presence has both humans and AI, finance shows
money in-flight, and (Epic D) outcomes are accruing. The oracle is the machine-checkable proxy for
"would a real owner recognize this?" — run over all 94, it is the scalable quality gate.

## 6. How this de-risks the other epics

- **B (Excellence Corpus):** shares the flavor registry — authored once, primes WWWD *and* flavors
  demos. The gallery is where we judge whether the primed corpus reads as "what great looks like."
- **C (Grounding):** the demo's `demand` is generated *per value-stream stage*; the gallery/oracle
  are how we verify the twin's tiles map to the right stages once C binds them.
- **D (WWWD Outcomes):** the demo puts real gated decisions + `Invoice.paidAt` revenue in front of
  the cog/quests, so we can exercise the WWWD loop and see outcomes accrue — impossible without A.

That is why A is first: it is the bench every other epic is tested on.

## 7. Phased execution

- **P1 — the generator + one load path.** `deriveDemoBusiness` (pure, deterministic) + the
  `DemoBusiness` shape + `loadDemoBusiness`/`unloadDemoBusiness`; golden snapshot over all 94;
  the delight oracle. Verified: every archetype derives a non-degenerate demo.
- **P2 — the gallery.** `/admin/twin-gallery` renders all 94 twins from generated demos; click
  through to `/workspace`. The founder review surface.
- **P3 — the flavor registry** (shared with Epic B): category defaults + the ~8 flagship slugs
  first, then fan out; each entry raises fidelity without touching the generator.
- **P4 — CI + simulator convergence.** Fold the shipped field-service simulator flow in as the
  "activity over time" layer; wire the delight oracle into CI as the per-archetype quality gate.

## 8. Non-goals
- Not 94 hand-authored businesses (§2 exists to prevent this).
- Not a production data generator — demos are tagged, isolated, reversible.
- Not a new outcomes model — that is Epic D; A generates the substrate D will surface.

## 9. Open questions
1. Demo isolation: a reversible `source:"demo"` tag on the single org (simple, chosen here) vs. a
   dedicated demo deployment (cleaner, heavier). Leaning tag + guardrail for P1.
2. Flavor provenance: hand-curated vs. one-time LLM-generated-then-reviewed. Leaning derived
   default always valid + optional curated flavor (coverage now, fidelity incremental).
3. Time dimension: static snapshot (P1) vs. the simulator's activity-over-time (P4) for animated
   demos.
