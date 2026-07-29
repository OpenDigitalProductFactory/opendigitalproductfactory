# Owner Principal Sensitivity Clearance — Implementation Plan

**Backlog item:** BI-473C3664

**Epic:** EP-COMPANY-AUTHZ-FGA

**Branch:** `fix/owner-principal-clearance`

**Date:** 2026-07-29

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Make the installation owner able to govern `internal` AI coworkers without weakening the authority evaluator. A fresh install and an upgraded install must deterministically converge the owner's existing `Principal` to `public + internal` clearance. Other people retain their current least-privilege clearance. `confidential` and `restricted` remain outside the automatic owner floor so higher-sensitivity work still reaches the existing approval or denial ceiling.

The live reproduction is exact:

- authenticated installation owner linked through the canonical user alias;
- converged owner principal clearance: `{public}`;
- coworker: `build-specialist`, sensitivity `internal`;
- governed result: `authority_denied`, reason `sensitivity-clearance-denied`.

## Existing substrate to preserve

- `Principal.sensitivityClearance` remains the clearance source of truth.
- `PrincipalAlias(aliasType="user")` remains the user-to-principal identity bridge.
- `syncUserPrincipal` and `syncEmployeePrincipal` remain the runtime convergence paths.
- `loadEffectiveAuthContext` remains the only loader consumed by the coworker authority evaluator.
- `evaluateCoworkerAuthority` remains fail-closed; there is no superuser bypass.
- Existing `FeatureBuild`, `TaskRun`, `BuildPhaseRun`, `DecisionShadowLedger`, `AuthorityBinding`, Work Case, merge-queue, and governed self-upgrade behavior is unchanged.

No new identity table, grant type, enum value, or parallel clearance store is introduced.

## Architecture review (advisory)

- **Alignment:** well aligned with the existing identity and authority architecture.
- **Canonical identity:** extend `Principal.sensitivityClearance` and resolve through `PrincipalAlias`; do not add a role-specific or coworker-specific clearance store (`principles/principal-convergence`).
- **Least privilege:** the automatic installation-owner floor is exactly `public + internal`. Superuser status does not bypass `evaluateCoworkerAuthority`, and does not imply `confidential` or `restricted`.
- **Single source of truth:** define the owner floor once in `@dpf/db/principal-sensitivity` and consume it from seed and runtime convergence.
- **Fleet safety:** use an additive data backfill that retains every existing clearance value; no constraint, deletion, or destructive replacement.
- **Functional evidence:** a migrated row and green tests prove installation, not operation. The live governed capability-need and experiment canaries remain mandatory (`structural-verification-is-not-functional`).
- **Blast radius:** `Principal` data for superusers, default-admin seeding, user/employee principal self-heal, effective coworker authority decisions, and the dependent Build Studio canary. Customer, partner, provider, task, artifact, and release substrates are not changed.
- **Recommended next step:** proceed with the plan as written. No kernel option trade-off or new reference-document standard is required.

## Backlog coverage

- Decision: atomic
- Receipt: `cms635rvi07f701msk1h8uzb1`
- Parent: `BI-473C3664`
- Deliverable: `owner-clearance-convergence` → `BI-473C3664`
- Dependencies: none
- Rationale: source policy, fresh-install seed, existing-install remediation, runtime self-heal, and authority regression are one invariant; splitting them would leave either new or upgraded installs unable to govern internal coworkers.

Atomic rationale: the source policy, fresh-install seed, existing-install data remediation, runtime principal self-heal, and authority regression must ship together. Shipping only one path leaves either new or upgraded installs unable to govern internal coworkers, while a migration without the source invariant would immediately drift again.

## Phase 1 — Define the policy in one place

**Files**

- `packages/db/src/principal-sensitivity.ts`
- `packages/db/src/principal-sensitivity.test.ts`

**Tasks**

1. Add one canonical installation-owner clearance constant containing exactly `public` and `internal`.
2. Add a small pure resolver that returns the owner floor for `isSuperuser=true` and leaves ordinary principals at the existing public floor.
3. Test exact membership, ordering/normalization, and the non-superuser floor.

**Exit gate**

- Targeted tests fail before the policy exists and pass after it.
- No automatic `confidential` or `restricted` clearance is introduced.

## Phase 2 — Converge fresh and runtime-created principals

**Files**

- `apps/web/lib/identity/principal-linking.ts`
- `apps/web/lib/identity/principal-linking.test.ts`
- `packages/db/src/seed.ts`

