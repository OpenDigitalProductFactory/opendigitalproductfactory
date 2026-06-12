# Implementation Plan — Banking Deltas (credit union + community bank)

- **Backlog items:** `BI-D9ACE184` (credit-union deltas) + `BI-E677F250` (community-bank deltas), both `EP-ARCH-8D4F2A`
- **Design spec:** [`docs/superpowers/specs/2026-06-09-civic-and-member-governed-archetypes-design.md`](../specs/2026-06-09-civic-and-member-governed-archetypes-design.md) §7, §10
- **Date:** 2026-06-11

## What the BIAN work already delivered (verified by direct read)

The landed BIAN banking PR (#1694, BI-5D9DCDE6) consumed the Phase-0 civic substrate, so
most of what the spec assigned to these two BIs is **already live**:

- `credit-union` leaf already sets `primaryConsumer: "member"` + `governance: "member-owned"`
  (`banking-financial-services.ts:178-179`) → already derives member-governance,
  membership-eligibility, member-equity; the field-of-membership eligibility form field
  exists; Members / Member Advisors vocabulary is set.
- `financial-institution` ledgerModel is already wired on the `banking-financial-services`
  finance profile (`profiles.ts:471`), composing the COA fragment.
- Licensing/jurisdiction capture (charter, FDIC cert, NCUA charter, NMLS) already lands on
  the licensing substrate per the BIAN §9 work.

## What remains (this PR — closes both BIs)

The §10 delineation: the licensing substrate already holds posture/credentials; the
**recurring-obligation compliance packs** are not seeded yet. That is the remaining delta.

1. `packages/db/src/seed-banking-compliance.ts` — one pack on the existing
   Regulation/Obligation/Control substrate, factored so the shared regime is not
   double-seeded:
   - `REG-US-BSA-AML` (**shared** by bank + CU, `industry: "financial"`): CIP/KYC program,
     SAR filing cadence, CTR filing, OFAC/sanctions screening, BSA officer & independent
     testing.
   - `REG-US-NCUA` (**credit union**, `industry: "financial"`): NCUA 5300 quarterly call
     report, field-of-membership compliance, supervisory-committee annual audit, DOR
     (document of resolution) tracking.
   - `REG-US-FDIC-CRA` (**community bank**, `industry: "financial"`): quarterly FFIEC call
     report, CRA performance, fair lending (ECOA/HMDA), Reg O insider lending, exam-finding
     remediation.
   Controls: BSA/AML Program, NCUA Call-Report & Supervisory Audit, FFIEC Call-Report &
   Exam Remediation. Wired into seed.ts after the law-enforcement pack; pure-data integrity
   test mirroring the others.
2. `packages/storefront-templates/src/archetypes/banking-financial-services.ts` —
   credit-union `capabilityOverrides`: `member-equity → not-applicable` (reason: credit
   unions distribute dividends and hold member shares through the core banking system, not
   patronage-equity allocation/retirement — the /member-equity surface is a co-op concept
   and would mislead). The community bank is `investor-owned` so it never derives
   member-equity — no override needed there.
3. Tests: activation-profile fixtures asserting (a) credit-union derives member-governance +
   membership-eligibility required with member-equity **not-applicable via override**, and
   (b) community-bank derives none of the member/public-body machinery (investor-owned).

## Verification

Package vitest + typecheck + full web vitest before push; fresh-runtime verification on the
shared lease: onboard a credit union → Members vocabulary, member-governance surface,
NCUA + BSA packs in the compliance library, **no /member-equity surface**; onboard a
community bank → BSA + FDIC/CRA packs, no member machinery, financial-institution finance
profile. Record evidence; close both BIs.

## Risks & rollback

- Double-seeding BSA/AML across bank and CU — mitigated by a single shared `REG-US-BSA-AML`
  regulation both archetypes are accountable to (industry filter `financial`), not two copies.
- All additive seed + one override; revert the PR. No schema, no migration.
