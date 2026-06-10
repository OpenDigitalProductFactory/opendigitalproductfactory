# Implementation Plan — Civic Archetypes Phase 0: Governance Axis, Served-Party Values, LedgerModel, Capability Registry

- **Backlog item:** `BI-938D1B71` (epic `EP-ARCH-8D4F2A` — Archetype Model V2; triaged `build`, size `large`)
- **Design spec (source of truth for shape):** [`docs/superpowers/specs/2026-06-09-civic-and-member-governed-archetypes-design.md`](../specs/2026-06-09-civic-and-member-governed-archetypes-design.md) §6, §12 Phase 0
- **Downstream consumers:** BI-D9ACE184 (credit-union deltas), BI-8D477188 (small-town), BI-E677F250 (community-bank deltas), BI-AFC178F3 (cooperative), BI-0938EFF5 (municipal-utility), BI-C1578821 (law-enforcement) — all blocked by this BI
- **Coordination:** BI-5D9DCDE6 (BIAN banking) touches the same enum file (`types.ts` `ArchetypeCategory`) and `packages/finance-templates/src/profiles.ts`; whichever PR lands second rebases and adopts the other's shape (spec §6.2)
- **Date:** 2026-06-09

Every "touch file X" claim below was grounded by direct read in the authoring session
(`packages/storefront-templates/src/{types,capability-registry,applicability-rules,activation-profile}.ts`,
`packages/finance-templates/src/{types,profiles}.ts`, `apps/web/lib/storefront/archetype-vocabulary.ts`).

## Phase 1 — Axis substrate (`packages/storefront-templates`)

**Files:**
- `src/types.ts` —
  - new `GovernanceModel = "investor-owned" | "member-owned" | "public-body"`;
  - `governance?: GovernanceModel` added to `OperatingModelAxes` as **optional** (the
    interface currently has 7 required fields at lines 122–130; making it required would
    break every existing archetype definition — the normalizer defaults it instead);
  - `PrimaryConsumer` (lines 83–89) gains `"member"` and `"resident"`;
  - `CommercialModel` (lines 101–110) gains `"statutory-fees-and-levies"`;
  - `ArchetypeCategory` (lines 12–24) gains `"public-sector"` (the 14th value;
    `banking-financial-services` arrives via the BIAN PR — merge-conflict expected and
    trivial).
- `src/activation-profile.ts` — normalizer populates `governance: "investor-owned"`
  when absent (same survival rule as the axes/portfolio inference for legacy profiles);
  downstream consumers never branch on "governance present".
- `src/applicability-rules.ts` — additive rules in `RULES` (existing rules untouched):
  - `member-owned-governance`: `governance === "member-owned"` → `member-governance`
    required (organization scope), `member-equity` recommended,
    `membership-eligibility` required.
  - `public-body-governance`: `governance === "public-body"` → `public-body-governance`
    required, `records-request` required (organization scope).
  - `resident-service-obligation`: `primaryConsumer === "resident"` →
    `service-request-311` required, `customer-accounts` required with
    organization-scope isolation (residents are org-scoped records, not estate scope).
  - `member-eligibility-before-account`: `primaryConsumer === "member"` →
    `customer-accounts` required + `membership-eligibility` required.
  - `supportedPatternsForCommercialModel` (exhaustive switch, line 448) gains the
    `statutory-fees-and-levies` case: `primaryPaymentPattern: "ad-hoc-invoice"`,
    supported `["ad-hoc-invoice", "recurring-agreement"]` (annual assessments),
    `invoiceExecutionMode: "prepared-not-prescribed"`,
    `recurringBillingApplicability: "optional"`. **No new `PaymentPattern` value** —
    a levy is an obligation-driven invoice; if Phase-1 archetype work proves the
    pattern vocabulary insufficient, that is a follow-up BI, not scope creep here.
- `src/capability-registry.ts` — five new `CAPABILITY_REGISTRY` entries
  (shape per `CapabilityRegistryEntry`, lines 20–28):

  | key | portfolio | ownershipScope | isolation | surfaces |
  | --- | --- | --- | --- | --- |
  | `member-governance` | forEmployees | organization | organization-scope | governance, meetings |
  | `membership-eligibility` | productsAndServicesSold | organization | organization-scope | customers, membership |
  | `member-equity` | productsAndServicesSold | customer-account | organization-scope | finance, membership |
  | `public-body-governance` | forEmployees | organization | organization-scope | governance, meetings |
  | `records-request` | manufactureAndDeliver (request-to-fulfill) | organization | organization-scope | records-requests |
  | `service-request-311` | manufactureAndDeliver (request-to-fulfill) | organization | organization-scope | service-requests |

  (Six keys — `membership-eligibility` was implicit in the BI's "5 entries" count as
  part of member-governance; registering it separately keeps the credit-union intake
  gate independently addressable. Portfolio placements follow the §6.6 contract:
  governance machinery is internal tooling, request lifecycles are IT4IT
  request-to-fulfill value streams.)
- Tests (`applicability-rules.test.ts`, `capability-registry.test.ts`,
  `activation-profile.test.ts`):
  - fixtures for the six civic axis declarations from spec §7 asserting the §9 table
    falls out of the rules (table = rendered view; rules win);
  - **regression invariant: every archetype in `ALL_ARCHETYPES` derives an identical
    capability map before/after this change** (snapshot the derived maps with
    `governance` absent vs defaulted — must be equal);
  - registry key/portfolio integrity for the six new entries.

**Verification:** `pnpm --filter @dpf/storefront-templates exec vitest run` green;
`pnpm --filter @dpf/storefront-templates typecheck` green. The `CommercialModel`
addition must surface every exhaustive-switch site via typecheck — fix each site the
compiler names (desired failure mode; known site: `supportedPatternsForCommercialModel`).

