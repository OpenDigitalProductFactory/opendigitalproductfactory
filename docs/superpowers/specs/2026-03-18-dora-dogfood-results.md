# EP-REG-DORA-001: DORA Regulation Onboarding — Dogfood Results

**Status:** Complete
**Date:** 2026-03-18
**Epic:** DORA Regulation Dogfood
**Scope:** End-to-end onboarding of DORA (EU 2022/2554) through the compliance platform, gap identification and remediation

---

## DORA Onboarding Summary

### Data Created

| Entity | Count | Details |
|--------|-------|---------|
| Regulation | 1 | DORA (REG-DORA-2022) — EU jurisdiction, financial industry |
| Obligations | 33 | All 5 DORA pillars: ICT Risk Management (12), Incident Management (7), Resilience Testing (4), Third-Party Risk (8), Information Sharing (1), Simplified Regime (1) |
| Controls | 19 | Suggested controls mapped to obligations |
| Control-Obligation Links | 31 | Many-to-many mappings |
| Policy | 1 | ICT Risk Management Policy (draft lifecycle) |
| Policy Requirements | 6 | 3 training, 1 acknowledgment, 1 attestation, 1 action |
| Compliance Snapshot | 1 | Baseline posture score captured |
| Regulatory Submission | 1 | Annual DORA report to competent authority (draft) |
| Audit Log Entries | ~90 | Full audit trail of all onboarding actions |

### DORA Obligations Coverage by Pillar

| Chapter | Articles | Obligations | Controls Mapped |
|---------|----------|-------------|-----------------|
| II: ICT Risk Management | 5-16 | 12 | 18 (some controls cover multiple obligations) |
| III: Incident Management | 17-23 | 7 | 3 |
| IV: Resilience Testing | 24-27 | 4 | 2 |
| V: Third-Party Risk | 28-44 | 8 | 6 |
| VI: Information Sharing | 45 | 1 | 1 |
| Simplified Regime | 16 | 1 | 0 (not applicable to standard entities) |

### Gap Assessment Results

- **29 obligations**: Partial (controls linked but implementationStatus = "planned")
- **4 obligations**: Uncovered (no controls assigned — by design for: simplified regime, EU hub centralisation, sub-outsourcing notification, oversight framework)
- **0 obligations**: Covered (none have implemented controls yet — expected for initial onboarding)
- **Coverage**: 0% (all controls planned, none implemented)

### Posture Score

**30/100** — Expected baseline for a freshly onboarded regulation:
- Obligation coverage (40% weight): 0% → 0 points
- Control implementation (30% weight): 0% → 0 points
- Incident-free rate (15% weight): 100% → 15 points
- Action timeliness (15% weight): 100% → 15 points

The score will improve as controls move from "planned" → "implemented".

---

## Gaps Found and Resolution

### Fixed During Dogfood (10 items)

| # | Gap | Classification | Resolution |
|---|-----|---------------|------------|
| 1 | No obligation detail page | MISSING FEATURE | Created `obligations/[id]/page.tsx` — shows all fields, linked controls, evidence, regulation link |
| 2 | No control detail page | MISSING FEATURE | Created `controls/[id]/page.tsx` — shows all fields, linked obligations, evidence, risk assessments |
| 3 | Obligations not clickable in list | MISSING FEATURE | Wrapped obligation items in `<Link>` components |
| 4 | Controls not clickable in list | MISSING FEATURE | Wrapped control items in `<Link>` components |
| 5 | No filters on obligations page | MISSING FEATURE | Added regulation, category, and status filter bar |
| 6 | No filters on controls page | MISSING FEATURE | Added control type, implementation status, and effectiveness filters |
| 7 | No "Add Obligation" form | MISSING FEATURE | Created `CreateObligationForm` component, added to obligations page and regulation detail |
| 8 | No "Add Control" form | MISSING FEATURE | Created `CreateControlForm` component, added to controls page |
| 9 | No policy lifecycle buttons | MISSING FEATURE | Added transition buttons to policy detail page (draft→in-review→approved→published→retired) |
| 10 | No submission status buttons | MISSING FEATURE | Added transition buttons to submission detail page (draft→pending→submitted→acknowledged) |

### Migration Fix

| # | Issue | Resolution |
|---|-------|------------|
| 11 | Core GRC tables had no migration file (created via `db push`) | Created baseline migration `20260318110200_add_grc_core_tables` and marked as applied |
| 12 | Duplicate migration `20260318130000_add_user_skill_and_catalog_visibility` | Removed — content already covered by other applied migrations |

### Backlog Items (remaining gaps for future epics)

