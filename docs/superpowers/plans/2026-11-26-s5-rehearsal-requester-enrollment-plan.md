---
status: draft
---

# Plan: owner-operated inactive enrollment and retirement of the S5 rehearsal requester

- **Backlog item:** BI-9F7192F9, Workroom WC-4EBA473D.
- **Design:** `docs/superpowers/specs/2026-11-26-s5-rehearsal-requester-enrollment-design.md`, revision 5.
- **Shape:** delivery-small.
- **Delivery state:** both commands ship inert. The requester is never active.
- **Out of scope:** activation, sessions, delegation and issuance belong to BI-9F5D1052, which is blocked on the owner's least-privilege decision.

## Preconditions (hold Red until all are met)

- **P1. Design approved.** The independent re-review approves revision 5.
- **P2. Schema approved.** The migration is approved in principle. Before claiming the schema paths:
  - the coordinator confirms the model shape in revision 5;
  - the owner of `prismaModelCount` (portfolio-management) approves the baseline increase, because the ratchet is non-increasing at 649.
- **P3. Scope claimed.**
  - The coordinator relays that self-upgrade SUR-6C7547D1 has finished and its portal drain has cleared.
  - Every extra path below is checked for overlap, then claimed normally through `claim_workroom_scope`. No forced claims.
- **P4. Related tests and dispatch confirmed.**
  - `find_related_tests` has resolved every changed path.
  - Next.js 16.4.6 dispatch has been re-verified.
  - The API route is confirmed to be outside the UX sweep.
- **P5. Safe test environment.**
  - No DPF2 quiet window is open.
  - `/tmp/dpf2-local-ci.lock` is absent. Read the lock only.
  - Tests use throwaway PostgreSQL containers or the dev DB, with synthetic data only, never `dpf-postgres-1`.

## Phases

Each phase starts with a Red test that fails for the stated reason.

### 1. Retained record and migration (AC-E3)

**Build:**
- The model, the `S5RehearsalRequesterRetirementReason` enum, and back-relations on `User` and `Principal`.
- A migration that adds the all-or-none CHECK and a BEFORE UPDATE trigger enforcing immutable facts and an `active → retired`-only transition.
- The `@dpf` tag.
- Field-level asset registration in `apps/web/lib/govern/data/s5-rehearsal-requester-assets.ts`, wired into `assets.ts`.
- The data-impact manifest and migration-safety notes.
- The `prismaModelCount` baseline change.
- `isGovernedRequester`.

**Tests** (migrated schema in a throwaway container):
- The digest is unique.
- A fact-column update is rejected.
- Partial terminal tuples are rejected.
- `retired → active` is rejected.
- Deleting a linked User or Principal is refused, while unrelated deletes succeed.
- A read error is reported as an error.
- Fixture teardown drops the schema.

### 2. Audit writer (AC-E7)

**Build:**
- A typed insert for both keys, with deterministic `decisionId`s.
- The M-4 exclusion.

**Tests:**
- The approval reader rejects these rows.
- Projector and governance API tests.
- The M-4 exclusion holds.

### 3. Boundary and fence (AC-E1)

**Build:**
- The `PreviewEnrollmentFence`, served as a denying adapter.
- Enroll readiness: lease-joined attestation, DB identity and lease currency.
- Retire readiness: lease-independent installation and DB attestation, equal to the record's refs.
- The `[command]` handler:
  - pre-body production, origin, session, command and pinned setup, readiness, and owner/DB checks;
  - for enroll, a read-only pre-parse replay;
  - then a bounded body read.

**Tests:**
- Pre-body refusals and pre-parse replay make zero reader, hasher or mutator calls.
- Invalid bodies are read, with zero hasher calls and zero writes.

### 4. Owner binding (AC-E2)

**Build:**
- Candidate resolution:
  - `Organization.topAccountablePrincipalId` first;
  - otherwise the sole active human with live `manage_platform`;
  - hold on zero, multiple or mismatch;
  - no superuser fallback.
- A port for the owner-confirmed governed receipt. The served adapter denies.
- Live capability, automation and handover checks.
- Ports for the reservation and the fixture review.

**Tests:**
- Each candidate case.
- No oldest-superuser fallback.
- Refusals for non-owner, automation, handed-over and requester actors.

### 5. Enrollment (AC-E3, AC-E4)

