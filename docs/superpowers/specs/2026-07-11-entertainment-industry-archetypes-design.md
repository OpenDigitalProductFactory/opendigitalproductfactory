# Entertainment-Industry Archetypes — Media & Production + Live Events & Venues

**Date:** 2026-07-11
**Status:** Implemented
**Area:** `packages/storefront-templates` archetype taxonomy
**Decision surface:** `archetype-taxonomy-design` (kernel-routed via `principle_decide`)

## Goal

Add archetype companies for the entertainment industry: the businesses that
support production of movies, commercials, and events, that sell tickets for
venues, and that arrange tours. Before this change the taxonomy had no
entertainment coverage — the closest fits were `professional-services`
(generic project work) and a single `events-venue → professional-services`
keyword alias in the web-enrichment map.

## Business landscape (research)

Two structurally distinct clusters emerged from the research:

**Production side — businesses that MAKE the content**
- Film / commercial / branded-video **production companies** (pre-production →
  shoot → post → deliver).
- **Post-production & VFX studios** (edit, color, VFX, sound, finishing).
- **Event production, AV & staging** houses (stage, lighting, sound, LED for
  concerts, conferences, festivals).
- **Production-equipment rental** houses (camera / lighting / grip / audio) —
  a support business that is a *rental* value stream, not a production one.

**Live side — businesses that SELL the show**
- **Ticketed event venues / box offices** (theatres, concert halls, live-music
  clubs) — sell tickets, finite seated/GA capacity.
- **Concert promoters / tour operators** — arrange tours, book talent + venues,
  carry box-office risk, sell tickets across dates.
- **Talent & booking agencies** — represent performers, place them into gigs.

Sources: production-support directories (ProductionHub, film-office resource
lists), event-industry overviews (Umbrex, IBISWorld concert & event promotion),
live-music industry glossaries, and the CRS report on live-event ticketing
(primary vs secondary market, box-office revenue model).

## The decision — taxonomy shape (kernel-routed)

The `ArchetypeCategory` union is a closed type read by ~16 category-keyed files.
Three candidate shapes were scored through `principle_decide`
(`callingPopulation: external_coding_agent`, `ringScope: [ring-3-archetype,
universal-ring]`) against the dimension registry:

1. **single-entertainment-category** — one heterogeneous `entertainment-events`
   category holding every leaf.
2. **two-homogeneous-categories** — `media-production` (project-based) +
   `live-events-venues` (event-driven ticketed).
3. **tight-single-plus-reuse** — one small live category and force production
   leaves into `professional-services`.

**Feature vectors** (0..1 per axis; `blast_radius` / `human_cognitive_load` are
cost axes): option 2 scored highest on `long_term_maintainability` (0.85) and
`schema_grounding` (0.85) at the cost of a larger `blast_radius` (0.7).

**Result:** the kernel recommended **two-homogeneous-categories** — composite
1.920, margin 0.516, **confidence high**, strong structured coverage, no
commandment conflict ("Architecture Over Shortcuts" pulled toward the clean
split). This mirrors the Gap-B precedent that split three field-dispatch
categories rather than collapsing them into one.

The two-category split is accurate because value-stream derivation
(`operational-value-stream.ts`) keys its category defaults on the category, and
homogeneous categories make those defaults correct rather than approximate:

| Category | commercial model | demand | capacity |
|---|---|---|---|
| `media-production` | transactional (project) | seasonal | billable-hours |
| `live-events-venues` | transactional (ticket) | event-driven | physical-hard-cap |

Production-equipment rental was **reused** into the existing `asset-rental`
category (a new `production-equipment-rental` leaf) rather than duplicated — the
reserve → hand out → use → return → inspect → re-pool value stream already fits,
which the reusability axis and the verify-substrate-first commandment both favour.

## Leaves shipped

`media-production`:
- `film-video-production` — Film & Video Production Company (inquiry / quote)
- `post-production-studio` — Post-Production & VFX Studio (inquiry / quote)
- `event-production-staging` — Event Production, AV & Staging (quote)

`live-events-venues`:
- `event-venue` — Event Venue & Box Office (purchase / tickets)
- `tour-promoter` — Concert Promoter & Tour Operator (purchase / tickets)
- `talent-booking-agency` — Talent & Booking Agency (inquiry)

`asset-rental` (reused):
- `production-equipment-rental` — Film & Production Equipment Rental (rental)

## Touchpoints wired

**Required (compile / test gates):**
- `packages/storefront-templates/src/types.ts` — `ArchetypeCategory` union.
- `packages/storefront-templates/src/archetypes/index.ts` — register both modules.
- `apps/web/lib/storefront/industries.ts` (+ `industries.test.ts` length 19→21).
- `packages/db/src/wiki-taxonomy.ts` — `PROFESSION_ARCHETYPES` (enforced by the
  profession-archetype-axis test to equal the categories present in
  `ALL_ARCHETYPES`).

**Populated for correct runtime/UX (graceful-default otherwise):**
- `operational-value-stream.ts` — category-default commercial model / demand /
  capacity for both categories.
- `apps/web/lib/storefront/archetype-vocabulary.ts` — category vocabularies.
- `packages/finance-templates/src/profiles.ts` + `apps/web/lib/finance/setup-profile.ts`
  — `media_production` and `live_events_venues` finance profiles with distinct
  chart-of-accounts, mapped by category.
- `apps/web/lib/tak/marketing-playbooks.ts` — category playbooks.
- `apps/web/lib/onboarding/archetype-business-context.ts` — WWWD starter doctrine.
- `apps/web/lib/integrate/contribution-review.ts` — hive vertical tagging.
- `apps/web/lib/public-web-tools.ts` — web-enrichment keyword map (re-pointed the
  stale `events-venue` alias to `live-events-venues`).

Remaining category-keyed maps (supply manifest, business-capability
perspectives, retention floors, risk posture, EA reference models,
`INDUSTRY_TO_MODELS`) fall back to safe defaults and can be enriched later.

## Verification

- `packages/storefront-templates` `archetypes.test.ts` (catalog invariants) +
  a new test asserting the entertainment leaves, their categories, and axes.
- `industries.test.ts` (count + slug presence).
- `profession-archetype-axis.test.ts` (axis == categories in `ALL_ARCHETYPES`).
- Typecheck across the touched packages.