**Tasks**

1. Extend `syncUserPrincipal` to read `User.isSuperuser` and apply the canonical owner floor on create and update.
2. Extend `syncEmployeePrincipal` to derive the same policy when the employee is linked to a superuser.
3. Preserve existing non-owner clearances rather than resetting governed values during routine identity convergence.
4. Make `seedDefaultAdminUser` converge the default admin principal even when the user already exists; remove the current early return that skips principal convergence.
5. Use the same canonical clearance constant in the seed and runtime paths.

**Tests**

- New owner principal receives `public + internal`.
- Existing public-only owner principal is upgraded.
- Existing ordinary workforce principal is not widened.
- Existing customer/partner behavior is unchanged.
- Repeated convergence is idempotent.

**Exit gate**

- Principal-linking tests pass.
- Seed and runtime paths produce the same owner clearance.
- No authority evaluator logic changes.

## Phase 3 — Remediate existing installs fleet-safely

**Files**

- `packages/db/prisma/migrations/20260729xxxxxx_backfill_owner_principal_internal_clearance/migration.sql`

**Tasks**

1. Add a forward-only data migration that finds active superusers through the existing `User` → `PrincipalAlias(user)` → `Principal` relationship.
2. Append `internal` only when missing; retain all existing clearance values.
3. Include an in-file migration-safety attestation explaining why no constraint is tightened and no row is deleted.
4. Verify clean-schema and representative existing-data application, including no alias, duplicate rerun-equivalent state, and already-cleared owner cases.

**Exit gate**

- Migration applies cleanly to an empty database and a database with the live reproduction shape.
- The owner becomes `public + internal`; non-owner rows are byte-for-byte unchanged.
- Migration safety guard passes.

## Phase 4 — Verify authority and UX behavior

**Files**

- Existing authority/route tests only where needed to express the regression.
- `docs/architecture/` identity/authority documentation owning principal clearance, if an existing page describes this contract.

**Tasks**

1. Add a governed-execution regression showing an authenticated owner can reach the normal proposal/approval path for an `internal` coworker.
2. Retain a denial regression for a public-only principal.
3. Run targeted unit tests, web typecheck, migration guards, and the production build through the governed local-CI sandbox.
4. Verify the authenticated portal at desktop and narrow viewport:
   - Build Specialist can submit the low-risk capability need;
   - the review surface describes the action without exposing raw IDs by default;
   - public-only/high-sensitivity denial remains understandable.
5. Record documentation impact. If no existing operator-facing page owns clearance administration, document the automatic installation-owner floor in the architecture authority page and avoid inventing a management workflow.

**Exit gate**

- Targeted tests, production build, and migration checks are green.
- UX evidence covers desktop and narrow viewports.
- No baseline, assertion, tolerance, or route exclusion is weakened.

## Phase 5 — Roll out and resume the Build Studio canary

**Sequence**

1. Exact-SHA local merged-code gate.
2. Signed commit, push, ready PR, GitHub checks, `pnpm pr:health`, merge queue.
3. Governed self-upgrade of the live install; no direct portal compose rebuild.
4. `verify:preflight` must return `CAN-TEST`.
5. Confirm the owner principal converged to exactly `public + internal`.
6. Resume the original low-risk 2×2 Build Studio experiment canary.
7. Run the separate high-risk canary and prove it stops at the authority ceiling before artifact/workspace creation.
8. Record evidence on `WC-D22B0EC3`, BI-356E69B1, and BI-473C3664; reconcile final statuses only after both canaries.

## Recovery scenarios

- **Migration cannot resolve an owner alias:** leave the principal unchanged, let the seed/runtime convergence create or link it, and record the missing-alias condition; never guess by email.
- **Existing owner already has broader clearance:** retain it; the migration only appends `internal`.
- **Non-owner row changes:** fail verification and stop rollout.
- **Authority still denies after convergence:** inspect the authorization decision reason and effective auth context; do not bypass the evaluator.
- **Governed self-upgrade fails:** use its recovery point and rollback path; do not direct-rebuild the main portal.
- **Low-risk canary fails after authority succeeds:** classify the next failing governed boundary independently and keep BI-473C3664 scoped to clearance convergence.

## Completion gate

The BI is done only when the PR is merged, the migration and source convergence are live, the owner can govern an internal coworker through the normal proposal path, public-only principals remain denied, the low-risk Build Studio experiment proceeds autonomously, and the separate high-risk experiment stops at its authority ceiling.