| # | Gap | Classification | Priority | Notes |
|---|-----|---------------|----------|-------|
| B1 | No create forms for evidence, risks, incidents, audits, corrective actions, submissions | MISSING FEATURE | High | 6 entity types have server actions but no UI forms |
| B2 | No edit capability on any entity | MISSING FEATURE | High | All entities have `update*` server actions but no edit forms |
| B3 | No detail pages for incidents, evidence, risks, corrective actions | MISSING FEATURE | Medium | Server actions exist (`get*`), UI pages missing |
| B4 | No control-obligation linking UI | MISSING FEATURE | High | `linkControlToObligation` server action exists, needs UI on obligation/control detail pages |
| B5 | No risk-control linking UI | MISSING FEATURE | Medium | `linkRiskToControl` server action exists, needs UI |
| B6 | No filters on evidence, risks, incidents, audits, corrective actions, submissions pages | MISSING FEATURE | Medium | Server actions support filters, UI doesn't expose them |
| B7 | No breadcrumb navigation on detail pages | UX IMPROVEMENT | Low | No back links from detail views to parent lists |
| B8 | Form error messages not shown to user | BUG | Low | CreateRegulationForm and CreatePolicyForm don't display server-side errors |
| B9 | Regulation detail page missing description/notes fields | UX IMPROVEMENT | Low | Only shows metadata, not the full regulation info |
| B10 | No regulation edit/deactivate UI | MISSING FEATURE | Low | Server actions exist but no buttons |
| B11 | Obligation link on policy detail goes to list, not specific obligation | BUG | Low | Should link to `/compliance/obligations/[id]` |
| B12 | No bulk import for obligations | ENHANCEMENT | Medium | Creating 40+ obligations one by one via UI is painful |
| B13 | Tab overflow on small screens | UX IMPROVEMENT | Low | 13 tabs with no scroll indicator |
| B14 | Dashboard duplicates queries instead of calling `getComplianceDashboard()` | UX IMPROVEMENT | Low | Two sources of truth for dashboard metrics |
| B15 | Empty states lack call-to-action buttons | UX IMPROVEMENT | Low | "No X yet" without a create button |

---

## Files Created/Modified

### New Files

| File | Purpose |
|------|---------|
| `packages/db/prisma/migrations/20260318110200_add_grc_core_tables/migration.sql` | Baseline migration for core GRC tables |
| `packages/db/scripts/seed-dora-regulation.ts` | DORA regulation seed script — idempotent |
| `packages/db/scripts/verify-dora-compliance.ts` | Verification script — gap assessment, posture, snapshot |
| `apps/web/app/(shell)/compliance/obligations/[id]/page.tsx` | Obligation detail page |
| `apps/web/app/(shell)/compliance/controls/[id]/page.tsx` | Control detail page |
| `apps/web/components/compliance/CreateObligationForm.tsx` | Obligation create form |
| `apps/web/components/compliance/CreateControlForm.tsx` | Control create form |

### Modified Files

| File | Change |
|------|--------|
| `apps/web/app/(shell)/compliance/obligations/page.tsx` | Added filters, clickable items, create form |
| `apps/web/app/(shell)/compliance/controls/page.tsx` | Added filters, clickable items, create form |
| `apps/web/app/(shell)/compliance/policies/[id]/page.tsx` | Added lifecycle transition buttons |
| `apps/web/app/(shell)/compliance/submissions/[id]/page.tsx` | Added status transition buttons |
| `apps/web/app/(shell)/compliance/regulations/[id]/page.tsx` | Added create obligation form |

---

## Confidence Assessment

**Can a second regulation (GDPR, SOX) be onboarded by a customer?**

**Yes, with caveats.** The core workflow works:
1. Create regulation via UI ✓
2. Add obligations via UI ✓ (new form)
3. Add controls via UI ✓ (new form)
4. Link controls to obligations — **needs UI** (B4, currently seed-only)
5. Create policy linked to obligations ✓
6. View gap assessment ✓
7. View posture score ✓
8. Take snapshot ✓
9. Create submission — **needs form** (B1)
10. Advance submission through lifecycle ✓ (new buttons)

The main blocker for customer self-service is **B4 (control-obligation linking UI)** — without it, customers can't build the coverage map that drives gap assessment and posture scoring. They can create obligations and controls, but can't connect them through the UI.

The seed script approach (used for DORA) works well for bulk onboarding of well-known regulations and could be templated for GDPR, SOX, etc.

---

## Spec Updates Required

None — the implementation matches the specs. The gaps identified are all features that the specs describe but aren't yet implemented in the UI (the server actions are all complete per spec).