**Build:**
- A serializable create: an inactive, roleless User; `syncUserPrincipal` with the Principal set inactive; the record and the audit row.

**Tests:**
- Exact replay, both pre-parse and concurrent, writes nothing and never calls the hasher.
- These all hold: drift, a forced prefix collision, an orphan email, and a conflict re-observation.
- The transaction is atomic.
- Replay still works after the audit rows are purged.
- On every non-create outcome the password is never hashed, compared, stored, logged or echoed. Assert this with spies on the hasher, the logger and the response body.

### 6. Never-active invariant (AC-E4)

These are regression tests only, run in this item's own test files against seeded synthetic data. No issuer file is edited. An enrolled requester is refused by:
- workforce sign-in;
- mobile login and refresh;
- LDAP bind;
- automation sign-in;
- OAuth consent GET/POST, code exchange, refresh and bearer;
- headless `client_credentials`;
- customer password and social sign-in.

### 7. Guards (AC-E6)

**Build:**
- `isGovernedRequester` refusals in `users.ts`:
  - lifecycle, role, admin reset, issue reset and complete reset (including old tokens);
  - request reset, which stays neutral.
- Workforce profile create and relink refusals in `workforce.ts`.
- `syncEmployeePrincipal` refuses a governed requester's Principal.

**Tests:** every guard, both before and after retirement.

### 8. Retirement (AC-E5)

**Build:**
- A transaction-scoped token and owned-client revocation helper extracted from `account-agent-access.ts`. The export's behaviour is unchanged and its existing tests pass.
- A Read Committed retire transaction:
  1. `FOR UPDATE` on the record, then fresh reads.
  2. Re-check authority and DB identity.
  3. Check the exact single local `user` alias.
  4. Revoke `AuthorityBinding` rows separately.
  5. Call the helper.
  6. Deactivate this account only.
  7. Write the terminal tuple once, plus the audit row.
- Fresh readback of bindings, tokens, owned clients, both identities and the tuple, with `committed_unverified` on failure.

**Tests** (throwaway PostgreSQL):
- Populated defensive revocation.
- Concurrent and repeat retire.
- No reservation and no lease.
- Purged audit rows.
- Attempt or fixture drift.
- An extra-alias hold.
- A forced post-commit readback failure that re-observes on retry.

### 9. Read seam (AC-E7)

**Build:** `readS5RehearsalEnrollment`.

**Tests:**
- No bearer fields.
- No mutator.
- `audit-expired`.
- The provisioner holds on an inactive requester.

### 10. UI (AC-E8)

**Build:**
- The page and the panel.
- The owner-only `/admin` link.
- The purpose contract and its index entry.
- Regenerated route companions and an updated eligible-route count.

**Tests:**
- Fence and owner gating.
- Hold state shows no password field.
- Production returns `notFound()`.

### 11. Documentation

- Update `docs/user-guide/admin/index.md`.
- Edit the parent spec (`2026-11-25-s5-rehearsal-draft-provisioner-design.md:17`): its "no migration" line must point to the retained record.

## Gates and evidence (before handoff)

- **Tests and typecheck:**
  - Focused tests.
  - PostgreSQL schema and concurrency tests in throwaway containers.
  - Web typecheck only when no DPF2 window is open and the lock is absent.
- **Guard scripts:**
  - prose-lint (test and run);
  - style-drift;
  - endpoint classification, baseline unchanged;
  - schema and metadata tags;
  - FK-index coverage;
  - stewardship scope;
  - closed-set strings;
  - asset coverage;
  - the platform-substrate baseline, with the approved model count.
- **Page budgets:**
  - `/admin`: at most 226 words, net Δ ≤ 0, ratchet unchanged.
  - New route: absolute shell budgets.
  - Governance decisions: ratchet unchanged.
- **UX-fit:** `docs/ux-fit/2026-11-26-rehearsal-requester.ux-fit.json`, by sweep measurement.
- **Docs impact:** the Admin guide and the parent spec. Confirm the 2026-09 dependency-inventory doc drops out once `govern/auth.ts` is untouched.
- **Derived artifacts:** regenerate only where inputs change, including architecture counts for the model, enum, migration and route.
- **Commits:** a `Design-Grounding-Decision:` trailer and DCO sign-off on every commit.
- **Coordinator go:** required before `pregate:preflight`, `pregate`, a push or `pnpm land`. An independent review on a different model runs before each gate.

