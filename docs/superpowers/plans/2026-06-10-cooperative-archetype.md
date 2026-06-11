# Implementation Plan — Cooperative Archetype (first member-owned activation)

- **Backlog item:** `BI-AFC178F3` (epic `EP-ARCH-8D4F2A`; triaged `build`, size `large`)
- **Design spec:** [`docs/superpowers/specs/2026-06-09-civic-and-member-governed-archetypes-design.md`](../specs/2026-06-09-civic-and-member-governed-archetypes-design.md) §6.4, §7, §10
- **Depends on:** Phase-0 substrate (merged #1692 — `member-governance`/`membership-eligibility`/`member-equity` capabilities + member-owned rules), GovernanceMeeting model (merged #1696 — `bodyType` was designed for board/annual-meeting reuse), vocabulary mechanism (merged #1699)
- **Sequencing note:** the spec assigned member-governance v1 to the credit-union BI, but that BI is blocked on the BIAN leaf implementation — the cooperative ships it instead; the credit-union delta then reuses everything here.
- **Date:** 2026-06-10

Grounded against the worktree at merged main (governance surfaces, nav model, civic actions, compliance seed pattern all landed this session — file claims below are to code written or verified hours ago).

## Slice 1 — Archetype + member-governance surface gate (one PR with slice 2)

- `packages/storefront-templates/src/archetypes/nonprofit-community.ts` — add `cooperative`
  archetype (spec §6.4 puts it in this category; cooperative-ness lives in the axis):
  axes `member` / `member-owned` / `transactional` / `account-with-billing`;
  `capabilityOverrides: [{ capabilityKey: "member-equity", applicability: "required",
  reason: "Cooperatives allocate patronage by statute (Subchapter T)" }]` — first real
  use of the override path; vocabulary skin (Member-Owners / Member Portal / Member
  Requests / Member Services); item templates: Membership Share (fixed, purchase),
  Membership Application (free, inquiry), Member Account Question, Patronage & Equity
  Inquiry; sections About Our Co-op / Products & Services / Board & Committees / Contact.
  Sub-type tuning (ag/electric/food/housing/worker wizard question) is **deferred** like
  the utility's ownership question — same residual class, noted on close-out.
- `/governance` gate extension: `apps/web/app/(shell)/governance/page.tsx` currently
  requires `public-body-governance`; change to required-any of
  `["public-body-governance", "member-governance"]` via `getActiveOrgCapabilities()`;
  hide the Records Requests header link when `records-request` is inactive (co-ops have
  no FOIA duty). Records-requests page keeps its own gate unchanged.
- Nav: second `PORTAL_NAV_ROUTES` record `governance-member` (same `/governance` path,
  `orgCapabilityKey: "member-governance"`, business section, description "Board,
  committees, annual meeting, and minutes."). Governance values are mutually exclusive
  per archetype so both records never render together; add a permissions test asserting
  exactly one Governance item for a member-owned set and none for commercial.
- Tests: archetypes.test invariants pick the new definition up; activation-profile test
  asserting the cooperative derives member-governance/membership-eligibility required +
  member-equity **required via override** (override path proof).

## Slice 2 — Member equity module + Subchapter T pack

- `packages/db/prisma/schema.prisma` — `MemberEquityEntry`: org-scoped, additive
  (`entryId` unique, `memberAccountId → CustomerAccount`, `fiscalYear Int`,
  `kind: "patronage-allocation" | "equity-retirement" | "per-unit-retain" | "adjustment"`,
  `amount Decimal(14,2)` (negative = retirement), `qualified Boolean`, `cashPortion
  Decimal(14,2)?`, `notes`, indexes on (org, memberAccountId) and (org, fiscalYear)) +
  hand-authored migration verified against `prisma migrate diff` (the #1696 procedure).
- `apps/web/lib/actions/member-equity.ts` — conventions of `civic-governance.ts`:
  `recordEquityEntry`, `retireEquity` (negative amount, balance check),
  `runPatronageAllocation(fiscalYear, totalPool, cashPct)` — v1 allocates the pool
  **equally across active CustomerAccounts** with `qualified=true` rows and warns when
  `cashPct < 20` (Subchapter T floor); proportional-to-patronage basis is a documented
  follow-up (no purchase-volume data exists yet to weight by).
- `apps/web/app/(shell)/member-equity/page.tsx` + `components/civic/MemberEquityPanel.tsx`
  — gated on `member-equity`; per-member balance table (sum of entries), entry history,
  allocation-runner form, retire action. Nav record `member-equity` (path
  `/member-equity`, `capabilityKey: "view_finance"`, `orgCapabilityKey: "member-equity"`,
  business section).
- `packages/db/src/seed-cooperative-compliance.ts` — pack on the DORA/civic pattern,
  `industry: "cooperative"`: `REG-US-IRS-SUBCHAPTER-T` (qualified written notices of
  allocation within 8.5 months, ≥20% cash on qualified allocations, member consent
  records, Form 1099-PATR) + `REG-US-COOP-GOVERNANCE` (annual member meeting, director
  elections, bylaws/membership-record maintenance, patronage-basis records). Wired into
  `seed.ts` after the public-sector pack; pure-data integrity test mirroring
  `seed-public-sector-compliance.test.ts`.

## Verification

Package vitest + typecheck (storefront-templates, db, web) + full web vitest before push;
fresh-runtime verification on the shared lease (claim → throwaway pg → migrate/seed →
dev-portal): onboard as a worker co-op, confirm Member-Owners vocabulary + Governance
(member flavor, no Records Requests link) + Membership Share on the public site +
member-equity page with a runnable allocation across seeded member accounts + Subchapter
T pack in the compliance library. Teardown includes the node_modules sweep + reinstall
(dev-portal pollution) and lease release.

## Risks & rollback

- Equal-split allocation may read as wrong for real co-ops — labelled in-UI as
  "equal allocation (patronage-basis weighting coming)" so the v1 semantics are explicit.
- Two nav records sharing one path is novel — covered by the exactly-one-item test;
  worst case both render as duplicate links (cosmetic), only if an archetype ever
  declares both governance values, which the axis type prevents.
- All changes additive; revert the PR. Migration is a single new table.
