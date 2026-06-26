# FAT-ACTIONS — tax-remittance domain extraction (implementation plan)

**Date:** 2026-06-26
**BI:** BI-OPT-FAT-ACTIONS (EP-PLATFORM-OPTIMIZATION)
**Spec:** [`2026-06-26-platform-optimization-sweep.md`](../specs/2026-06-26-platform-optimization-sweep.md) §4.1 (F-C)
**Status:** Ready to execute — **deferred from the overnight wave deliberately** (see §5).

## 1. Goal

`apps/web/lib/actions/tax-remittance.ts` is 1,875 LOC: ~900 lines of domain helpers + 34 inline `prisma` writes across 12 server actions. The action layer should be a thin auth → validate → call-domain → `revalidatePath` shell; the domain logic belongs in `apps/web/lib/finance/`. This is the spec's "fat server action" finding. Do **tax-remittance first** (its validation seam already exists at `lib/finance/tax-remittance-validation.ts`); `build.ts`/`crm.ts`/`ea.ts` follow as separate PRs.

## 2. The exact extraction boundary (mapped 2026-06-26)

Helper region is lines ~70–986 (before the first action at :987). It splits cleanly:

**PURE (no prisma/auth/revalidate) → move to a new `apps/web/lib/finance/tax-remittance-core.ts`** (becomes unit-testable; behavior-preserving relocation):
`MANAGED_TAX_ISSUE_TYPES` (:70), `nullableString` (:123), `appendNote` (:128), the id generators `registrationPublicId`/`issuePublicId`/`periodPublicId`/`taxMonitorTaskId`/`credentialPublicId`/`remittanceRunPublicId`/`taxExecutionTaskId` (:137–164), `stableTaxEntityId` (:165), `issueKey` (:181), `decimalValue` (:205), `roundCurrency` (:217), `addDays` (:221), `addMonths` (:227), `taxableBaseFromLine` (:251), `buildInvoiceLiabilityDrafts` (:255), `buildBillLiabilityDrafts` (:322), `computeNextCronRun` (:526), `periodMonthsForFrequency` (:555), `buildFilingPacketNotes` (:572), `buildManagedTaxIssues` (:600), `buildCoworkerGuide` (:774).

**I/O (prisma/auth/revalidate) → stays in the action file (or a later `lib/finance/tax-remittance-service.ts` slice)**:
`requireManageFinance` (:81, auth), `requireOrganization` (:94), `getOrCreateTaxProfile` (:106), `revalidateTaxRoutes` (:185, Next-specific — stays in action layer), `createTaxNotification` (:192), `upsertOperationalTaxIssue` (:370), `resolveOperationalTaxIssue` (:416), `persistLiabilityDrafts` (:441), `reconcileTaxIssues` (:693), `loadTaxWorkspaceState` (:850).

> The pure and I/O helpers are **interspersed non-contiguously** (pure 123–369, I/O 370–525, pure 526–692, I/O 693–773, pure 774–849, I/O 850–986). Pull each pure block out individually; the kept I/O helpers (e.g. `persistLiabilityDrafts`) then **import** the pure ones they use (`buildInvoiceLiabilityDrafts`, `roundCurrency`, …). Carry the imports each pure fn needs: `nanoid`, `crypto.createHash`.

## 3. Phased steps

1. **Slice A — pure helpers (lowest risk).** Create `lib/finance/tax-remittance-core.ts` exporting the PURE set above (+ a `tax-remittance-core.test.ts` unit-testing the now-isolated pure logic — the highest-value byproduct). Update `tax-remittance.ts` to import them. No behavior change. **Verify: `tax-remittance.test.ts` green + typecheck.**
2. **Slice B — I/O orchestration.** Move `upsert/resolveOperationalTaxIssue`, `persistLiabilityDrafts`, `reconcileTaxIssues`, `loadTaxWorkspaceState`, `getOrCreateTaxProfile`, `createTaxNotification` into `lib/finance/tax-remittance-service.ts` (they take `prisma`/ids as args; no `auth()`/`revalidatePath` inside). Actions become: `requireManageFinance()` → validate → `service.x(...)` → `revalidateTaxRoutes()`. Higher parity care; the 12 actions stay the public surface.
3. **Slice C — repeat for `build.ts` / `crm.ts` / `ea.ts`** (separate PRs; `crm.ts`→`lib/crm/`, `ea.ts`→`lib/ea/`, both currently 0-import their siblings).

## 4. Verification (mandatory, runtime)

- `apps/web/lib/actions/tax-remittance.test.ts` (1,079 LOC) covers the action surface end-to-end — it must stay green after each slice (the actions delegate; the test exercises them unchanged).
- Run it on the **shared local-CI convergence sandbox lease** (`claim_nonprod_environment_lease(environmentKey="local-integration-ci")`) or via the junction-toolchain trick — **not** source-only-then-trust. `pnpm --filter web typecheck` + `pnpm --filter web build` per the build gate.
- Behavior-preserving: no change to any tax calculation, period, issue, or remittance-run output. Diff the 12 actions' observable behavior, not just compilation.

## 5. Why this was deferred from the overnight wave

Per the operator's "deliver to quality, not just to green" direction (the wave's other 7 BIs landed merged/green; this is the 8th): tax-remittance is **financial** code where a quiet, typecheck-passing error is a money bug. Correctly relocating ~17 non-contiguous interdependent helpers warrants a focused, runtime-verified, reviewed session — not an autonomous source-only pass. This plan removes all the discovery cost; execution is now mechanical for Slice A and carefully-scoped for B/C.