## Files

### Already claimed and still used

- `apps/web/lib/identity/s5-rehearsal-enrollment.server{,.test}.ts`
- `apps/web/lib/actions/s5-rehearsal-enrollment.ts`
- `apps/web/components/admin/S5RehearsalEnrollmentPanel{,.test}.tsx`
- `apps/web/app/(shell)/admin/page.tsx`
- `apps/web/app/(shell)/admin/rehearsal-requester/page.tsx`
- `apps/web/lib/actions/users.ts`
- `apps/web/lib/auth/account-agent-access{,.test}.ts`
- `apps/web/lib/gpp/efficacy/efficacy-measures-store.ts`
- `apps/web/lib/security/internal-projector.ts` and `apps/web/app/api/v1/governance/decisions/route.ts` (tests only)
- `docs/user-guide/admin/index.md`
- the UX-fit JSON
- this spec and plan
- the six generated route and doc files

### Claimed but unused (release at handoff)

- `apps/web/app/api/admin/rehearsal-requester/route{,.test}.ts`
- `apps/web/lib/identity/authentication{,.test}.ts`
- `apps/web/lib/govern/auth{,.test}.ts`

### Previously cleared, claim after the drain

- `apps/web/app/api/admin/rehearsal-requester/[command]/route{,.test}.ts`
- `apps/web/lib/ux-budget/ux-budget.test.ts`
- `apps/web/lib/identity/password-policy.ts`
- `apps/web/lib/ux-budget/purpose-contracts/rehearsal-requester.ts` and `purpose-contracts/index.ts`
- `apps/web/lib/actions/users.test.ts`
- `apps/web/lib/gpp/efficacy/efficacy-measures.test.ts`
- `apps/web/lib/security/internal-projector.test.ts`
- `apps/web/app/api/v1/governance/decisions/route.test.ts`
- `docs/architecture/architecture-counts.generated.md`, if its inputs change

### New in revision 5 (need an overlap check, then a claim after the drain)

**Guards:**
- `apps/web/lib/actions/workforce.ts` and its test: the workforce link guard.
- `apps/web/lib/identity/principal-linking.ts` and its test: the employee-sync guard.

**Schema and stewardship:**
- `packages/db/prisma/schema/core-identity.prisma`: the model, enum and back-relations. This is approved in principle; the model shape still needs your confirmation.
- `packages/db/prisma/migrations/<timestamp>_s5_rehearsal_requester_enrollment/migration.sql`: the table, the CHECK and the trigger.
- `apps/web/lib/govern/data/s5-rehearsal-requester-assets.ts` (new) and `apps/web/lib/govern/data/assets.ts`.
- `docs/data-impact/2026-11-26-s5-rehearsal-requester-enrollment.data-impact.json` (new).
- `scripts/platform-substrate-baseline.json`: the `prismaModelCount` increase, which needs the owner's approval.
- Any shrink-only stewardship baselines the new model touches. Confirm these at P2.

**Docs:**
- `docs/superpowers/specs/2026-11-25-s5-rehearsal-draft-provisioner-design.md`: the parent "no migration" reconciliation.

### Dropped to BI-9F5D1052

- `apps/web/proxy.ts` and its test
- `apps/web/lib/api/auth-middleware.ts` and its test
- the OAuth authorize route and its test
- `apps/web/lib/auth/oauth-tokens.ts` and its test
- `apps/web/app/api/v1/auth/login/route.ts`
- `apps/web/lib/govern/auth-cookie-isolation.test.ts`

### Excluded (owned elsewhere)

- the lease fence and lease provenance files
- `lib/workroom-runtime/s5-rehearsal-*`
- every authentication and issuance file named in the design

## Coverage

Every deliverable maps to BI-9F7192F9. The delivered code holds until each of these lands:

| Dependency | Owner |
| --- | --- |
| Installation attestation: lease-joined for enroll, lease-independent for retire | BI-8EA98961 |
| DB identity: lease-independent | BI-5C193A3F |
| Lease currency for enroll | BI-60FC9291 |
| Reservation and fixture-review owners | BI-588688A7 |
| Owner-confirmed custody receipt | Coordinator and owner |
| Migration and model-count approvals | Coordinator and portfolio-management |
