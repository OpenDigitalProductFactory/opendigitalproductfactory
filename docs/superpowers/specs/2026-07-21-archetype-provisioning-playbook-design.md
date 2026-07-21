# Archetype Provisioning Playbook — the repeatable recipe for adding a business archetype

**Date:** 2026-07-21
**Status:** Implemented
**Area:** `packages/dpf-skill-pack` (paved-road skill) + `scripts/` (completeness gate) + `docs/professions` (corpus)
**Decision surface:** `archetype-provisioning-playbook-design`
**Related:** [`2026-07-07-coworker-lifecycle-standard-design.md`](2026-07-07-coworker-lifecycle-standard-design.md) (the coworker-side precedent this mirrors), [`2026-07-21-warehousing-fulfilment-archetype-design.md`](2026-07-21-warehousing-fulfilment-archetype-design.md) (the archetype that exposed the gap).

## Problem

Adding a business archetype is a recurring growth motion, and it is not
repeatable. Eleven archetype design docs each re-derive the same ~16
category-keyed touchpoints by hand, from memory or by grepping a prior one.
There is no paved road, no checklist, and no gate — so an archetype can ship
**structurally present but functionally shallow**, and the most recent one did:
`warehousing-fulfilment` (merged 2026-07-21) shipped the template substrate with
**zero** profession corpus and **no** coworker decision recorded.

This is exactly the failure the **coworker** side already solved. Before the
2026-07-07 Coworker Lifecycle Standard, a coworker could be created ad hoc and
ship incomplete; the `establish_coworker` factory door + CI conformance gate +
nightly certification closed it. Archetypes have no equivalent. This spec builds
the archetype-side paved road and completeness gate, deliberately modelled on
the coworker one.

## The four provisioning dimensions of an archetype

An archetype is not just a template. A *complete* archetype provisions four
things, and only the first has any tooling today:

| # | Dimension | Where it lives | Prior state |
|---|---|---|---|
| 1 | **Template substrate** | `ArchetypeCategory` union, leaves, axes, capabilities, value-stream defaults, twin, + the category-keyed consumer maps | hand-rolled, ~16 files |
| 2 | **Profession corpus (WSID)** | `docs/professions/<family>/wiki/*.md` with `professionArchetype:` frontmatter | **19 of 22 categories have zero pages** |
| 3 | **AI coworker** | `COWORKER_AGENT_SEEDS` + `establish_coworker` door (its own lifecycle) | no per-archetype coworker decision recorded |
| 4 | **Skills & tools** | `skills/<category>/*.skill.md` + `manage_coworker_tool_grant` | ad hoc |

The measured evidence (2026-07-21, `scripts/check-archetype-completeness.mjs
--report`): dimension 1 is universally present (a broken touchpoint breaks the
build, so it self-enforces); dimensions 2–4 are sparse and uneven.

## The decision — two-tier enforcement (fleet-safe)

The naive move — one gate that blocks every category on the full four-dimension
floor — is unsafe. With 19 of 22 categories at zero corpus, it would turn `main`
red on the first run and block every unrelated PR until a 19-category corpus
backfill program completed. That wedges the forward chain, which the fleet-safe
schema-evolution discipline (`2026-07-03-fleet-safe-schema-evolution-design.md`)
forbids in spirit: a tightening that fails on existing state freezes the busiest
work, not just the offending change.

The floor is therefore **split by how universally the dimension is already
satisfied**, following the established ratchet precedent already blessed in this
repo (`check-module-size.mjs`, `check-no-raw-route-error.mjs` — freeze a
baseline, block *new* debt, let existing debt ratchet down):

### Tier 1 — Structural completeness → blocks ALL categories

The load-bearing category-keyed maps that a functioning archetype already
satisfies (or it would be broken). Every category must appear in each. Blocking
all is safe because all already pass. Required set:

- `ArchetypeCategory` union (`packages/storefront-templates/src/types.ts`)
- registered in `ALL_ARCHETYPES` via a leaves module
- `PROFESSION_ARCHETYPES` (`packages/db/src/wiki-taxonomy.ts`)
- `INDUSTRY_OPTIONS` (`apps/web/lib/storefront/industries.ts`)
- a finance profile — **either** a bespoke `archetypeCategory` entry in
  `packages/finance-templates/src/profiles.ts` **or** a category default the
  derivation path covers (the gate accepts either; not every category needs a
  bespoke chart of accounts)
- a value-stream commercial-model resolution (bespoke default **or** the
  documented `?? "transactional"` fallback — the gate asserts the category is
  *reachable*, not that it overrides)
