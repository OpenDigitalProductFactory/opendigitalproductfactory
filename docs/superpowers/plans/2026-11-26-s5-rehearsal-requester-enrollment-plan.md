---
status: draft
---

# Plan: owner-operated inactive enrollment and retirement of the S5 rehearsal requester

Backlog item BI-9F7192F9, Workroom WC-4EBA473D. Design: `docs/superpowers/specs/2026-11-26-s5-rehearsal-requester-enrollment-design.md`, revision 6. Shape: delivery-small.

This plan covers server-side work only. It ships inert, and the requester is never active.

The following are deferred to activation readiness:
- the operator UI
- UX-fit
- the purpose contract
- the Admin guide

Activation, sessions, delegation and issuance belong to BI-9F5D1052.

## Preconditions (hold Red until all are met)

- **P1. Design approved.** The independent re-review approves revision 6.
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
2. **Clone refusal (AC-E3).**
   - Build: `sanitized-clone.ts` refuses a source containing any `S5RehearsalRequesterEnrollment` row, before any table copy.
   - Tests: a requester-bearing source is refused with no rows copied; an ordinary source clones unchanged.
3. **Audit writer (AC-E8).**
   - Build: a typed insert for both keys, and the M-4 exclusion.
   - Tests: the approval reader rejects the row; projector and API tests; the M-4 exclusion.
4. **Boundary and fence (AC-E1).**
   - Build:
     - the denying `PreviewEnrollmentFence`;
     - enroll and retire readiness;
     - the `[command]` handler, `@exposure authenticated`.
   - Order of checks:
     - production, origin, session, command;
     - strict `setupContext` from the query;
     - comparison with current owner evidence;
     - readiness;
     - the pre-body owner and DB check;
     - the enroll pre-parse replay, with live-identity verification and `retired` for terminal records;
     - only then, the bounded body.
   - Tests:
     - release, replacement, identity drift, a retired replay, a malformed or stale context, and every pre-body refusal each make zero reader, hasher and mutator calls;
     - invalid bodies are read but make zero hasher calls and zero writes.
5. **Owner binding (AC-E2).**
   - Build:
     - `findInstallOrganization` → `topAccountablePrincipalId`, which holds on an ambiguous or invalid mapping;
     - the sole `manage_platform` human, used only when the mapping is unset;
     - no superuser fallback;
     - the receipt port, which denies and is gated on **BI-C7100183**;
     - live actor checks.
   - Tests:
     - missing receipt, wrong Principal, wrong install;
     - ambiguous organization;
     - invalid mapping;
     - several candidates;
     - non-owner, automation, handed-over and requester actors.
6. **Enrollment (AC-E4).**
   - Build: a serializable create that takes the per-setup advisory lock before any hash, then re-runs the checks under the lock, re-reads the record, makes the single hash, creates the inactive User and Principal, and writes the record and audit row.
   - Tests:
     - two overlapping requests on an empty setup give exactly one hash and one create; the other request gets `replay` with zero hasher calls;
     - a forced post-hash failure rolls back and returns `create_failed`, with no secret in the logs or the response;
     - drift, collision, orphan email and mismatch all hold;
     - replay works after audit purge.
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
     - a fresh readback of refs, alias, live artifacts, identities and the tuple. It returns `retired` only on full verification, otherwise `committed_unverified` or a hold.
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
    - Reconcile the parent provisioner spec: its "no migration" line (`:17`) and the enrollment and delegation ownership split (`:15`–`:21`).
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
  - `route-manifest` and `route-audience`, for the API route;
  - `doc-index` and `doc-impact`;
  - architecture counts, for the model, enum, migration and route.
  - Confirm at Red whether `route-shells` or `page-purpose` change for an API-only route.
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
- `apps/web/lib/navigation/route-audience.generated.json`

### Release at handoff (deferred UI, now unused)

- `apps/web/components/admin/S5RehearsalEnrollmentPanel{,.test}.tsx`
- `apps/web/app/(shell)/admin/page.tsx`
- `apps/web/app/(shell)/admin/rehearsal-requester/page.tsx`
- `apps/web/lib/actions/s5-rehearsal-enrollment.ts`
- `apps/web/lib/ux-budget/purpose-contracts/rehearsal-requester.ts` and `purpose-contracts/index.ts`
- `apps/web/lib/ux-budget/ux-budget.test.ts`
- `docs/ux-fit/2026-11-26-rehearsal-requester.ux-fit.json`
- `docs/user-guide/admin/index.md`
- `apps/web/lib/ux-budget/route-shells.generated.json` and `route-purpose.generated.json`, unless Red shows the API route changes them

### Claim after the go (P2 and P3)

**Overlap already cleared:**
- `packages/db/prisma/schema/core-identity.prisma`
- `packages/db/prisma/migrations/<timestamp>_s5_rehearsal_requester_enrollment/migration.sql` (new)
- `apps/web/lib/govern/data/s5-rehearsal-requester-assets.ts` (new) and `apps/web/lib/govern/data/assets.ts`
- `docs/data-impact/2026-11-26-s5-rehearsal-requester-enrollment.data-impact.json` (new)
- `scripts/platform-substrate-baseline.json`, regenerated via P2

**New in revision 6, needs an overlap check:**
- `packages/db/src/sanitized-clone.ts` and its test (clone refusal)
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
| Lease currency | BI-60FC9291 |
| Reservation and fixture-review owners | BI-588688A7 |
| Owner receipt adapter | **BI-C7100183** |
| Model-count budget | Owner, through P2 |

The deferred UI and activation belong to BI-9F5D1052.
