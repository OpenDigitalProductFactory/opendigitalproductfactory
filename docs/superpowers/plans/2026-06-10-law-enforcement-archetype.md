# Implementation Plan — Law-Enforcement Agency Archetype (no-CJI Phase 1)

- **Backlog item:** `BI-C1578821` (epic `EP-ARCH-8D4F2A`; triaged `build`, size `large`)
- **Design spec:** [`docs/superpowers/specs/2026-06-09-civic-and-member-governed-archetypes-design.md`](../specs/2026-06-09-civic-and-member-governed-archetypes-design.md) §7 (law-enforcement note), §10, §12 Phase 2 item 10
- **Depends on:** small-town public-sector base (merged — records-request, service-request-311, public-body-governance, fund-accounting all landed this session)
- **Date:** 2026-06-10

**HARD CONSTRAINT (spec §4.6, §13.6): Phase 1 stores NO criminal justice information.**
No case/incident records, no RMS, no evidence/BWC media, no NCIC/CAD. The activation
summary must state the CJIS Phase-2 gate explicitly. Anything touching case data is a
separate future spec + security review.

Substrate verdict (verify-substrate-first): **zero new Prisma models.** The police
archetype reuses the public-sector base surfaces (records-request, service-request,
public-body governance), the existing `Policy` / `PolicyAcknowledgment` models for policy
attestation, the existing `TrainingRequirement` model for POST hours, and seeds a
compliance pack on the existing Regulation/Obligation/Control substrate. The only genuinely
new thing is the archetype definition + the pack + a Community vocabulary skin. This is the
cheapest archetype of the initiative by design — the no-CJI scoping is what makes it small.

## Slice — archetype + compliance pack (one PR)

- `packages/storefront-templates/src/archetypes/public-sector.ts` — add
  `law-enforcement-agency`: axes `resident` / `public-body` / `statutory-fees-and-levies`
  / fund-accounting (via finance wiring, same as town); item templates are **non-CJI
  citizen intake only** — Request a Records Copy (with the LE exemption note),
  File a Compliment or Complaint, Alarm Permit Application, Public-Records Request,
  Community Concern; sections Hero / About the Department / Services & Programs /
  Command & Staff / Contact; vocabulary skin Community / Community Portal / Requests &
  Reports / Community Liaison. seededServiceCategories: Records, Permits, Community
  Programs, Professional Standards. **No capabilityOverride** — the public-body rules
  derive the right set; member-equity stays not-applicable.
- `apps/web/lib/storefront/archetype-vocabulary.ts` — `law-enforcement-agency` category
  suggestions; the Community vocabulary ships via the archetype `vocabulary` field
  (customVocabulary mechanism), same as utility/co-op.
- `packages/db/src/seed-law-enforcement-compliance.ts` — pack on the existing substrate,
  `industry: "public-safety"`:
  - `REG-US-STATE-POST` (Peace Officer Standards & Training): annual in-service training
    hours per officer, officer certification currency, decertification reporting,
    firearms/use-of-force qualification cadence.
  - `REG-US-LE-POLICY-ATTESTATION`: use-of-force policy issued + attested, body-worn-camera
    policy + retention schedule (state-configurable), pursuit policy, complaint-intake &
    internal-affairs process.
  - `REG-US-CJIS-READINESS` (**Phase-2 GATE, not a compliance claim**): a single readiness
    checklist obligation flagged as a future gate — MFA/advanced authentication, audit
    logging, encryption at rest/in transit, personnel screening — with applicability text
    stating "Required BEFORE any criminal-justice-information feature; Phase 1 stores no
    CJI." Category `operational`, frequency `event-driven`.
  Controls: POST Training Tracker (TrainingRequirement-backed), Policy Issuance &
  Attestation (Policy/PolicyAcknowledgment-backed), CJIS Readiness Checklist. Wired into
  seed.ts after the cooperative pack; pure-data integrity test.

## Verification

Package vitest + typecheck (storefront-templates, db) + full web vitest before push; then
fresh-runtime verification on the shared lease: onboard a police department, confirm
Community vocabulary, public-body governance surface (no member-equity, no records-request
*duty* removed — police DO answer records requests, so records-request stays active with
LE exemption handling), the non-CJI citizen items on the public site, a citizen
records-copy request landing in the queue, and the three compliance packs in the library
**including the CJIS readiness gate rendering as a Phase-2 item, not a satisfied control.**
Confirm no table persists CJI. Record evidence; close BI.

## Risks & rollback

- **CJIS over-claim** is the headline risk — mitigated by making the CJIS entry a single
  explicit readiness-gate obligation with applicability text that says "Phase 1 stores no
  CJI," verified live to render as a gate not a green control.
- Records-request applies to police (they have FOIA duties), unlike the co-op — so unlike
  the cooperative the police archetype keeps the Records Requests link. Confirmed by the
  derived capability set (public-body → records-request required).
- All additive (archetype + seed); revert the PR. No migration.
