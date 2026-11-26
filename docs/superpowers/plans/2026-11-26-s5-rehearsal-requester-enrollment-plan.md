---
status: draft
---

# Plan: owner-operated inactive enrollment and retirement of the S5 rehearsal requester

Backlog item BI-9F7192F9, Workroom WC-4EBA473D. Design: `docs/superpowers/specs/2026-11-26-s5-rehearsal-requester-enrollment-design.md`, revision 7. Shape: delivery-small.

This plan covers server-side work only. It ships inert, and the requester is never active.

The following are deferred to activation readiness:
- the operator UI
- UX-fit
- the purpose contract
- the Admin guide

Activation, sessions, delegation and issuance belong to BI-9F5D1052.

## Preconditions (hold Red until all are met)

- **P1. Design approved.** The independent re-review approves revision 7.
- **P2. Schema and model count.**
  - The coordinator confirms the model shape (approved in principle).
  - The owner approves a `prismaModelCount` raise from 649 to 650.
  - The generator accepts a raise only with all three of:
    - `--owner` (proposed: `portfolio-management`);
    - `--expiry <YYYY-MM-DD>`;
    - `--contraction <BI-…/EP-…>`, naming the work that folds the model back in (`scripts/measure-platform-substrate.mjs:80`, `:99`).
  - Regenerate through the canonical procedure:
    `node scripts/measure-platform-substrate.mjs --update --owner <owner> --expiry <date> --contraction <BI>`
    Never hand-edit `scripts/platform-substrate-baseline.json`.
  - **Red stays held without the approved budget.**
- **P3. Scope.**
  - Claim the schema, migration, stewardship and clone paths through the normal path after the coordinator's go.
  - Release the deferred-UI claims (listed below).
- **P4. Before Red.** Run `find_related_tests` for every changed path, and re-verify Next.js 16.4.6 dispatch.
- **P5. Environment.**
  - No DPF2 window is open.
  - The lock `/tmp/dpf2-local-ci.lock` is absent. Read it only; never touch it.
  - Use only throwaway PostgreSQL or the dev DB, with synthetic data. Never use `dpf-postgres-1`.

## Phases (test-first; each Red fails for the stated reason)

1. **Record and migration (AC-E3).**
   - Build:
     - the model and enum;
     - back-relations;
     - a migration with the all-or-none CHECK, a `BEFORE UPDATE` trigger and a `BEFORE DELETE` trigger, following the care-evidence precedent;
     - the `@dpf` tag;
     - asset registration;
     - the data-impact manifest and migration-safety notes;
     - the substrate baseline raised through P2;
     - `isGovernedRequester`.
   - Tests, run in a throwaway container:
     - unique digest;
     - fact update rejected;
     - partial tuple rejected;
     - `retired → active` rejected;
     - row delete rejected;
     - linked deletes refused, unrelated deletes succeed;
     - a read error reported as an error;
     - teardown drops the schema.
2. **Clone preflight (AC-E3).**
   - Build, in `sanitized-clone.ts`, **before** `runWithDestinationCleanup`:
     - open the source's `REPEATABLE READ READ ONLY` copy snapshot first;
     - inside it, count requester rows (`to_regclass`-guarded; a missing table counts as zero) and refuse when any exist;
     - read the destination disposition: an active requester refuses; only retired rows need `--discard-retired-rehearsal-evidence`;
     - the copy then reuses the same snapshot.
   - Concurrent enrollment is excluded by BI-60FC9291's lease-teardown fence.
   - Tests:
     - a refusal leaves destination rows intact;
     - a destination with an active requester is protected;
     - a retired-only destination needs the explicit disposition;
     - a pre-migration source clones;
     - a production-sourced ordinary preview is unaffected;
     - an enrollment made after the snapshot does not appear in the copy.
3. **Audit writer (AC-E8).**
   - Build: a typed insert for both keys, and the M-4 exclusion.
   - Tests: the approval reader rejects the row; projector and API tests; the M-4 exclusion.
4. **Boundary and fence (AC-E1).**
   - Build:
     - the denying `PreviewEnrollmentFence`;
     - enroll and retire readiness;
     - the `[command]` handler, `@exposure authenticated`.
   - Order of checks:
     - production; positive exact same-origin evidence (missing, `null` or foreign origin refuses); session; command;
     - strict `setupContext` from the query, with `setupDigest` derived on the server from the verified refs;
     - comparison with current owner evidence;
     - readiness;
     - the pre-body owner and DB check;
     - the enroll pre-parse replay through the shared `verifyRequesterState`; `retired` only when it passes, otherwise `requester_state_unverified`;
     - only then, the bounded body.
   - Tests:
     - release, replacement, identity drift, a retired replay (verified and alias-drifted), a malformed or stale context, a missing, `null` or foreign origin, and every pre-body refusal each make zero reader, hasher and mutator calls;
     - invalid bodies are read but make zero hasher calls and zero writes.
