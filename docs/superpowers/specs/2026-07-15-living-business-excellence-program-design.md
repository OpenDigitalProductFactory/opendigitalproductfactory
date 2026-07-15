# The Living Business Excellence Program — grounded, primed, rehearsable twins (design)

**Status:** proposed (parent program spec)
**Epic:** EP-LIVING-BUSINESS-EXCELLENCE (proposed)
**Parent:** [Operational Twin Framework](2026-07-12-operational-twin-framework-design.md) · [The Living Business — value-stream workforce visualization](2026-07-11-living-business-workforce-visualization-design.md)
**Started:** 2026-07-15

## 1. Why this exists

EP-LIVING-BUSINESS-VIZ shipped the operational twin end to end: every archetype derives a
twin (P1), a grammar kit renders it (P2), one `TwinView` serves all 12 templates (P3), and it
runs live on the `/workspace` home from real substrate (P3·2a–2c). It is beautiful and it works.

But a founder review surfaced three gaps that stand between "it works" and **"a customer is
delighted the first time they see their business."** All three are about *grounding, priming,
and rehearsing* — not about the renderer:

1. **The twin is not grounded in each business's real process.** The per-archetype "process
   diagram" is the OVSM value stream (`deriveOperationalValueStream`) — a generic 6-stage
   backbone with the *same box labels* for a clinic, a law firm, and a food truck. The twin
   (`deriveTwinProfile`, spatial zones/queues) and the value stream (linear stages) are two
   sibling derivations with **no mapping between them** — so the animation and the "architecture
   view" are two unrelated pictures, neither nuanced per business model.
2. **A new business starts closer to a blank slate than it should.** A per-archetype stance
   *priming* mechanism exists (`seedOrgWwwdCorpus` seeds a new org's WWWD corpus at unconfirmed
   B/0.6, upgraded to A/0.9 on owner confirmation), but it is thin — 5 stance vectors + 4 identity
   pages, rich only for ~8 flagship slugs — and there is **no "what excellence looks like"**
   construct (benchmarks, north-star KPIs, good-operator moves) per archetype.
3. **We cannot cheaply see, test, or iterate a realistic business per archetype.** Seeded
   operational demo data (staff/customers/bookings/finance) exists for **0 of 94 archetypes**;
   the review harness (`/admin/twin-kit`) shows generic fixtures, not persona'd businesses; and
   the twin's cog/quests are not wired to the real WWWD gate (spec-only), with no
   customer-outcome model behind them.

**The thesis:** delight comes from connecting four things that are currently disconnected —
`archetype process` ⟂ `twin animation` ⟂ `WWWD corpus` ⟂ `outcomes` — into **one grounded,
primed, rehearsable system**. A dentist opens DPF and sees *their* twin, its tiles mapped to
*their* real value-stream stages, pre-loaded with a credible picture of a well-run practice, an
AI cog already proposing the moves a good operator would make — moves that pass *their* primed
stance — and outcomes (revenue, jobs delivered) visibly accruing. Blank slate is the enemy of
delight; a curated exemplar is the delight.

## 2. The four epics (intrinsic to one another)

These are one program. Each depends on and reinforces the others; sequencing is about the most
effective *test-bench-first* order, not independence.

