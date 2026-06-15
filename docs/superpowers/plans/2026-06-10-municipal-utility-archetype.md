# Implementation Plan — Municipal Utility Archetype

- **Backlog item:** `BI-0938EFF5` (epic `EP-ARCH-8D4F2A`; triaged `build`, size `large`)
- **Design spec:** [`docs/superpowers/specs/2026-06-09-civic-and-member-governed-archetypes-design.md`](../specs/2026-06-09-civic-and-member-governed-archetypes-design.md) §7, §10, §11
- **Builds on (all merged):** BI-938D1B71 substrate (#1692), BI-8D477188 small-town base (#1695–#1698) — public-body governance, records requests, 311 queue, fund-accounting profile, civic compliance seeder, licensing entries
- **Date:** 2026-06-10

The utility specializes the small-town base: same `public-sector` category, same `resident` +
`public-body` axes, but `commercialModel: usage-based` (rules engine already derives the
usage-based billing profile — covered by the Phase-0 fixture) and a ratepayer/service-order
vocabulary skin.

## Phase 1 — Vocabulary-override mechanism (the BIAN-agreed shape)

`StorefrontArchetype.customVocabulary` + `getVocabulary()` already exist; what's missing is
the declaration path from an `ArchetypeDefinition` into the seed (BIAN plan Phase 1/2 specifies
it; that PR hasn't landed — whichever lands second adopts the other's shape, per the
coordination note in spec §6.2/§8).

- `packages/storefront-templates/src/types.ts` — `vocabulary?: Record<string, string>` on
  `ArchetypeDefinition` (portable JSON shape matching `customVocabulary`; apps/web's
  `ArchetypeVocabulary` keys are the legal key set, enforced by `getVocabulary`'s
  field-by-field merge which ignores unknown keys).
- `packages/db/src/seed-storefront-archetypes.ts` — upsert writes `customVocabulary` from
  the definition's `vocabulary` (create + update), with a seed-shape test (no DB) asserting
  the utility definition carries the override.

## Phase 2 — Archetype definition

`packages/storefront-templates/src/archetypes/public-sector.ts` — add `municipal-utility`:

- Axes per spec §7: services / physical / **resident** / onsite-plus-portal /
  **usage-based** / account-with-billing / no platform / **public-body**. Portfolios as the
  town (manufactureAndDeliver standard, request-to-fulfill).
- Items: rate schedules as items (Residential Water Service, Commercial Water Service,
  Irrigation Service — `priceType: from`), Service Connection / Tap Fee, Start or Stop
  Service, Report a Leak or Outage (the 311-style intake), Meter Re-Read Request.
- Sections: hero / About Our Utility / Rates & Services / Board & Staff / Contact.
- formSchema: contact + service address + request-type select (Leak, Outage, Low pressure,
  Meter re-read, Start service, Stop service, Billing question).
- `vocabulary`: stakeholderLabel **Ratepayers**, inboxLabel **Service Orders**, portalLabel
  Ratepayer Portal, itemsLabel Rates & Services, agentName Utility Services.
- `seededServiceCategories`: Residential, Commercial, Irrigation, Connection Fees, Service Orders.
- `CATEGORY_SUGGESTIONS["municipal-utility"]` in apps/web vocabulary file.
- Tests: positive derivation assertion (public-body set + usage-based billing profile from
  the definition's profile) alongside the small-town one.

## Phase 3 — Utility compliance pack

Extend `packages/db/src/seed-public-sector-compliance.ts` (idempotent, additive):

- `REG-US-EPA-SDWA` (Safe Drinking Water Act via state primacy): sampling schedule
  adherence (monthly), Consumer Confidence Report annual delivery, certified operator of
  record (continuous), Lead & Copper service-line inventory awareness (annual).
- `REG-US-EPA-NPDES` (Clean Water Act): discharge monitoring reports (monthly),
  permit renewal tracking (event-driven).
- New obligation on existing `REG-US-STATE-MUNI-FINANCE`: `muni-finance/rate-covenant` —
  debt-service-coverage monitoring against bond rate covenants (monthly).
- Controls: Sampling Calendar (backed by compliance calendar), DMR Filing Procedure,
  Rate-Covenant Coverage Check (backed by the Funds view).
- Update the pack data tests (regulation id list, obligation counts, link resolution).

## Phase 4 — Verification

Package vitest + typecheck (storefront-templates, db, web libs). Functional verification on
a fresh throwaway runtime (same harness as BI-8D477188, new lease): onboard as Municipal
Utility → picker shows it under Public Sector; **Ratepayers / Service Orders** vocabulary
live; activation preview derives public-body governance + records requests + 311 required
and **Usage Based** billing; rates items on the public site; report-a-leak lands in the
Service Orders queue; compliance library shows SDWA/NPDES packs; /finance/funds renders
(enterprise-fund framing). Evidence on BI, then close.

## Scope notes (recorded against the BI on close)

- **Ownership setup question (city/district/co-op flip to member-owned)**: deferred to the
  cooperative BI — per-org axis overrides don't exist in the substrate; electric co-ops
  enter via the `cooperative` archetype (spec §6.4 already endorses both paths).
- **Delinquency/disconnection statutory-notice flow**: no disconnection flow exists in DPF
  to gate (billing core is external per spec §5 non-goals); the statutory-notice gate ships
  when a disconnection surface exists. Service orders, rates, and compliance calendars are
  the v1 operating loop.
- **Utility-type multi-select**: v1 tailors via operator-editable items/categories (water
  default); a typed multi-select question needs the SetupWizard custom-question substrate.

## Risks & rollback

Additive definition + seed data + one optional field; revert the PR. Vocabulary field is
the BIAN-coordination surface — PR description flags it for the BIAN implementer.
