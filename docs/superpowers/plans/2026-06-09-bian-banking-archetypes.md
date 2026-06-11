# Implementation Plan — BIAN-Grounded Banking Archetypes

- **Backlog item:** `BI-5D9DCDE6` (epic `EP-ARCH-8D4F2A` — Archetype Model V2: Unified Business Archetypes; triaged `build`, size `large`)
- **Design spec (source of truth for shape):** [`docs/superpowers/specs/2026-06-09-bian-banking-archetypes-design.md`](../specs/2026-06-09-bian-banking-archetypes-design.md)
- **Reference data:** [`docs/Reference/bian/bian-v14-service-landscape.json`](../../Reference/bian/bian-v14-service-landscape.json) — the canonical BIAN v14 hierarchy + descriptions; all Service Domain → Business Domain placements MUST be read from this file, not from prose.
- **Date:** 2026-06-09

Every "touch file X" claim below was grounded by direct read/grep in the authoring session
(sweep key: `grep -r "hoa-property-management"` — the newest end-to-end category precedent).

## Phase 0 — Reference data + spec + plan (ships independently; THIS PR)

**Deliverable:** `docs/Reference/bian/` (landscape JSON + README), the v7.6 BIAN/CSDM
integration PDF (Git LFS — `.gitattributes` already routes `*.pdf` to LFS), the design
spec, this plan, and BI-5D9DCDE6 filed + triaged.

**Verification:** docs-only PR passes CI; LFS object uploads (confirm `git lfs ls-files`
shows the PDF post-commit); JSON validates (`python -m json.tool`); counts in README match
JSON `counts` field (8 / 43 / 341 / 258).

## Phase 1 — Archetype definitions (`packages/storefront-templates`)

**Files:**
- `src/types.ts` — add `"banking-financial-services"` to `ArchetypeCategory`,
  `"disclosures"` to `SectionType` (spec §9.3), and optional
  `vocabulary?: Partial<ArchetypeVocabulary>` on `ArchetypeDefinition` (spec §7.4).
- `src/archetypes/banking-financial-services.ts` *(new)* — `community-bank`,
  `credit-union`, `mortgage-lending` per spec §7: shared axes (`account-with-kyc`,
  `account-based-fees`, multi-channel), item templates named from BIAN *Loans and
  Deposits* / *Cards* Service Domains, booking items for banker/advisor/loan-officer
  appointments (30 min), inquiry forms with product-interest / field-of-membership /
  loan-purpose selects, `seededServiceCategories` as kebab-case BIAN domain names.
- `src/archetypes/index.ts` — import + spread into `ALL_ARCHETYPES`.
- `src/archetypes/archetypes.test.ts` — extend coverage (unique ids, category validity,
  section sortOrder monotonicity, booking items carry durations — match existing
  invariants in that file).

**Verification:** `pnpm --filter @dpf/storefront-templates exec vitest run` green;
`pnpm --filter @dpf/storefront-templates typecheck` green (source-local gates, worktree OK).

## Phase 2 — BIAN capability perspective + seed rules (`packages/db`)

**Files:**
- `src/business-capability-perspectives.ts` — new `BIAN_BANKING_V14` perspective
  (`perspectiveId: "bian-banking-v14"`, source string citing the reference JSON);
  L1 Business Areas / L2 Business Domains / L3 Service Domains per spec §8 with
  descriptions copied from the reference JSON; resolution: `category ===
  "banking-financial-services"` composes `[COMMON_SMALL_BUSINESS, BIAN_BANKING_V14]`
  (same composition pattern as the MSP overlay — read `resolveBusinessCapabilityPerspective`
  before wiring).
- `test/business-capability-perspectives.test.ts` — resolution test for the new category;
  key-uniqueness and parentKey-integrity invariants over the new definitions.