- a `deriveTwinProfile` template mapping (total function — asserted by the
  existing twin totality test, referenced here so the floor is one list)

Tier 1 is a *presence* check, not a *quality* check: it catches the "added the
union member, forgot the industries option" class mechanically, which is half of
what every archetype PR gets wrong.

### Tier 2 — Provisioning depth → blocks NEW categories, ratchets existing

Dimensions 2–4. The gate freezes today's reality in a checked-in baseline
(`scripts/archetype-completeness-baseline.txt`, one `<category>\t<state>` line
per category, `merge=union` so concurrent PRs don't collide) and enforces:

- A category **absent from the baseline** (i.e. new) must meet the full depth
  floor: **≥1 WSID corpus page** declaring it in `professionArchetype`, **and**
  a recorded **coworker decision** (either a `COWORKER_AGENT_SEEDS` entry scoped
  to it, or an explicit `archetype-coworker-decision:` note in its design doc
  stating which existing coworker serves it and why no new one is needed).
- A category **in the baseline** may not regress below its recorded state, and
  the baseline may only shrink (a category that gains corpus is removed from the
  grandfather list; `--update` regenerates).

This is "block for all" in the sense that matters: **no new archetype can ship
shallow**, and the 19 existing gaps are visible, enumerated, and ratcheting
down — not silently tolerated.

### Proof-of-recipe backfill

To prove the floor is real and the recipe runs end-to-end, `warehousing-
fulfilment` is backfilled in this same change: four WSID corpus pages
(dock-to-stock discipline, goods-in-trust liability, cold-chain GDP integrity,
bonded/duty-suspended control) and a recorded coworker decision. It comes off
the grandfather baseline, so the newest archetype is the first to meet the full
four-dimension floor.

## The paved road — `dpf-add-archetype` skill

A user- and agent-invocable skill in the DPF skill pack, mirroring
`dpf-establish-coworker`'s shape and composing the existing DPF skills rather
than re-inventing steps:

1. **Verify it doesn't exist** — compose `dpf-verify-substrate-first`. Most
   "new archetype" ideas are a missing *leaf* on an existing category, or a
   variant expressible by an axis value. (Warehousing was a genuine new
   category; the `freight-brokerage` sibling was correctly a leaf.) Watch for
   name-collision false positives in the other direction — `inventory-
   specialist` is the *IT-estate* coworker, not a warehouse one.
2. **Research + route the taxonomy shape** — compose `dpf-decision-via-kernel`
   (`principle_decide`, `ringScope: [ring-3-archetype, universal-ring]`) over
   2–4 candidate shapes. Record the ledger id in the design doc.
3. **File the BI + write the design doc** — compose `dpf-file-backlog-item` and
   `dpf-writing-plans`; the doc names the four-dimension provisioning plan, not
   just the template.
4. **Implement the template substrate** — the ~16 touchpoints, enumerated in the
   skill's checklist (Tier 1 list above, plus the graceful-default consumers).
5. **Provision the corpus** — ≥1 WSID page per the frontmatter contract, bound
   via `professionArchetype`, family registered in `docs/professions/
   registry.json`.
6. **Decide the coworker** — extend an existing coworker (record why) or run
   `dpf-establish-coworker` for a new one. Either way the decision is recorded.
7. **Run the gate + finish** — `node scripts/check-archetype-completeness.mjs`,
   then `dpf-pr-with-dco`.

The skill carries the authoritative checklist; the gate enforces the mechanical
subset. That division mirrors coworkers exactly: the skill guides, the
conformance gate blocks.

## Touchpoints wired (this change)

- `packages/dpf-skill-pack/skills/dpf-add-archetype/SKILL.md` (+ pack manifest).
- `scripts/check-archetype-completeness.mjs` + `.test.mjs` +
  `archetype-completeness-baseline.txt` + `.gitattributes` `merge=union` +
  CI wiring (a required Unit-Tests-adjacent step).
- `docs/professions/operations/wiki/warehouse-*.md` (×4) — the backfill.
- Coworker decision for `warehousing-fulfilment` recorded (see §backfill).
- `AGENTS.md` — pointer to the skill under the archetype guidance.

## Non-goals

- Backfilling corpus for the other 18 grandfathered categories — that is a
  tracked program (one BI per profession family), not this change. The baseline
  makes the debt explicit and blocks it from growing.
- Auto-generating template substrate (a scaffold generator). The skill checklist
  + Tier-1 gate make the manual path reliable; a generator is a later
  optimisation once the shape has stopped moving.
- Changing the coworker lifecycle. Dimension 3 delegates to the existing
  `establish_coworker` door unchanged.