5. **Owner binding (AC-E2).**
   - Build:
     - `findInstallOrganization` → `topAccountablePrincipalId`, which holds on an ambiguous or invalid mapping;
     - the sole `manage_platform` human, used only when the mapping is unset;
     - no superuser fallback;
     - the receipt port, which denies and is gated on **BI-C7100183**;
     - live actor checks, with capabilities taken from role grants (not `can()` alone).
   - Tests:
     - missing receipt, wrong Principal, wrong install;
     - ambiguous organization;
     - invalid mapping;
     - several candidates;
     - non-owner, automation, handed-over and requester actors;
     - a superuser with no role.
6. **Enrollment (AC-E4).**
   - Build: a **Read Committed** create.
     1. `SET LOCAL lock_timeout`, then take the per-setup advisory lock before any hash. A timeout returns `enroll_busy`.
     2. Fresh reads after the lock: owner checks, reservation comparison, the record.
     3. The commit-time fences for the one-shot reservation revision (BI-588688A7), lease currency, installation and DB identity.
     4. The single hash.
     5. Create the inactive User and Principal, then write the record and audit row.
   - Outcomes: `create_failed` (rollback confirmed) and `create_unverified` (commit acknowledgement lost, re-observed on retry).
   - Tests:
     - Request B waits before A commits (asserted through `pg_locks` or a barrier). Exactly one hash. B gets `replay` with zero hasher calls.
     - A lock timeout gives `enroll_busy` with no hash.
     - A reservation released after the last comparison does not commit.
     - A forced post-hash failure gives `create_failed`, with no secret logged or returned.
     - A simulated lost commit acknowledgement gives `create_unverified`, and the retry re-observes.
     - Drift, collision, orphan email and mismatch each hold.
     - Replay still works after the audit rows are purged.
7. **Never-active invariant (AC-E5).**
   - These are regression tests only; no issuer is edited.
   - An enrolled requester is refused by every issuer: workforce, mobile login and refresh, LDAP, automation, OAuth consent, exchange, refresh and bearer, headless, customer and social.
8. **Guards (AC-E7).**
   - Build:
     - `users.ts`: lifecycle, role, admin reset, issue reset, complete reset (including old tokens), and request reset with a neutral response;
     - `workforce.ts`: profile create and relink;
     - `syncEmployeePrincipal`.
   - Tests: every guard, before and after retirement.
9. **Retirement (AC-E6).**
   - Build:
     - the transaction-scoped token and client revocation helper, with the export unchanged;
     - Read Committed `FOR UPDATE` on the record;
     - authority, DB, installation and exact-alias checks run **before** the already-retired branch;
     - separate binding revocation, the helper, deactivation of this account only, and a single terminal write plus audit row;
     - a fresh readback through the shared `verifyRequesterState`. It returns `retired` only on full verification, otherwise `committed_unverified` or a hold.
   - Tests:
     - populated revocation;
     - concurrent and repeated retirement;
     - no reservation and no lease;
     - purged audit rows;
     - drift;
     - a `committed_unverified` retry where the actor lost authority (refuses) or the alias drifted (holds, not `retired`).
10. **Read seam (AC-E8).**
    - Build: `readS5RehearsalEnrollment`.
    - Tests: no bearer fields, no mutator, `audit-expired`, and the provisioner holds.
11. **Docs.**
    - Reconcile **both** parent documents:
      - the provisioner spec: the "no migration" line (`:17`) and the enrollment and delegation ownership (`:15`–`:21`);
      - the provisioner plan: the F1 and F2 references (`:13`).
    - The parent's F1 stays held until this edit lands.
    - Record the docs-impact disposition for `docs/architecture/ai-agent-meta-model.md`, triggered by the `principal-linking.ts` change.

## Gates and evidence (before handoff)

- **Tests and typecheck:**
  - focused tests;
  - PostgreSQL schema, concurrency and clone tests, in throwaway containers;
  - web typecheck, only when no DPF2 window is open and the lock is absent.
- **Guards:**
  - prose-lint (test and run);
  - style-drift;
  - endpoint classification, baseline unchanged;
  - schema and metadata tags;
  - FK-index coverage;
  - stewardship scope;
  - closed-set strings;
  - asset coverage;
  - platform substrate, with the approved budget.
