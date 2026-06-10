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
- `src/types.ts` — add `"banking-financial-services"` to `ArchetypeCategory`.
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
  shape).

**Verification:** `pnpm --filter @dpf/db exec vitest run` green. Seed-count assertion:
seeding logs `upserting N storefront archetypes` with N increased by exactly 3 and zero
silently-skipped rows (guard against the silent-seed-skip failure class — assert in test,
don't eyeball logs).

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

1. Fresh-seed or re-seed the leased sandbox; confirm 3 new archetypes in the picker.
2. Onboard as **Credit Union** → items surface shows member vocabulary ("Share Savings",
   inbox "Applications"), capability page shows BIAN-sourced perspective composed with the
   common baseline.
3. Drive a storefront inquiry end-to-end on a share-certificate item; confirm intake lands.
4. Record evidence via the MCP evidence tools against BI-5D9DCDE6 (dynamic-analysis prose
   report, not screenshots).

## Risks & rollback

- **Vocabulary is category-keyed; credit-union wants "Members" while banks want
  "Customers".** v1 compromise per spec §7.4 ("Customers & Members") unless leaf-level
  vocabulary override already exists — check `resolveVocabularyKey` before choosing.
  Risk: mid-build scope temptation to add leaf-level vocabulary; resist — file a follow-up
  BI if needed.
- **Silent seed skips** (known DPF failure class): a typo'd category or FK mismatch can
  upsert 0 rows without erroring. Mitigation: Phase 2's count assertion in tests.
- **Enum sweep completeness:** a missed category switch (e.g. a hardcoded
  `ArchetypeCategory` exhaustiveness check) breaks typecheck — that is the desired
  failure mode; fix every site the compiler names.
- **LFS on CI:** if a CI job lacks `git lfs`, the PDF checks out as a pointer file —
  harmless for build jobs (nothing imports it); verify no doc-lint job reads PDF bytes.
- **Rollback:** all changes are additive seed/template/wiring code on one branch — revert
  the PR. Seeded archetype rows are soft-deletable (`isActive: false`); re-seed does not
  resurrect operator-deactivated archetypes (existing invariant).

## Definition of done

BI-5D9DCDE6 acceptance criteria, verbatim: 3 archetypes seeded + idempotent re-seed;
BIAN perspective composed on the capability page; credit-union vocabulary + end-to-end
storefront inquiry functionally verified on canonical runtime; all wiring-contract
touchpoints tested.