## Phase 2 — LedgerModel + COA templates (`packages/finance-templates`)

**Files:**
- `src/types.ts` — `LedgerModel = "commercial" | "fund-accounting" | "financial-institution" | "cooperative-equity"`;
  optional `ledgerModel?: LedgerModel` on `FinancialProfile` (lines 24–43 today have no
  ledger concept; absent ⇒ `commercial`, so all existing profiles are untouched).
- `src/profiles.ts` — COA seed-fragment exports for the three non-commercial models
  (fund-accounting: fund-dimension accounts General/Special-Revenue/Enterprise/Capital/
  Debt-Service; financial-institution: interest-income / fee-income / interest-expense /
  provision shape; cooperative-equity: allocated/unallocated equity + patronage payable).
  These are **named template fragments consumed by the Phase-1/2 archetype BIs**, not
  category-keyed profiles — no category exists for them yet. Read
  `normalizeFinancialProfile` before wiring (BIAN plan flags that `PROFILES` keying mixes
  slug and category; match reality).
- `src/profiles.test.ts` — fragment shape coverage + `ledgerModel` default assertion.
- **Coordination:** if BIAN Phase 3 (banking financial profile) has landed, its profile
  gains `ledgerModel: "financial-institution"` here and the financial-institution COA
  fragment reconciles with its categories; if not landed, the fragment ships standalone
  and the BIAN PR adopts it (spec §6.2).

**Verification:** `pnpm --filter @dpf/finance-templates exec vitest run` + typecheck green.

## Phase 3 — Category vocabulary + wiring sweep (`apps/web`)

**Files:**
- `lib/storefront/archetype-vocabulary.ts` — `"public-sector"` entry in `VOCABULARY`
  (spec §8: items "Services & Programs", portal "Resident Portal", stakeholders
  "Residents", team "Staff", inbox "Service Requests", agent "Resident Services").
  Leaf overrides (utility/police) ship with their archetype BIs via
  `ArchetypeDefinition.vocabulary` → `customVocabulary` (BIAN mechanism — no new path).
- Category-switch sweep: `pnpm --filter web typecheck` after the enum addition names any
  exhaustive `ArchetypeCategory` site; extend only where a category switch already exists
  (BIAN plan Phase 4 list is the known surface: `industries.ts`,
  `archetype-business-context.ts`, `marketing-playbooks.ts`, `setup-profile.ts`).
  **`industries.ts` INDUSTRY_OPTIONS deliberately does NOT gain a public-sector entry in
  Phase 0** — an industry option with zero seeded archetypes is a dead-end picker path;
  it ships with BI-8D477188 (small-town) alongside the first `public-sector` archetype.

**Verification:** `pnpm --filter web typecheck` (worktree) green; targeted vitest for
touched libs.

## Phase 4 — Axis-vocabulary record + verification close-out

- Record the accepted axis additions (`governance` column; `member`/`resident` consumer
  values; `statutory-fees-and-levies` commercial model) in
  `docs/Reference/operating-model-axes-additions.md` (new sidecar next to the canonical
  workbook `docs/Reference/4_portfolio_Reworked_V3_Definitions_IT4IT.xlsx`), citing this
  spec's operator approval per the §3.6 workbook-first contract — the xlsx itself is
  updated on the taxonomy team's next pass, the sidecar is the bridge.
- Functional smoke on the canonical runtime (per
  `structural-verification-is-not-functional`): re-seed the leased sandbox, onboard (or
  re-enter setup for) an existing commercial archetype (hair-salon), and confirm the
  activation summary + capability questions are byte-identical to pre-change behavior —
  the zero-behavior-change criterion observed live, not just in snapshots. Record
  evidence against BI-938D1B71 via the MCP evidence tools (dynamic-analysis prose).

## Risks & rollback

- **Required-field temptation:** making `governance` required in `OperatingModelAxes`
  breaks 45+ archetype literals and every test fixture. The optional-field + normalizer
  default is the same survival rule the 2026-05-22 spec mandates for axes/portfolios —
  do not "clean it up" to required in this PR.
- **Enum merge conflicts with concurrent BIAN PR:** both touch `ArchetypeCategory` and
  `profiles.ts`. Trivial union conflicts; the overlap re-sweep before push
  (`git log origin/main -- packages/storefront-templates`) decides who rebases.
- **Exhaustive-switch fallout:** `CommercialModel` and `ArchetypeCategory` additions
  surface compile errors at every exhaustiveness site — that is the designed discovery
  mechanism; fix every named site, never add a `default:` arm to silence one.
- **Capability-count drift:** `createBaseCapabilityMap` seeds every registry key as
  `not-applicable` (or `hidden`) — six new keys mean every existing derived map gains six
  inert rows. The regression snapshot must compare *applicability-bearing* entries, or
  normalize both sides, so inert additions don't mask a real regression.
- **Rules ordering:** `applyRuleResult` is last-write-wins per key. The four new rules
  touch `customer-accounts` (also written by `customer-accounts-from-external-consumer`);
  new rules append after existing ones so member/resident declarations win only for the
  new axis values — covered by the civic fixtures.
- **Rollback:** additive types/rules/templates on one branch — revert the PR. No
  migrations, no seed-data changes in this BI.

## Definition of done

BI-938D1B71 acceptance criteria, verbatim: 45 existing archetypes normalize to
`investor-owned` with zero behavior change (regression test); rules engine derives the
spec §9 table for the six civic axis declarations from axes alone (fixtures);
`getFinancialProfile` resolves all four ledgerModels with existing profiles untouched;
no `archetypeId` string comparisons introduced.