- **Derived artifacts:** regenerate only those whose inputs change:
  - `route-manifest`, for the API route. The API route does **not** change route-audience, route-shells or page-purpose, because those cover pages only.
  - `doc-index` and `doc-impact`;
  - architecture counts, for the model, enum, migration and route.
- **Commits:** a `Design-Grounding-Decision:` trailer and DCO sign-off on every commit.
- **Coordinator go:** required before `pregate:preflight`, `pregate`, any push or `pnpm land`. An independent review on a different model runs before each gate.

## Files

### Keep (claimed)

**Enrollment code:**
- `apps/web/lib/identity/s5-rehearsal-enrollment.server{,.test}.ts`
- `apps/web/app/api/admin/rehearsal-requester/[command]/route{,.test}.ts`
- `apps/web/lib/identity/password-policy.ts`

**Guards and identity:**
- `apps/web/lib/actions/users{,.test}.ts`
- `apps/web/lib/actions/workforce{,.test}.ts`
- `apps/web/lib/identity/principal-linking{,.test}.ts`
- `apps/web/lib/auth/account-agent-access{,.test}.ts`

**Audit and metrics:**
- `apps/web/lib/gpp/efficacy/efficacy-measures-store.ts`
- `apps/web/lib/gpp/efficacy/efficacy-measures.test.ts`

**Read-only consumers (tests only):**
- `apps/web/lib/security/internal-projector{,.test}.ts`
- `apps/web/app/api/v1/governance/decisions/route{,.test}.ts`

**Docs:**
- the parent provisioner spec
- this spec and plan

**Generated:**
- `apps/web/lib/docs/doc-index.generated.json`
- `apps/web/lib/docs/doc-impact.generated.json`
- `apps/web/lib/ea/route-manifest.json`

### Released (deferred UI and page-only generated files)

Already released through `release_workroom_scope`:

- `apps/web/components/admin/S5RehearsalEnrollmentPanel{,.test}.tsx`
- `apps/web/app/(shell)/admin/page.tsx`
- `apps/web/app/(shell)/admin/rehearsal-requester/page.tsx`
- `apps/web/lib/actions/s5-rehearsal-enrollment.ts`
- `apps/web/lib/ux-budget/purpose-contracts/rehearsal-requester.ts` and `purpose-contracts/index.ts`
- `apps/web/lib/ux-budget/ux-budget.test.ts`
- `docs/ux-fit/2026-11-26-rehearsal-requester.ux-fit.json`
- `docs/user-guide/admin/index.md`
- `apps/web/lib/ux-budget/route-shells.generated.json`, `apps/web/lib/ux-budget/route-purpose.generated.json` and `apps/web/lib/navigation/route-audience.generated.json`: page-only, so the API route does not change them

### Claim after the go (P2 and P3)

**Overlap already cleared:**
- `packages/db/prisma/schema/core-identity.prisma`
- `packages/db/prisma/migrations/<timestamp>_s5_rehearsal_requester_enrollment/migration.sql` (new)
- `apps/web/lib/govern/data/s5-rehearsal-requester-assets.ts` (new) and `apps/web/lib/govern/data/assets.ts`
- `docs/data-impact/2026-11-26-s5-rehearsal-requester-enrollment.data-impact.json` (new)
- `scripts/platform-substrate-baseline.json`, regenerated via P2

**New in revision 6, needs an overlap check:**
- `packages/db/src/sanitized-clone.ts`, `packages/db/src/sanitized-clone-cleanup.ts` and their tests (clone preflight before reset)
- `docs/superpowers/plans/2026-11-25-s5-rehearsal-draft-provisioner-plan.md` (parent plan reconciliation)
- `docs/architecture/ai-agent-meta-model.md`, only if the disposition is "updated"
- `docs/architecture/architecture-counts.generated.md`, if its inputs change
- any shrink-only stewardship baselines the model touches, confirmed at P2

### Excluded (owned elsewhere)

- the lease fence and provenance files
- `lib/workroom-runtime/s5-rehearsal-*`
- every authentication and issuance file named in the design

## Coverage

Every deliverable maps to BI-9F7192F9. The delivered code holds until these dependencies are met:

| Dependency | Owner |
| --- | --- |
| Installation attestation: lease-joined for enroll, lease-independent for retire | BI-8EA98961 |
| Database identity | BI-5C193A3F |
| Lease currency, fenced against teardown and clone reset | BI-60FC9291 |
| One-shot reservation revision fenced through commit | BI-588688A7 |
| Reservation and fixture-review owners | BI-588688A7 |
| Owner receipt adapter | **BI-C7100183** |
| Model-count budget | Owner, through P2 |

The deferred UI and activation belong to BI-9F5D1052.