- `src/seed-storefront-archetypes.ts` — `MARKETING_SKILL_RULES["banking-financial-services"]`
  regulated-communication reframes per spec §7.5 (mirror the `healthcare-wellness` entry
  shape); upsert writes each leaf's `vocabulary` override into
  `StorefrontArchetype.customVocabulary` (spec §7.4 — credit-union "Members" labels), with
  a seed test asserting the override lands.

**Verification:** `pnpm --filter @dpf/db exec vitest run` green. Seed-count assertion:
seeding logs `upserting N storefront archetypes` with N increased by exactly 3 and zero
silently-skipped rows (guard against the silent-seed-skip failure class — assert in test,
don't eyeball logs).

## Phase 2b — Regulatory & jurisdictional governance (spec §9)

**Files:**
- `packages/db/data/license_requirement_reference.json` — banking authority entries per
  spec §9.1 (`archetypeCategories: ["banking-financial-services"]`; US OCC/FRB/FDIC/NCUA/
  CFPB/FinCEN/NMLS-org/NMLS-MLO/CSBS-state/Equal-Housing; GB FCA+PRA; EU EBA; CA OSFI;
  AU APRA — official source URLs only, directory doctrine, `displayRuleSummary` carries
  the Member-FDIC / NCUA-sign / NMLS-ID / Equal-Housing display obligations).
- `packages/db/src/seed-license-requirements.ts` test — count assertion that the banking
  rows upsert (silent-seed-skip guard).
- Onboarding flow — **required** jurisdiction/charter capture step for this category per
  spec §9.2: jurisdiction (default from org location), charter type per leaf, derived
  regulator + insurance-regime suggestion with §9.1 entries attached, credential ids
  (FDIC cert / NCUA charter / NMLS ID) stored as licensing-substrate credential rows.
  Wiring point (verified): extend `apps/web/components/compliance/OnboardingWizard.tsx`
  (`/compliance/onboard`, `OnboardingDraft` persistence) and persist to
  `OrganizationLicenseProfile` / `OrganizationLicenseRecord` / `PersonLicenseRecord` /
  `LicenseDisplayObligation` — reuse `EP-LIC-C64FC2` domain model; do not invent a
  parallel store. Per spec D5 the step never hard-blocks activation.
- Leaf `sectionTemplates` — add the "Disclosures" section using the new first-class
  `disclosures` SectionType (spec §9.3); render the case in
  `apps/web/components/storefront/SectionRenderer.tsx` from `LicenseDisplayObligation`
  rows, with the D5 neutral-placeholder state when posture is uncaptured.

**Verification:** `pnpm --filter @dpf/db exec vitest run` green including the new
count assertion; onboarding-context tests cover the banking profile (§9.5).

## Phase 3 — Finance profile (`packages/finance-templates`)

**Files:** `src/profiles.ts` — `banking-financial-services` profile (interest income,
fee income, interest expense, provision expense categories; account-based revenue
recognition; matching the shape of existing entries keyed by `archetypeCategory`);
`src/profiles.test.ts` — coverage.

**Verification:** package vitest + typecheck green; `getFinancialProfile("community-bank")`
resolves (confirm the lookup key is archetype slug vs category by reading
`normalizeFinancialProfile` first — the existing file keys `PROFILES` by archetype slug
in some entries; match reality, not this plan).

## Phase 4 — Portal wiring (`apps/web`)

**Files (sweep `grep -r "hoa-property-management" apps/web` at build time for the full
list; known from the authoring-session sweep):**
- `lib/storefront/industries.ts` + `industries.test.ts` — "Banking & Financial Services".
- `lib/storefront/archetype-vocabulary.ts` — vocabulary per spec §7.4.
- `lib/onboarding/archetype-business-context.ts` + test — onboarding context for the category.
- `lib/tak/marketing-playbooks.ts` — category playbook entry.
- `lib/finance/setup-profile.ts` — category → finance-profile wiring.
- `lib/public-web-tools.ts`, `components/workspace/WorkspaceCalendar.tsx`,
  `app/(shell)/admin/business-models/page.tsx` — verify whether each branches on category;
  extend only where a category switch exists (do not invent surface area).

**Verification:** `pnpm --filter web typecheck` (worktree) green; `pnpm --filter web build`
via the shared local-CI convergence sandbox lease
(`claim_nonprod_environment_lease(environmentKey="local-integration-ci")`) — NOT in the
worktree; targeted vitest for the touched libs.

## Phase 5 — Functional verification (canonical runtime)

Per `structural-verification-is-not-functional` and the `dpf-verify-on-live-install`
skill (step zero: `pnpm verify:preflight`, honor the BLOCKED stop-rule):

1. Fresh-seed or re-seed the leased sandbox; confirm 3 new archetypes in the picker and
   the banking license-requirement rows seeded (count query, not log eyeballing).
2. Onboard as **Credit Union** → the required jurisdiction/charter step captures
   "US / federal credit union" and derives NCUA + NCUSIF posture with the right reference
   entries attached; items surface shows member vocabulary ("Share Savings", inbox
   "Applications"); capability page shows BIAN-sourced perspective composed with the
   common baseline, with regulatory posture attached to the Compliance-domain capabilities.
3. Confirm the storefront Disclosures section renders the NCUA official sign + Equal
   Housing content from the captured posture.
4. Drive a storefront inquiry end-to-end on a share-certificate item; confirm intake lands.
5. Record evidence via the MCP evidence tools against BI-5D9DCDE6 (dynamic-analysis prose
   report, not screenshots).

## Risks & rollback

- **Vocabulary is category-keyed; credit-union wants "Members" while banks want
  "Customers".** Decided per spec §7.4 (EA review pass): seed the leaf's
  `vocabulary` override into `StorefrontArchetype.customVocabulary` — the column and the
  `getVocabulary()` read path already exist; no blended "Customers & Members" label.
  Scope is one optional `ArchetypeDefinition` field + seed write + test; anything beyond
  that (per-leaf static maps, new resolution layers) is out of scope — file a follow-up
  BI if tempted.
- **Silent seed skips** (known DPF failure class): a typo'd category or FK mismatch can
  upsert 0 rows without erroring. Mitigation: Phase 2's count assertion in tests.
- **Enum sweep completeness:** a missed category switch (e.g. a hardcoded
  `ArchetypeCategory` exhaustiveness check) breaks typecheck — that is the desired
  failure mode; fix every site the compiler names.
- **LFS on CI:** if a CI job lacks `git lfs`, the PDF checks out as a pointer file —
  harmless for build jobs (nothing imports it); verify no doc-lint job reads PDF bytes.
- **Regulatory display correctness:** disclosure content (Member FDIC wording, NCUA sign,
  NMLS ID placement) must follow the official sources named in the reference entries —
  never paraphrase a regulated statement. The entries are directories, not legal advice;
  the operator's compliance officer owns final wording. Mitigation: render
  operator-confirmed posture only; never auto-assert insurance membership.
- **Onboarding-step coupling:** the required jurisdiction step depends on the licensing
  substrate's credential model (`EP-LIC-C64FC2`). If the coworker investigation flow
  (BI-LIC-3621D8) hasn't landed, implement the capture step against the existing domain
  tables directly and leave the investigation handoff as the follow-up — do not block the
  archetype on the licensing epic's full scope.
- **Rollback:** all changes are additive seed/template/wiring code on one branch — revert
  the PR. Seeded archetype rows are soft-deletable (`isActive: false`); re-seed does not
  resurrect operator-deactivated archetypes (existing invariant).

## Definition of done

BI-5D9DCDE6 acceptance criteria, verbatim: 3 archetypes seeded + idempotent re-seed;
BIAN perspective composed on the capability page; credit-union vocabulary + end-to-end
storefront inquiry functionally verified on canonical runtime; all wiring-contract
touchpoints tested.
