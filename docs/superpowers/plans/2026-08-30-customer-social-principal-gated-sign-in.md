---
status: review-ready
---

# Customer and social Principal-gated sign-in implementation plan

**Backlog:** BI-E22C3D75

**Epic:** EP-413F2602

**Design:** `docs/superpowers/specs/2026-08-30-security-authentication-hardening-successors-design.md` §8

**Workroom:** WC-1BB2A6D1 · `feat/principal-gated-customer-auth` · `/Users/markbodman/dpf-worktrees/principal-gated-customer-auth-recovery`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Current evidence and delivery boundary

Workforce password login verifies a credential and then calls `authorizePrincipalForSession`; customer password and Google/Apple flows in `apps/web/lib/govern/auth.ts` return a `CustomerContact`-rooted session without the same Principal decision. `syncCustomerPrincipal` and customer/partner alias resolution already exist in `apps/web/lib/identity/principal-linking.ts`, and `loadEffectiveAuthContext` already understands `customer_contact` and `partner_contact` aliases. The missing work is convergence at the session boundary, not a new identity model.

The live production read on 2026-08-30 found five `CustomerContact` rows and zero `customer_contact` aliases. The historical `20260426150500_backfill_missing_principals` migration ran successfully before those contacts were created, proving that a one-time migration without complete write-path convergence is insufficient. The 2026-09-04 substrate reconciliation confirmed the bypass remains on `origin/main`: workforce password login calls `authorizePrincipalForSession`, while customer password and social sign-in still return a `CustomerContact`-rooted session directly; signup still treats `syncCustomerPrincipal` as best-effort after the account transaction.

This plan is **atomic**. The shared authorization seam, transactional creation/deactivation paths, populated-data repair, and session callback integration form one security invariant: no session-capable customer credential exists outside the Principal authority decision. Releasing any subset preserves a bypass or creates split identity state.

## Phase 1 — red authority-contract tests

**Deliverable:** failing tests describe one verified-credential-to-authorized-Principal seam for workforce, customer password, social sign-in, linking, onboarding, inactive account/contact, inactive Principal, and alias conflict.

**Files:** `apps/web/lib/identity/authentication.test.ts`, `apps/web/lib/govern/auth*.test.ts`, `apps/web/lib/govern/social-auth.test.ts`, `apps/web/lib/actions/social-auth-actions.test.ts`, and focused customer-signup tests.

**Requirements:** OBJ-PRI-001, OBJ-PRI-002, OBJ-PRI-003.

**Verification:** AC-PRI-001 through AC-PRI-004 fail for the missing customer/social behavior while existing workforce cases remain green.

## Phase 2 — one population-aware Principal authentication seam

**Deliverable:** extend the existing identity authority module with a population-aware function that accepts an already verified workforce or customer credential/assertion, resolves the canonical alias, materializes only through the shared linker, enforces active/conflict/authority state, and returns a Principal-rooted session subject or stable refusal.

**Files:** `apps/web/lib/identity/authentication.ts`, `apps/web/lib/identity/principal-linking.ts`, `apps/web/lib/identity/load-effective-auth-context.ts`, and focused tests.

**Dependencies:** Phase 1.

**Constraints:** `CustomerContact` remains the credential/profile and account-scope record; `Principal` remains authority; no second session identity cache; partner kind derives from live enrollment.

**Verification:** table-driven tests prove identical refusal semantics across workforce, customer, and partner populations without merging their credential verification rules.

## Phase 3 — transactional lifecycle convergence and populated-data repair

**Deliverable:** every session-capable customer creation/link/activation/deactivation path converges the `CustomerContact`, `Principal`, and aliases inside one transaction or refuses. Add a forward-only, idempotent populated-data migration for existing contacts and a repeatable bounded invariant query so contacts created after migration cannot silently drift again.

**Files:** `apps/web/lib/actions/customer-auth.ts`, `apps/web/lib/actions/social-auth-actions.ts`, `apps/web/app/api/storefront/sign-up/route.ts`, session-capable customer-contact write paths, `packages/db/prisma/migrations/<timestamp>_customer_principal_auth_convergence/migration.sql`, and invariant tests/check.

**Dependencies:** Phase 2.

**Migration:** reuse the established `customer_contact` plus lowercase `email` alias grammar; preserve existing matching Principals; refuse ambiguous email convergence rather than choosing. The migration must apply against populated, partially converged, inactive, partner-enrolled, and merged-contact states. It performs set-based writes and the verification query reports counts/conflicts without loading an unbounded contact inventory.

**Verification:** migration smoke on a populated fixture; zero active session-capable contacts without a canonical alias; rollback restores application code while the additive aliases remain safe.

## Phase 4 — gate every customer and social session issuance path

**Deliverable:** customer password and Google/Apple callbacks call the shared authority seam after credential/assertion verification and before returning a session user or onboarding/link continuation token. Social lookup uses provider plus provider-account id as identity; verified email may enter the guarded linking flow but cannot select an identity by itself. JWT/session callbacks carry the canonical Principal identity needed by the effective-auth loader without duplicating authorization state.

**Files:** `apps/web/lib/govern/auth.ts`, `social-auth.ts`, temporary-token/linking actions, effective-auth loader, focused tests.

**Dependencies:** Phases 2–3.

**Verification:** inactive/unresolved/conflicted Principals receive no session or continuation token; active customers retain account/contact scope; Google/Apple link and onboarding flows cannot create a session-capable split state.

## Phase 5 — governed completion

Run focused authentication and identity tests, migration smoke against populated data, typecheck, production build, gitleaks, `pnpm run pregate:preflight`, exact-tree `pnpm run pregate`, and independent semantic review. Functionally verify customer password and one configured social path on the canonical runtime at real privilege, plus inactive-Principal refusal and session invalidation. Update operator/security documentation and only then mark BI-E22C3D75 done with evidence.

## Backlog coverage

- **Decision:** atomic.
- **Parent / implementation BI:** BI-E22C3D75.
- **Deliverable mapping:** `customer-social-principal-gate` → BI-E22C3D75.
- **Dependencies:** existing Principal/PrincipalAlias, customer/partner linker, Auth.js providers, and populated-data migration substrate.
- **Rationale:** listing, lifecycle, data repair, and session issuance are one authorization invariant; none is independently safe to ship.
- **Governed receipt:** pending independent spec approval and immutable plan commit; record through `record_plan_backlog_coverage` before implementation.

## Risks and rollback

| Risk | Control | Rollback |
|---|---|---|
| Existing customers are locked out by missing aliases. | Populate aliases before enforcing the session gate; inventory and refuse ambiguous matches. | Revert the session-gate code while keeping additive Principal/alias rows; repair conflicts before re-enable. |
| Auto-link joins the wrong person by email. | Require verified provider identity and existing guarded linking rules; conflict fails closed. | Disable auto-link path and require explicit account linking. |
| Partner enrollment changes Principal kind incorrectly. | Derive kind through the existing shared helper inside the transaction. | Restore prior kind from enrollment evidence and rerun convergence. |
| Session carries stale authority after deactivation. | Transactional deactivation plus server-side Principal check and session invalidation. | Revoke affected sessions; application rollback must not reactivate Principal state. |
| Migration duplicates a Principal. | Idempotent alias-first lookup and conflict inventory against populated fixtures. | Stop migration, retain transaction rollback, repair ambiguous aliases before retry. |

## Success evidence

Success means every workforce, customer, partner, password, and social session is issued only after an active canonical Principal authorizes it; existing customer/account scope is unchanged; no populated session-capable contact lacks its alias; and canonical-runtime negative tests prove inactive and conflicted identities cannot obtain a session.