| Epic | What it delivers | Depends on | Enables |
|---|---|---|---|
| **A — Archetype Demo Factory** (`EP-ARCHETYPE-DEMO`) | Deterministic per-archetype demo businesses (staff/customers/bookings/finance) + a load path + a review-at-scale harness. The **test-bench** for the whole program. | twin (shipped), the excellence corpus (B) for flavor | Rehearse & regression-test A/C/D across all 94 |
| **B — Excellence Corpus** (`EP-EXCELLENCE-CORPUS`) | Per-archetype "what great looks like": mission, stance vectors + ceilings, north-star KPIs, good-operator moves — seeded through the existing `seedOrgWwwdCorpus` path at B/0.6. **Priming, not blank slate.** | existing stance-seed substrate (shipped) | Flavor for A; primed cog for D; grounded metrics for C |
| **C — Ground the Twin in the Process** (`EP-TWIN-GROUNDING`) | Bind `deriveTwinProfile` zones/queues to `deriveOperationalValueStream` stages so the twin's tiles map to the archetype's real value-stream stages (queue depth + wait *per stage* — the factory-automation lens). Unifies architecture-view and animation-view. | twin + OVSM (both shipped) | Per-stage flow in A's demos; per-stage outcomes in D |
| **D — WWWD Outcomes Loop** (`EP-TWIN-WWWD-OUTCOMES`) | Wire the twin's cog/quests through the real WWWD gate (`evaluate_org_business_decision`); add a customer-outcome surface (`Invoice.paidAt` revenue, work completed) so decisions are stance-gated and outcomes are visible. | WWWD gate (shipped), B (primed stance), A (demo to exercise it) | "Real customer outcomes being delivered" made visible |

Dependency shape: **B feeds A** (flavor) **and D** (primed stance); **A is the test-bench for
C and D**; **C and D enrich what A rehearses**. So B and A are the load-bearing first moves, with
A prioritized because it lets us *exercise and verify* everything else.

## 3. Sequencing (founder-directed: demo first)

1. **A — Archetype Demo Factory (first).** It is the test-bench: without a cheap way to stand up
   a realistic business per archetype, we cannot judge whether B/C/D actually produce delight.
   Its own spec — [2026-07-15-archetype-demo-factory-design.md](2026-07-15-archetype-demo-factory-design.md)
   — leads on the **scalability** constraint below.
2. **B — Excellence Corpus**, built alongside A (A consumes B's per-archetype flavor; the same
   curated content primes WWWD). Start with the 21 categories + the ~8 flagship slugs already
   authored, then fan out.
3. **C — Grounding** and **D — WWWD Outcomes**, each verified *through* A's demos.

## 4. The scalability constraint (the program's central risk)

The founder's stated biggest worry: **"an effective way to test and iterate each archetype
without a massive effort."** With 94 archetypes across 21 categories, any approach whose cost is
*O(94 × hand-built business)* fails. The whole program is designed around one rule:

> **Derive, don't author.** Every per-archetype artifact — demo business, twin grounding,
> primed corpus — is *derived* from the archetype's own structure (definition, OVSM, twin
> profile, playbooks) by one generator, with only a **thin per-archetype "flavor" layer**
> authored (a company name, a few real-sounding staff/customers, signature offerings). Marginal
> cost per archetype is a small data file, not a build.

This is the same "derive-with-override" discipline the twin itself already follows
(`deriveTwinProfile`, `deriveOperationalValueStream`, `deriveFieldDispatchProfile`,
`deriveMediaProfile` — ADR-4). The demo factory adds `deriveDemoBusiness`; the corpus adds
`deriveExcellenceCorpus`; both take the same thin flavor overrides. **Reviewing at scale** is
solved the same way: a deterministic generator makes **golden snapshots** per archetype (loop
94, assert non-degenerate) and a **gallery** renders all 94 twins on one page — so a reviewer
scans the whole catalog in minutes and regressions are caught automatically, without standing up
94 businesses by hand.

## 5. Non-goals

- Not a rebuild of the twin renderer (shipped) — this program grounds, primes, and rehearses it.
- Not a real-data BI/analytics suite — outcomes (D) surface the finance/work substrate the twin
  already touches, not a new warehouse.
- Not 94 bespoke demo businesses — that is the anti-pattern §4 exists to prevent.

## 6. Open questions

1. Flavor authoring: pure-derived default vs. a one-time LLM-generated-then-reviewed flavor file
   per archetype? (Leaning: derived default that is always valid, with an optional curated flavor
   that raises fidelity — so coverage is 94/94 from day one and flavor is incremental.)
2. Demo isolation on a single-org deployment: a reversible "demo mode" org vs. a dedicated demo
   deployment? (Deferred to the demo-factory spec §.)
3. How much of C (grounding) is a `TwinProfile` change vs. a render-time mapping? (Deferred to
   the grounding spec.)
