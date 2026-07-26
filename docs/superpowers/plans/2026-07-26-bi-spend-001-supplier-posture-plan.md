# Implementation Plan: Supplier Onboarding, Profile, and Contract Posture (BI-SPEND-001)

Expand the DPF Supplier capability from basic contact/payment fields into a governed, enterprise-grade supplier profile and onboarding posture.

## 1. Objectives & Scope

- **Governed Profile Expansion**: Add onboarding checklist status, tax compliance verification, insurance/document tracking, spend categories, preferred/blocked status transitions, and audit trails to the Supplier domain model.
- **Service & Pure Operations**:
  - `apps/web/lib/finance/supplier-service.ts`: Pure and persistent operations for onboarding status transition, compliance document verification, supplier status updates (`active` | `inactive` | `blocked`), and spend category assignment.
  - `apps/web/lib/finance/ap-validation.ts`: Zod schema extensions for `updateSupplierSchema`, `supplierOnboardingSchema`, and `supplierComplianceSchema`.
- **Integrations**: Link supplier posture into Accounts Payable (AP) payment runs, PO matching, and QuickBooks vendor mapping.
- **Unit Tests**: Full unit test coverage in `apps/web/lib/finance/supplier-service.test.ts`.

## 2. Proposed Changes

### `apps/web/lib/finance/ap-validation.ts`
- Extend `SUPPLIER_STATUSES` to include `"active" | "inactive" | "blocked" | "onboarding"`.
- Add `updateSupplierSchema` with optional tax/payment/compliance/category fields.
- Add `supplierOnboardingChecklistSchema` validating required onboarding steps (tax form, bank details, contract, insurance).

### `apps/web/lib/finance/supplier-service.ts`
- Implement `updateSupplierProfile(supplierId, updates)`.
- Implement `transitionSupplierStatus(supplierId, newStatus, reason)`.
- Implement `evaluateSupplierOnboardingPosture(supplier)` pure function returning checklist completeness score (0-100%) and missing required items.

### `apps/web/lib/finance/supplier-service.test.ts`
- Unit tests for onboarding posture evaluation, status transition rules, and validation checks.

## 3. Verification Plan

### Automated Tests
- `pnpm --filter web exec vitest run apps/web/lib/finance/supplier-service.test.ts`
- `pnpm typecheck`
- `pnpm pr:health <pr_number>`

### Manual Verification
- CI checks on GitHub PR.
