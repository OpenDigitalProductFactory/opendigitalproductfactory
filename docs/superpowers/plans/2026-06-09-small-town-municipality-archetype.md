# Implementation Plan — Small-Town Municipality Archetype (Phase 1 of civic archetypes)

- **Backlog item:** `BI-8D477188` (epic `EP-ARCH-8D4F2A`; triaged `build`, size `xlarge`)
- **Design spec:** [`docs/superpowers/specs/2026-06-09-civic-and-member-governed-archetypes-design.md`](../specs/2026-06-09-civic-and-member-governed-archetypes-design.md) §7, §10, §11
- **Depends on:** BI-938D1B71 Phase-0 substrate (PR #1692) — governance axis, civic capability registry, fund-accounting COA fragment
- **Unblocks:** BI-0938EFF5 (municipal utility), BI-C1578821 (law enforcement) — both specialize this base
- **Date:** 2026-06-09

Grounded by direct exploration (hoa-property-management.ts precedent; `grep hoa-property-management`
across apps/web; Prisma schema sweep for Meeting/RecordsRequest/Budget/Fund models — none exist;
StorefrontInquiry at schema.prisma ~7516; licensing substrate at schema.prisma 2935–3359 with
`LicenseRequirementReference.archetypeCategories` filtering).

Substrate verdicts (verify-substrate-first):

| Surface | Verdict |
| --- | --- |
| Council meetings (agenda → meeting → minutes) | NEW thin model `GovernanceMeeting` — CalendarEvent is too generic for the linked workflow; one table (not three): bodyType, scheduledAt, agenda/minutes content + publication timestamps, status, attendees/decisions Json. Shared with the credit-union board workflow (BI-D9ACE184) by design. |
| Records requests (FOIA) | NEW thin model `RecordsRequest` — statutory deadline lifecycle, exemption/denial fields; nothing comparable exists (compliance models track recurring duties, not inbound requests). |
| Service requests (311) | REUSE `StorefrontInquiry` — already the intake + inbox pipeline (trades "Job Requests" pattern); department/type via formData; no new schema in this slice. |
| Budget-to-actual funds | `fund_accounting` finance profile consuming `LEDGER_COA_FRAGMENTS["fund-accounting"]` + minimal `FundBudgetLine` (orgId, fiscalYear, fund, accountCode, budgetedAmount) so the view has a budget side. No GL changes. |
| Permits & licenses | REUSE licensing substrate — seed `license_requirement_reference` entries with `archetypeCategories: ["public-sector"]`; no schema change. |

## Phase 1 — Archetype definition + category wiring (ships independently)

- `packages/storefront-templates/src/archetypes/public-sector.ts` *(new)* — `small-town-municipality`
  per the HOA shape: ctaType `inquiry`; itemTemplates = resident-facing services (Building Permit
  Application, Business License, Park Pavilion Reservation, Public Records Request, Report an Issue
  / 311, Utility Billing Inquiry); sectionTemplates hero/about/items("Departments & Services")/
  team("Council & Staff")/contact; formSchema with address + department select + description;
  activationProfile axes per spec §7 (resident / public-body / statutory-fees-and-levies /
  fund-accounting via finance wiring), portfolios (manufactureAndDeliver standard with
  request-to-fulfill), seededServiceCategories (Permits, Public Works, Parks & Recreation, Clerk,
  Court). Export from `archetypes/index.ts`; extend archetypes.test.ts invariants.
- Category wiring (all sites named by the hoa grep): `industries.ts` (+test), 
  `archetype-business-context.ts` INDUSTRY_PROFILES (+test), `marketing-playbooks.ts`,
  `lib/finance/setup-profile.ts` → `"public-sector": "fund_accounting"`,
  `WorkspaceCalendar.tsx` source defaults, `archetype-vocabulary.ts` CATEGORY_SUGGESTIONS.
- `packages/finance-templates/src/profiles.ts` — `fund_accounting` profile (archetypeCategory
  `public-sector`, `ledgerModel: "fund-accounting"`, COA seed = fund-accounting fragment,
  USD, dunning gentle, billingPatternProfile from statutory derivation); profile tests + count.
- `packages/db/src/seed-storefront-archetypes.ts` — verify the new archetype upserts (count
  assertion +1, silent-skip guard per the known failure class).

**Verification:** package vitest + typecheck green (storefront-templates, finance-templates, db,
web); seed test asserts the archetype row lands.

## Phase 2 — Civic Prisma models + town compliance pack

- `packages/db/prisma/schema.prisma` — `GovernanceMeeting`, `RecordsRequest`, `FundBudgetLine`
  (+ relations to Organization; semantic ids; indexes on org + status/dueAt) + migration.
- Town compliance pack seed on existing Regulation/Obligation models (spec §10): open-meetings
  notice deadline, records-request response deadline (org-configurable days), records-retention
  schedule, annual state-audit prep, procurement thresholds — `Regulation.industry:
  "public-sector"`, with seed-count test.
- State selection: `BusinessContext.stateCode` (nullable) + setup capture; obligations read the
  org-configured deadline rather than hardcoding 50 variants.

**Verification:** migration applies on shadow DB; db vitest green incl. new count assertions.

## Phase 3 — Capability surface UI v1 (capability-gated routes)

- First read how the partner-program surfaces gate routes/navigation (EP-PARTNER-CHANNEL Phase 1b
  implementation) and mirror that mechanism exactly — do not invent a parallel gate.
- `/meetings` (surface `meetings`): list + create meeting, agenda compose → publish (timestamp),
  record minutes → approve; driven by `GovernanceMeeting`.
- `/records-requests` (surface `records-requests`): intake queue with due-date countdown,
  status transitions (submitted → in-progress → fulfilled/denied/partially-fulfilled), denial
  reason capture.
- `/service-requests` (surface `service-requests`): StorefrontInquiry queue view re-labeled by
  vocabulary (inbox "Service Requests"), department filter from formData, close-with-note.
- Finance: Funds view section grouping COA by fund + budget-to-actual columns from
  `FundBudgetLine` (empty-state safe).
- Public storefront: Records-request + 311 intake land via the existing inquiry pipeline.

**Verification:** web typecheck + targeted vitest; surfaces hidden for non-public-body archetypes
(test via derived activations).

## Phase 4 — Licensing seed + functional verification (canonical runtime)

- `packages/db/data/license_requirement_reference.json` — town entries (business license,
  building permit, sign permit, special-event permit) with `archetypeCategories:
  ["public-sector"]`; seed-count test (BIAN §9.1 pattern).
- Functional verification per `dpf-verify-on-live-install` (preflight first; BLOCKED stop-rule):
  fresh-seed sandbox → onboard as Small Town → picker shows Public Sector + archetype; Residents
  vocabulary; meetings/records/service-request surfaces present and drive end-to-end (create
  meeting + publish agenda; file records request and watch deadline; file a 311 from the
  storefront and close it); Funds view renders with seeded COA; commercial archetype regression
  (salon unchanged). Record evidence on BI-8D477188 (dynamic-analysis prose).

## Risks & rollback

- **Scope blowout (xlarge):** Phases 1–2 are mechanical and shippable alone; Phase 3 is the bulk.
  Each phase is its own PR; stop-line after any phase leaves main consistent.
- **Surface→route gating mechanism assumption:** Phase 3 step 1 verifies the real mechanism before
  building; if partner-portal gating is bespoke, file the gap rather than forking a second gate.
- **Meeting model shared with member-governance:** `bodyType` enum covers council/board/committee
  so BI-D9ACE184 reuses the table — review that BI's needs before freezing the migration.
- **Silent seed skips:** count assertions on archetype, compliance-pack, and license seeds.
- **Rollback:** additive schema + seeds + routes; revert PR(s). Archetype rows soft-delete.
